/**
 * Locks the test-only email-stub mechanism (and the NODE_ENV-gated
 * `?skipCooldown=1` query parameter on the evaluator route) off in a
 * production build.
 *
 * Background: task #130 added two NODE_ENV gates so the dedupe + retry
 * e2e block could simulate per-address Resend success / failure without
 * a real provider:
 *
 *   1. `POST /api/dev/email-stub` (registered by
 *      `server/auth/email-dev-stub.ts` via the dev-only branch in
 *      `registerLocalAuthRoutes`) installs / clears an in-memory
 *      transport stub via `setEmailTestStub` / `getEmailTestStub`.
 *      Defense-in-depth (task #242): the route is NOT REGISTERED at
 *      all in production — Express's terminal middleware returns the
 *      default 404 instead of a custom in-handler 404 — and the
 *      setter / getter live in a dev-only module that the production
 *      bundle never loads.
 *   2. `POST /api/auth/email-delivery-alerts/evaluate?skipCooldown=1`
 *      bypasses the per-workspace cooldown so a single test case can
 *      re-fire the evaluator twice. Also gated to non-production.
 *
 * Without an automated check, a future refactor could accidentally
 * expose either of these in a published deployment — letting an
 * attacker (or a confused operator) poison the live transport state
 * for every workspace, or spam owners by re-firing the alert
 * evaluator inside the cooldown window. This spec wires up the actual
 * `registerLocalAuthRoutes` route table in-process under
 * `NODE_ENV=production` so a regression to either gate fails CI loudly.
 *
 * Why the email-stub case uses the real route while the skipCooldown
 * case uses the exported helper: the email-stub case asserts that the
 * route does not exist on the registered Express app at all (so the
 * default 404 is the signal), which can be exercised with a no-op
 * auth shim. The evaluator route runs `requireAuth` +
 * `requireRole("owner")` and then calls into the DB (which is
 * RLS-scoped to the signed-in user); rather than forge a full session
 * for a one-line gate, the gate itself is extracted into
 * `readDevSkipCooldownFromQuery` and asserted directly. The route
 * handler itself uses that helper, so the assertions cover the same
 * production behaviour.
 */

// IMPORTANT: pin NODE_ENV before any server module import so the
// route + helper see the intended value. The route reads NODE_ENV at
// request-time and the helper reads it at call-time, so this assignment
// running before the require/import resolution is what makes the
// production gate active for the rest of the file.
process.env.NODE_ENV = "production";

import { test, expect } from "@playwright/test";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  registerLocalAuthRoutes,
  readDevSkipCooldownFromQuery,
} from "../../server/auth/local-routes";
// Import the setter / getter from the dev-only module — task #242 moved
// them out of `server/auth/email.ts` so production code can no longer
// reach them. The spec is itself a test artefact (not production code),
// so loading the dev module here is fine; the assertions below verify
// that the in-process route did NOT install / clear / mutate any state
// when running under `NODE_ENV=production`.
import {
  getEmailTestStub,
  setEmailTestStub,
} from "../../server/auth/email-dev-stub";

let server: http.Server;
let baseUrl = "";

/**
 * Build a minimal Express app that hosts only the routes registered by
 * `registerLocalAuthRoutes`. A no-op middleware fakes
 * `req.isAuthenticated()` and seeds `req.user` + `req.membership` so
 * any route guarded by `requireAuth` / `requireRole` could run if we
 * decided to test it — the email-stub route doesn't actually use them
 * (the production gate runs first), but registering this shim keeps
 * the spec's auth surface obvious.
 */
async function startApp(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.isAuthenticated = () => true;
    req.user = {
      _local: true,
      claims: {
        sub: "test-user-prod-gate",
        email: "prod-gate@example.test",
        first_name: null,
        last_name: null,
        profile_image_url: null,
      },
    };
    (req as any).membership = {
      userId: "test-user-prod-gate",
      companyId: 1,
      role: "owner",
    };
    next();
  });
  registerLocalAuthRoutes(app);
  const s = await new Promise<http.Server>((resolve) => {
    const ss = app.listen(0, "127.0.0.1", () => resolve(ss));
  });
  const addr = s.address() as AddressInfo;
  return { server: s, baseUrl: `http://127.0.0.1:${addr.port}` };
}

test.describe.configure({ mode: "serial" });

test.describe("dev-only routes are gated off in production", () => {
  test.beforeAll(async () => {
    const started = await startApp();
    server = started.server;
    baseUrl = started.baseUrl;
  });

  test.afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
    // Belt-and-braces — defensively clear the stub even though the
    // production-gated route should never have installed one.
    setEmailTestStub(null);
  });

  test.beforeEach(() => {
    setEmailTestStub(null);
  });

  test("POST /api/dev/email-stub install returns 404 and does not install the stub", async () => {
    expect(getEmailTestStub()).toBeNull();
    const res = await fetch(`${baseUrl}/api/dev/email-stub`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        failAddresses: ["should-not-fail@example.test"],
      }),
    });
    expect(res.status).toBe(404);
    // Task #242: the route is no longer registered at all in
    // production, so the response is Express's terminal 404 — not the
    // (now-removed) custom in-handler 404. Asserting the default body
    // proves the request reached Express's terminal middleware rather
    // than any route-specific code path.
    expect(await res.text()).toContain("Cannot POST /api/dev/email-stub");
    // The crucial invariant: even though the request was syntactically a
    // valid install payload, no route handler exists to even reach
    // `setEmailTestStub` — so the stub state is unchanged.
    expect(getEmailTestStub()).toBeNull();
  });

  test("POST /api/dev/email-stub clear returns 404 and does not clear an existing stub", async () => {
    // Pre-install a stub state out-of-band (simulating, e.g., test
    // infrastructure or an in-memory artefact from a sibling worker).
    // The production-gated route must not be able to clear it from a
    // crafted client request — that's a different threat (state
    // tampering rather than state injection) but uses the same gate.
    setEmailTestStub({ failAddresses: ["seeded@example.test"] });
    const before = getEmailTestStub();
    expect(before).not.toBeNull();

    const res = await fetch(`${baseUrl}/api/dev/email-stub`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clear: true }),
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Cannot POST /api/dev/email-stub");
    // Stub state untouched — there is no registered route, so Express's
    // terminal 404 fires before any mutation could occur.
    const after = getEmailTestStub();
    expect(after).not.toBeNull();
    expect(after).toBe(before);
  });

  test("POST /api/dev/email-stub with an empty body still returns 404", async () => {
    // Defends against a refactor that re-introduces the route under a
    // different (or missing) gate. A bodyless request used to be the
    // most subtle regression — falsy `clear` + missing `failAddresses`
    // collapses to `setEmailTestStub({ failAddresses: [] })`, silently
    // CLEARING any pre-installed stub. With the route physically
    // absent in production, the request hits Express's terminal 404
    // and the pre-installed stub is preserved.
    setEmailTestStub({ failAddresses: ["seeded@example.test"] });
    const res = await fetch(`${baseUrl}/api/dev/email-stub`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Cannot POST /api/dev/email-stub");
    expect(getEmailTestStub()).not.toBeNull();
  });

  test("readDevSkipCooldownFromQuery returns false in production for every truthy query value", () => {
    // The route handler delegates to this helper. In production it must
    // ignore every shape the dedupe + retry e2e block legitimately
    // sends so a real workspace can never bypass the cooldown by
    // crafting `?skipCooldown=...` against a published deployment.
    expect(process.env.NODE_ENV).toBe("production");
    expect(readDevSkipCooldownFromQuery({ skipCooldown: "1" })).toBe(false);
    expect(readDevSkipCooldownFromQuery({ skipCooldown: "true" })).toBe(false);
    // Any other truthy or falsy value is also false, but those would
    // already be false in dev — the meaningful regression here is that
    // the values that DO bypass cooldown in dev are *not* honored in
    // prod.
    expect(readDevSkipCooldownFromQuery({})).toBe(false);
    expect(readDevSkipCooldownFromQuery({ skipCooldown: "0" })).toBe(false);
    expect(readDevSkipCooldownFromQuery({ skipCooldown: undefined })).toBe(
      false,
    );
  });

  test("readDevSkipCooldownFromQuery honors the bypass in non-production NODE_ENV", () => {
    // Negative control: prove the gate is the only thing keeping the
    // bypass off. Without this, a refactor that hard-codes `false`
    // would still pass the production assertions above while silently
    // breaking the dedupe + retry e2e block. Restore NODE_ENV in a
    // try/finally so a thrown assertion below can't leak the dev
    // value into the next test.
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      expect(readDevSkipCooldownFromQuery({ skipCooldown: "1" })).toBe(true);
      expect(readDevSkipCooldownFromQuery({ skipCooldown: "true" })).toBe(true);
      // Any other value (or absent) is still false — the bypass is
      // explicit, not accidental.
      expect(readDevSkipCooldownFromQuery({})).toBe(false);
      expect(readDevSkipCooldownFromQuery({ skipCooldown: "yes" })).toBe(false);
      expect(readDevSkipCooldownFromQuery({ skipCooldown: 1 as unknown })).toBe(
        false,
      );
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
