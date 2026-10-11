import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/utils/password.js";

describe("password hashing", () => {
  it("stores an Argon2 hash and verifies only the original password", async () => {
    const password = "correct horse battery staple";
    const hash = await hashPassword(password);
    expect(hash).not.toBe(password);
    expect(hash.startsWith("$argon2id$")).toBe(true);
    await expect(verifyPassword(hash, password)).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
    await expect(verifyPassword(null, password)).resolves.toBe(false);
  });
});
