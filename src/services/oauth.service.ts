import { timingSafeEqual } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { prisma } from "../config/prisma.js";
import type {
  AuthServiceContract,
  OAuthServiceContract,
  SessionResult,
} from "../types/contracts.js";
import { AppError } from "../utils/errors.js";

interface OAuthProfile {
  providerAccountId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

interface OAuthSettings {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

function settings(provider: "google" | "yandex"): OAuthSettings {
  return provider === "google"
    ? {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackUrl: env.GOOGLE_CALLBACK_URL,
      }
    : {
        clientId: env.YANDEX_CLIENT_ID,
        clientSecret: env.YANDEX_CLIENT_SECRET,
        callbackUrl: env.YANDEX_CALLBACK_URL,
      };
}

export function validateOAuthState(
  queryState: string | undefined,
  cookieState: string | undefined,
): boolean {
  if (!queryState || !cookieState) return false;
  const query = Buffer.from(queryState);
  const cookie = Buffer.from(cookieState);
  return query.length === cookie.length && timingSafeEqual(query, cookie);
}

async function fetchJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new AppError(502, "OAUTH_PROVIDER_ERROR", "The identity provider request failed.");
  }
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(502, "OAUTH_PROVIDER_ERROR", "The identity provider returned invalid data.");
  }
  return body as Record<string, unknown>;
}

async function loadProfile(
  provider: "google" | "yandex",
  code: string,
  config: OAuthSettings,
): Promise<OAuthProfile> {
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.callbackUrl,
  });
  const tokenUrl =
    provider === "google" ? "https://oauth2.googleapis.com/token" : "https://oauth.yandex.ru/token";
  const tokenData = await fetchJson(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  });
  if (typeof tokenData.access_token !== "string") {
    throw new AppError(502, "OAUTH_PROVIDER_ERROR", "The identity provider did not issue a token.");
  }

  if (provider === "google") {
    const profile = await fetchJson("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${tokenData.access_token}` },
    });
    if (
      typeof profile.sub !== "string" ||
      typeof profile.email !== "string" ||
      profile.email_verified !== true
    ) {
      throw new AppError(502, "OAUTH_PROFILE_UNAVAILABLE", "A verified email was not provided.");
    }
    return {
      providerAccountId: profile.sub,
      email: profile.email,
      displayName: typeof profile.name === "string" ? profile.name : profile.email.split("@")[0]!,
      avatarUrl: typeof profile.picture === "string" ? profile.picture : null,
    };
  }

  const profile = await fetchJson("https://login.yandex.ru/info?format=json", {
    headers: { authorization: `OAuth ${tokenData.access_token}` },
  });
  const email =
    typeof profile.default_email === "string"
      ? profile.default_email
      : Array.isArray(profile.emails) && typeof profile.emails[0] === "string"
        ? profile.emails[0]
        : undefined;
  if (typeof profile.id !== "string" || !email) {
    throw new AppError(502, "OAUTH_PROFILE_UNAVAILABLE", "An email was not provided.");
  }
  const displayName =
    typeof profile.display_name === "string"
      ? profile.display_name
      : typeof profile.real_name === "string"
        ? profile.real_name
        : email.split("@")[0]!;
  return {
    providerAccountId: profile.id,
    email,
    displayName,
    avatarUrl:
      typeof profile.default_avatar_id === "string"
        ? `https://avatars.yandex.net/get-yapic/${encodeURIComponent(profile.default_avatar_id)}/islands-200`
        : null,
  };
}

export class OAuthService implements OAuthServiceContract {
  constructor(private readonly authService: Pick<AuthServiceContract, "createSession">) {}

  isConfigured(provider: "google" | "yandex"): boolean {
    const config = settings(provider);
    return Boolean(config.clientId && config.clientSecret);
  }

  getAuthorizationUrl(provider: "google" | "yandex", state: string): string {
    const config = settings(provider);
    if (!this.isConfigured(provider)) {
      throw new AppError(503, "OAUTH_NOT_CONFIGURED", `${provider} sign-in is not configured.`);
    }
    const url =
      provider === "google"
        ? new URL("https://accounts.google.com/o/oauth2/v2/auth")
        : new URL("https://oauth.yandex.ru/authorize");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      response_type: "code",
      scope: provider === "google" ? "openid email profile" : "login:email login:info",
      state,
    }).toString();
    return url.toString();
  }

  async authenticate(provider: "google" | "yandex", code: string): Promise<SessionResult> {
    const config = settings(provider);
    if (!this.isConfigured(provider)) {
      throw new AppError(503, "OAUTH_NOT_CONFIGURED", `${provider} sign-in is not configured.`);
    }
    let profile: OAuthProfile;
    try {
      profile = await loadProfile(provider, code, config);
    } catch (error) {
      logger.warn(
        { provider, event: "oauth_profile_exchange_failed" },
        "OAuth profile exchange failed",
      );
      throw error;
    }
    try {
      const account = await prisma.oAuthAccount.findUnique({
        where: {
          provider_providerAccountId: {
            provider,
            providerAccountId: profile.providerAccountId,
          },
        },
        select: { userId: true },
      });
      if (account) return this.authService.createSession(account.userId);

      const existingUser = await prisma.user.findUnique({
        where: { email: profile.email.trim().toLowerCase() },
        select: { id: true },
      });
      if (existingUser) {
        throw new AppError(
          409,
          "ACCOUNT_LINKING_REQUIRED",
          "This email belongs to an existing account. Sign in first to link this provider.",
        );
      }

      const user = await prisma.user.create({
        data: {
          email: profile.email.trim().toLowerCase(),
          displayName: profile.displayName.slice(0, 80),
          avatarUrl: profile.avatarUrl,
          oauthAccounts: {
            create: { provider, providerAccountId: profile.providerAccountId },
          },
        },
        select: { id: true },
      });
      return this.authService.createSession(user.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const account = await prisma.oAuthAccount.findUnique({
          where: {
            provider_providerAccountId: {
              provider,
              providerAccountId: profile.providerAccountId,
            },
          },
          select: { userId: true },
        });
        if (account) return this.authService.createSession(account.userId);
        throw new AppError(
          409,
          "ACCOUNT_LINKING_REQUIRED",
          "This account cannot be linked automatically.",
        );
      }
      logger.warn(
        { provider, event: "oauth_authentication_failed" },
        "OAuth authentication failed",
      );
      throw error;
    }
  }
}
