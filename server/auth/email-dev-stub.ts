/**
 * Dev-only email transport stub.
 *
 * Exposes the test hook used by the email delivery-alert dedupe + retry
 * e2e block (`tests/e2e/email-delivery-alerts.spec.ts`) to drive
 * `sendEmail` to a deterministic per-address outcome (success or
 * `send_failed`) without standing up a real Resend account or talking
 * to the network.
 *
 * Why this lives in its own module: production code (`server/auth/email.ts`,
 * `server/auth/local-routes.ts`, ...) MUST NOT import `setEmailTestStub`
 * /  `getEmailTestStub`. Even though the route handler that exposes the
 * stub is gated by `NODE_ENV !== "production"`, having the setter in a
 * production module's export surface meant a future refactor could
 * accidentally call it and poison the live transport state for every
 * workspace. By keeping the setter / getter in this dev-only module and
 * only importing it from the `if (NODE_ENV !== "production")` branch
 * inside `registerLocalAuthRoutes`, esbuild's NODE_ENV define
 * (`script/build.ts`) tree-shakes the entire module out of the
 * production bundle.
 *
 * The state itself is held under a process-wide
 * `Symbol.for("tahasab.auth.email.testStub")` so that `sendEmail` in
 * `server/auth/email.ts` can read it WITHOUT importing this module.
 * That keeps the production read-path inert: with no setter ever
 * called, the global slot is `undefined` and `sendEmail` falls through
 * to the real Resend transport (or the `not_configured` no-op).
 */

import type { Express, Request, Response } from "express";

export type EmailTestStub = {
  failAddresses: Set<string>;
};

/**
 * Process-wide key for the test-stub state. Both this module and
 * `server/auth/email.ts` reach for the same key — the production read
 * path in `email.ts` does NOT import this module, so even if the dev
 * stub is never loaded the read is harmless (returns `null`).
 */
export const EMAIL_TEST_STUB_KEY = Symbol.for(
  "tahasab.auth.email.testStub",
);

type GlobalSlot = { [EMAIL_TEST_STUB_KEY]?: EmailTestStub | null };

function slot(): GlobalSlot {
  return globalThis as unknown as GlobalSlot;
}

/**
 * Install (or clear) the in-memory transport stub.
 *
 * Passing `null` clears it so `sendEmail` falls back to the real
 * Resend transport. Passing `{ failAddresses }` causes every send
 * matching one of those addresses (case-insensitive) to resolve as
 * `send_failed`; every other send resolves as `ok`.
 */
export function setEmailTestStub(
  opts: { failAddresses: string[] } | null,
): void {
  if (opts === null) {
    slot()[EMAIL_TEST_STUB_KEY] = null;
    return;
  }
  slot()[EMAIL_TEST_STUB_KEY] = {
    failAddresses: new Set(
      opts.failAddresses.map((e) => e.trim().toLowerCase()),
    ),
  };
}

export function getEmailTestStub(): EmailTestStub | null {
  return slot()[EMAIL_TEST_STUB_KEY] ?? null;
}

/**
 * Register `POST /api/dev/email-stub` on the given Express app.
 *
 * Called only from the `NODE_ENV !== "production"` branch in
 * `registerLocalAuthRoutes`. In production the route is never
 * registered at all, so Express's terminal middleware returns the
 * default 404 — the route handler closure (and the `setEmailTestStub`
 * call inside it) does not exist in the running process.
 *
 * Body shape:
 *   { failAddresses: string[] }   install — listed addresses fail, others succeed
 *   { clear: true }               clear   — falls back to the real transport
 */
export function registerEmailStubDevRoute(app: Express): void {
  app.post("/api/dev/email-stub", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      failAddresses?: unknown;
      clear?: unknown;
    };
    if (body.clear === true) {
      setEmailTestStub(null);
      return res.json({ ok: true, cleared: true });
    }
    const failAddresses = Array.isArray(body.failAddresses)
      ? body.failAddresses.filter((x): x is string => typeof x === "string")
      : [];
    setEmailTestStub({ failAddresses });
    res.json({ ok: true, failAddresses });
  });
}
