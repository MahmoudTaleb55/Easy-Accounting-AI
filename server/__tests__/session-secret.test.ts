import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * H2 (auth hardening): resolveSessionSecret must FAIL FAST in production when
 * SESSION_SECRET is missing or too weak, instead of the old silent
 * `process.env.SESSION_SECRET!` non-null assertion that let the server boot
 * with an undefined/forgeable signing key.
 *
 * These are pure-logic assertions over environment variables — no database or
 * network is touched. (Importing ../setup pulls in ../db, which reads
 * DATABASE_URL at import time; the vitest setup file loads .env so that import
 * succeeds, but this test itself does not use the database.)
 */

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_SECRET = process.env.SESSION_SECRET;

let resolveSessionSecret: typeof import("../setup").resolveSessionSecret;

beforeEach(async () => {
  ({ resolveSessionSecret } = await import("../setup"));
});

afterEach(() => {
  // Restore the ambient env so we don't leak state into other tests.
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_SECRET === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = ORIGINAL_SECRET;
});

describe("resolveSessionSecret (H2 fail-fast)", () => {
  it("throws in production when SESSION_SECRET is missing", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SESSION_SECRET;
    expect(() => resolveSessionSecret()).toThrow(/SESSION_SECRET must be set/);
  });

  it("throws in production when SESSION_SECRET is too short", () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "short";
    expect(() => resolveSessionSecret()).toThrow(/at least 32 characters/);
  });

  it("accepts a sufficiently long secret in production", () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "a".repeat(32);
    expect(resolveSessionSecret()).toBe("a".repeat(32));
  });

  it("generates a random, non-hardcoded dev fallback when unset", () => {
    // SECURITY (scan finding f-df04487b, DEFAULT_CREDENTIALS): the dev
    // fallback used to be the hardcoded literal "dev-only-insecure-session-
    // secret-change-me", which meant any session could be forged from a value
    // committed in the source tree. It is now a per-process random secret.
    process.env.NODE_ENV = "development";
    delete process.env.SESSION_SECRET;
    const secret = resolveSessionSecret();
    // No longer the committed constant.
    expect(secret).not.toContain("dev-only");
    // High-entropy: 32 random bytes rendered as 64 hex chars.
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    // Two calls must not return the same value — proves it's generated, not
    // a shared constant an attacker could predict.
    expect(resolveSessionSecret()).not.toBe(secret);
  });

  it("uses the provided secret in development even if short", () => {
    process.env.NODE_ENV = "development";
    process.env.SESSION_SECRET = "shortdev";
    expect(resolveSessionSecret()).toBe("shortdev");
  });
});
