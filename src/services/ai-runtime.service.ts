import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { AppError } from "../utils/errors.js";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface KnowledgeSource {
  source: string;
  title: string;
  url: string;
}

interface RuntimeReply {
  type?: string;
  id?: string;
  ok?: boolean;
  content?: string;
  sources?: unknown;
  error?: string;
}

interface PendingReply {
  id: string;
  resolve: (value: { content: string; sources: KnowledgeSource[] }) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isKnowledgeSource(value: unknown): value is KnowledgeSource {
  return (
    isRecord(value) &&
    typeof value.source === "string" &&
    typeof value.title === "string" &&
    typeof value.url === "string"
  );
}

export class AIRuntimeService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startupPromise: Promise<void> | null = null;
  private startupResolve: (() => void) | null = null;
  private startupReject: ((error: Error) => void) | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private pending: PendingReply | null = null;
  private outputBuffer = "";
  private queue: Promise<void> = Promise.resolve();
  private stopping: Promise<void> = Promise.resolve();

  generate(
    message: string,
    history: ConversationMessage[],
  ): Promise<{ content: string; sources: KnowledgeSource[] }> {
    const operation = this.queue.then(() => this.request(message, history));
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) {
      await this.stopping;
      return;
    }

    this.child = null;
    this.failStartup(
      new AppError(503, "AI_RUNTIME_UNAVAILABLE", "The model runtime is shutting down."),
    );
    this.failPending(
      new AppError(503, "AI_RUNTIME_UNAVAILABLE", "The model runtime is shutting down."),
    );
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = null;
    this.stopping = new Promise((resolve) => {
      const forceStopTimer = setTimeout(() => child.kill("SIGTERM"), 5000);
      child.once("exit", () => {
        clearTimeout(forceStopTimer);
        resolve();
      });
      child.stdin.end();
    });
    await this.stopping;
  }

  private async request(
    message: string,
    history: ConversationMessage[],
  ): Promise<{ content: string; sources: KnowledgeSource[] }> {
    await this.start();
    const child = this.child;
    if (!child || !this.isReady()) {
      throw new AppError(503, "AI_RUNTIME_UNAVAILABLE", "The model runtime is not available.");
    }

    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        logger.error("AI model generation timed out");
        this.stopChild(child);
        reject(new AppError(504, "AI_GENERATION_TIMEOUT", "The model response timed out."));
      }, env.AI_RUNTIME_TIMEOUT_MS);
      this.pending = { id, resolve, reject, timer };

      child.stdin.write(`${JSON.stringify({ id, message, history })}\n`, (error?: Error | null) => {
        if (error && this.pending?.id === id) {
          clearTimeout(timer);
          this.pending = null;
          reject(new AppError(503, "AI_RUNTIME_UNAVAILABLE", "The model runtime stopped."));
        }
      });
    });
  }

  private isReady(): boolean {
    return this.child !== null && this.startupPromise === null;
  }

  private async start(): Promise<void> {
    await this.stopping;
    if (this.isReady()) return Promise.resolve();
    if (this.startupPromise) return this.startupPromise;

    const child = spawn(env.AI_RUNTIME_PYTHON, [env.AI_RUNTIME_SCRIPT, "--serve"], {
      env: {
        ...process.env,
        MIRYO_MODEL: env.MIRYO_MODEL_PATH,
        MIRYOWIKI_API: env.MIRYOWIKI_API,
        MIRYOWIKI_URL: env.MIRYOWIKI_URL,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.outputBuffer = "";

    this.startupPromise = new Promise<void>((resolve, reject) => {
      this.startupResolve = () => {
        if (this.startupTimer) clearTimeout(this.startupTimer);
        this.startupTimer = null;
        this.startupResolve = null;
        this.startupReject = null;
        this.startupPromise = null;
        resolve();
      };
      this.startupReject = (error) => {
        if (this.startupTimer) clearTimeout(this.startupTimer);
        this.startupTimer = null;
        this.startupResolve = null;
        this.startupReject = null;
        this.startupPromise = null;
        reject(error);
      };
      this.startupTimer = setTimeout(() => {
        this.startupReject?.(
          new AppError(503, "AI_RUNTIME_START_TIMEOUT", "The model runtime did not start in time."),
        );
        this.stopChild(child);
      }, env.AI_RUNTIME_TIMEOUT_MS);
    });

    child.stdout.on("data", (chunk: Buffer) => this.readOutput(child, chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      const diagnostic = chunk.toString("utf8").trim();
      if (diagnostic) {
        logger.debug({ diagnostic: diagnostic.slice(0, 500) }, "AI runtime diagnostic");
      }
    });
    child.once("error", (error) => {
      logger.error({ errorName: error.name }, "AI runtime process failed");
      this.failStartup(
        new AppError(503, "AI_RUNTIME_UNAVAILABLE", "The model runtime could not start."),
      );
      this.failPending(new AppError(503, "AI_RUNTIME_UNAVAILABLE", "The model runtime stopped."));
      if (this.child === child) this.child = null;
    });
    child.once("exit", () => {
      if (this.child === child) this.child = null;
      if (this.startupResolve || this.pending) {
        logger.error("AI runtime exited while a request was active");
      }
      this.failStartup(new AppError(503, "AI_RUNTIME_UNAVAILABLE", "The model runtime stopped."));
      this.failPending(new AppError(503, "AI_RUNTIME_UNAVAILABLE", "The model runtime stopped."));
    });

    return this.startupPromise;
  }

  private readOutput(child: ChildProcessWithoutNullStreams, chunk: Buffer): void {
    this.outputBuffer += chunk.toString("utf8");
    const lines = this.outputBuffer.split("\n");
    this.outputBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        logger.error("AI runtime returned invalid protocol data");
        this.failStartup(
          new AppError(503, "AI_RUNTIME_PROTOCOL_ERROR", "The model runtime failed."),
        );
        this.failPending(
          new AppError(503, "AI_RUNTIME_PROTOCOL_ERROR", "The model runtime failed."),
        );
        this.stopChild(child);
        continue;
      }
      if (!isRecord(value)) {
        this.failStartup(
          new AppError(503, "AI_RUNTIME_PROTOCOL_ERROR", "The model runtime failed."),
        );
        continue;
      }

      const reply = value as RuntimeReply;
      if (reply.type === "ready") {
        logger.info("MiryoLove AI model runtime is ready");
        this.startupResolve?.();
        continue;
      }
      if (reply.type === "startup_error") {
        logger.error("MiryoLove AI model failed to load");
        this.failStartup(
          new AppError(503, "AI_MODEL_LOAD_FAILED", "The MiryoLove AI model failed to load."),
        );
        this.stopChild(child);
        continue;
      }
      if (!this.pending || reply.id !== this.pending.id) {
        logger.error("AI runtime returned an unexpected response");
        continue;
      }

      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      if (
        reply.ok === true &&
        typeof reply.content === "string" &&
        Array.isArray(reply.sources) &&
        reply.sources.every(isKnowledgeSource)
      ) {
        pending.resolve({ content: reply.content, sources: reply.sources });
      } else {
        logger.error("MiryoLove AI generation failed");
        pending.reject(
          new AppError(503, "AI_GENERATION_FAILED", "MiryoLove AI could not generate a response."),
        );
      }
    }
  }

  private failStartup(error: Error): void {
    this.startupReject?.(error);
  }

  private failPending(error: Error): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(error);
    this.pending = null;
  }

  private stopChild(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return;
    this.child = null;
    this.stopping = new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
      if (!child.kill("SIGTERM")) resolve();
    });
  }
}

export const aiRuntime = new AIRuntimeService();
