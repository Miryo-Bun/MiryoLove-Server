import argon2 from "argon2";
import { describe, expect, it, vi } from "vitest";
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

  it("performs dummy Argon2 verification when a password hash is missing or malformed", async () => {
    const verify = vi.spyOn(argon2, "verify");

    try {
      await expect(verifyPassword(null, "some password")).resolves.toBe(false);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0]?.[0]).toMatch(/^\$argon2id\$/);

      verify.mockClear();
      await expect(verifyPassword("not-an-argon2-hash", "some password")).resolves.toBe(false);
      expect(verify).toHaveBeenCalledTimes(2);
      expect(verify.mock.calls[1]?.[0]).toMatch(/^\$argon2id\$/);
    } finally {
      verify.mockRestore();
    }
  });
});
