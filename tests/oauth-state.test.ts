import { describe, expect, it } from "vitest";
import { validateOAuthState } from "../src/services/oauth.service.js";

describe("OAuth state validation", () => {
  it("accepts only an exact query/cookie state match", () => {
    expect(validateOAuthState("same-random-state", "same-random-state")).toBe(true);
    expect(validateOAuthState("different-state", "another-state")).toBe(false);
    expect(validateOAuthState(undefined, "state")).toBe(false);
    expect(validateOAuthState("state", undefined)).toBe(false);
  });
});
