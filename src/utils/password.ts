import { randomBytes } from "node:crypto";
import argon2 from "argon2";

const dummyHash = argon2.hash(randomBytes(32).toString("hex"), { type: argon2.argon2id });

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  if (typeof password !== "string") return false;

  if (typeof hash !== "string" || hash.length === 0) {
    await argon2.verify(await dummyHash, password);
    return false;
  }

  try {
    return await argon2.verify(hash, password);
  } catch {
    await argon2.verify(await dummyHash, password);
    return false;
  }
}
