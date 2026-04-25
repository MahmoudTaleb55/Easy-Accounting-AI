import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * End-to-end coverage for the delivery-alert evaluator and its routes.
 *
 * The evaluator (server/auth/email-delivery-alerts.ts) turns the failure-rate
 * trends visible on /app/settings/email-delivery into a *push* — an alert row,
 * an in-app banner, and (optionally) an owner email — when a workspace's
 * configured threshold is crossed. The four /api/auth/email-delivery-alerts/*
 * endpoints (settings GET/PUT, active GET, dismiss POST, evaluate POST) gate
 * that surface to workspace owners.
 *
 * Until this spec landed all of that was untested. A regression in the
 * threshold logic, the cooldown gate, the ratio min-samples gate, the
 * disabled flag, the owner-only role check, or the banner's dismiss
 * mutation would all be silent — admins would simply stop hearing about
 * delivery problems.
 *
 * The spec is split into three blocks, all anchored on the *dedicated*
 * workspace + dedicated owner/accountant/viewer trio seeded by
 * `email-delivery-alerts.setup.ts`. A dedicated workspace is essential:
 * the evaluator's window query unions both invitation and password-reset
 * email events for the workspace, so any sibling spec that creates
 * invitations in a shared workspace (e.g. role-based-api) would leak
 * extra failure rows into our exact-count assertions when Playwright
 * runs spec projects in parallel. Pinning each role to a single
 * membership in the dedicated workspace also keeps the banner's
 * browser-side dismiss flow deterministic — it can't easily set
 * x-company-id, so the server's "first membership" fallback must
 * unambiguously land on this workspace.
 *
 *   1. Evaluator behaviour. Seeds password-reset email events for the
 *      dedicated owner directly in the database, writes the desired
 *      settings via PUT, then drives the evaluator via POST /evaluate
 *      and asserts the structured outcome. Covers the disabled flag,
 *      the below-threshold no-op, the absolute-threshold happy path
 *      (alert row + active GET both present), the cooldown gate, the
 *      ratio min-samples gate (does NOT fire under the floor) and the
 *      ratio fire path (above the floor).
 *
 *   2. Route authorization. Both the viewer and the accountant must hit
 *      403 on every /api/auth/email-delivery-alerts/* endpoint — they're
 *      all owner-only. The owner storage state is the positive control
 *      so a regression that 403s the owner is also caught.
 *
 *   3. Frontend banner. With an alert seeded directly in the database,
 *      the owner shell must mount the banner; clicking dismiss invalidates
 *      the active query (the banner unmounts because the next /active GET
 *      returns null after the row is marked dismissed).
 *
 * The dedicated workspace is reset between tests so threshold/cooldown
 * state never leaks across cases.
 */

const ROLE_FILES = {
  owner: ".playwright/edap-owner.json",
  accountant: ".playwright/edap-accountant.json",
  viewer: ".playwright/edap-viewer.json",
} as const;

interface SharedFixture {
  companyId: number;
  ownerUserId: string;
}

let cachedShared: SharedFixture | null = null;

function readSharedFixture(): SharedFixture {
  const fixturePath = path.resolve(".playwright/email-delivery-alerts-fixture.json");
  if (!fs.existsSync(fixturePath)) {
    throw new Error(
      `Missing ${fixturePath}. Run the email-delivery-alerts-setup project first ` +
        `(it persists the dedicated company id + owner user id this spec relies on).`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Partial<SharedFixture>;
  if (!raw.companyId || !raw.ownerUserId) {
    throw new Error(`email-delivery-alerts-fixture.json missing companyId or ownerUserId`);
  }
  return { companyId: raw.companyId, ownerUserId: raw.ownerUserId };
}

async function getShared(): Promise<SharedFixture> {
  if (cachedShared) return cachedShared;
  cachedShared = readSharedFixture();
  return cachedShared;
}

function requiredDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set for the email-delivery-alerts spec.");
  return url;
}

/** Pin every API call to the dedicated workspace via x-company-id. The
 *  dedicated owner only has one membership (this workspace), so the
 *  fallback would land here too — but the explicit header keeps the
 *  intent visible and matches the pinning style in
 *  `role-based-api.spec.ts`. */
async function call(
  request: APIRequestContext,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const { companyId } = await getShared();
  const headers: Record<string, string> = { "x-company-id": String(companyId) };
  const opts: { data?: unknown; headers: Record<string, string> } = { headers };
  if (body !== undefined) {
    opts.data = body;
    opts.headers["content-type"] = "application/json";
  }
  const res = await request.fetch(url, { method, ...opts });
  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status(), body: parsed };
}

/**
 * Reset the alert state for the dedicated workspace + owner so each test
 * starts from a known floor. The dedicated `email-delivery-alerts.setup.ts`
 * gives us a workspace no other spec touches, so we can safely DELETE every
 * row that contributes to this workspace's evaluator window — settings,
 * alert history, password-reset events for the dedicated owner, and
 * invitation-side events scoped to invitations in this company. Without
 * the invitation-side wipe, any future test that mints an invitation for
 * this workspace would silently leak into the count assertions.
 */
async function resetAlertState(): Promise<void> {
  const { companyId, ownerUserId } = await getShared();
  const client = new pg.Client({ connectionString: requiredDbUrl() });
  await client.connect();
  try {
    await client.query(`DELETE FROM email_delivery_alerts WHERE company_id = $1`, [companyId]);
    await client.query(`DELETE FROM email_delivery_alert_settings WHERE company_id = $1`, [
      companyId,
    ]);
    // Invitation-side events that fall inside this workspace's evaluator
    // window. Joined via the invitation row's company_id to mirror the
    // evaluator's roll-up SQL exactly.
    await client.query(
      `DELETE FROM invitation_email_events
       WHERE invitation_id IN (SELECT id FROM invitations WHERE company_id = $1)`,
      [companyId],
    );
    // Password-reset events for the dedicated owner. Only the dedicated
    // owner contributes to *this* workspace's roll-up (they hold the only
    // membership) so this single DELETE covers every prt-side row that
    // could land in the window.
    await client.query(
      `DELETE FROM password_reset_email_events
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '8 days'`,
      [ownerUserId],
    );
  } finally {
    await client.end();
  }
}

/**
 * Seed N rows of the given type into password_reset_email_events for the
 * shared workspace's owner. The window query joins on memberships so any
 * row with this user_id counts toward the workspace's roll-up.
 */
async function seedEvents(type: string, n: number): Promise<void> {
  if (n <= 0) return;
  const { ownerUserId } = await getShared();
  const client = new pg.Client({ connectionString: requiredDbUrl() });
  await client.connect();
  try {
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < n; i++) {
      const tokenId = crypto.randomUUID();
      const off = i * 3;
      values.push(`($${off + 1}, $${off + 2}, $${off + 3})`);
      params.push(tokenId, ownerUserId, type);
    }
    await client.query(
      `INSERT INTO password_reset_email_events (token_id, user_id, type) VALUES ${values.join(
        ",",
      )}`,
      params,
    );
  } finally {
    await client.end();
  }
}

interface AlertSettings {
  enabled: boolean;
  emailEnabled: boolean;
  windowHours: number;
  absoluteThreshold: number;
  ratioThreshold: number;
  minSamplesForRatio: number;
  cooldownMinutes: number;
  // Optional per-workspace override of the dedupe / retry windows. Omitting
  // them (or sending null) leaves the env-derived fallback in effect — see
  // `getDedupeHours` / `getRetryMinutes` in server/auth/email-delivery-alerts.ts.
  // Carried on this interface so `Partial<AlertSettings>` patches in the new
  // tuning-field tests (section 5/6 below) compile without a separate type.
  dedupeHours?: number | null;
  retryMinutes?: number | null;
}

const PERMISSIVE: AlertSettings = {
  enabled: true,
  // Email side-channel off — the in-process evaluator returns ok=false from
  // the no-op transport when RESEND_API_KEY is unset, so emailSent ends up
  // false anyway, but turning emailEnabled off keeps the test laser-focused
  // on the alert-row contract.
  emailEnabled: false,
  windowHours: 24,
  absoluteThreshold: 5,
  ratioThreshold: 0.02,
  minSamplesForRatio: 20,
  cooldownMinutes: 360,
};

async function writeSettings(
  request: APIRequestContext,
  patch: Partial<AlertSettings>,
): Promise<void> {
  const merged: AlertSettings = { ...PERMISSIVE, ...patch };
  const r = await call(request, "PUT", "/api/auth/email-delivery-alerts/settings", merged);
  expect(r.status, `PUT settings should return 200, got ${r.status}: ${JSON.stringify(r.body)}`).toBe(
    200,
  );
}

interface EvaluateOutcome {
  fired: boolean;
  reason: string;
  failures: number;
  sends: number;
  windowHours: number;
  alertId?: string;
  emailSent?: boolean;
  emailRecipients?: number;
}

async function evaluate(request: APIRequestContext): Promise<EvaluateOutcome> {
  const r = await call(request, "POST", "/api/auth/email-delivery-alerts/evaluate");
  expect(r.status, `POST evaluate should return 200, got ${r.status}: ${JSON.stringify(r.body)}`).toBe(
    200,
  );
  return r.body as EvaluateOutcome;
}

// ===========================================================================
// 1) Evaluator behaviour — runs as the owner (the only role allowed to call
//    the evaluate route) and asserts the structured outcome under each
//    threshold/cooldown configuration.
// ===========================================================================
test.describe("delivery-alert evaluator @alerts", () => {
  test.use({ storageState: ROLE_FILES.owner });

  test.beforeEach(async () => {
    await resetAlertState();
  });

  test("disabled flag short-circuits the evaluator", async ({ request }) => {
    await writeSettings(request, { enabled: false });
    // Even with plenty of failures the evaluator must early-return because
    // the workspace owner explicitly turned alerts off.
    await seedEvents("bounced", 50);

    const out = await evaluate(request);
    expect(out.fired).toBe(false);
    expect(out.reason).toBe("disabled");

    // No alert row should have been written.
    const active = await call(request, "GET", "/api/auth/email-delivery-alerts/active");
    expect(active.status).toBe(200);
    expect(active.body).toBeNull();
  });

  test("no events → below_threshold, no alert row written", async ({ request }) => {
    await writeSettings(request, {});

    const out = await evaluate(request);
    expect(out.fired).toBe(false);
    expect(out.reason).toBe("below_threshold");
    expect(out.failures).toBe(0);
    expect(out.sends).toBe(0);

    const active = await call(request, "GET", "/api/auth/email-delivery-alerts/active");
    expect(active.body).toBeNull();
  });

  test("absolute threshold fires; alert + banner row appear; cooldown gates the next sweep", async ({
    request,
  }) => {
    // Set the absolute threshold to 3 and seed 3 bounces — exactly at the
    // floor (>=) so the boundary is asserted rather than only the well-
    // above-threshold case.
    await writeSettings(request, { absoluteThreshold: 3, cooldownMinutes: 360 });
    await seedEvents("bounced", 3);

    const out = await evaluate(request);
    expect(out.fired, `evaluator should fire — got ${JSON.stringify(out)}`).toBe(true);
    expect(out.reason).toBe("absolute");
    expect(out.failures).toBe(3);
    expect(out.alertId).toBeTruthy();

    // GET /active must return the row that drives the in-app banner.
    const active = await call(request, "GET", "/api/auth/email-delivery-alerts/active");
    expect(active.status).toBe(200);
    const alert = active.body as { id: string; failureCount: number; reason: string } | null;
    expect(alert).not.toBeNull();
    expect(alert!.id).toBe(out.alertId);
    expect(alert!.failureCount).toBe(3);
    expect(alert!.reason).toBe("absolute");

    // Cooldown gate: with cooldownMinutes=360 the immediate next sweep
    // must NOT fire even though the failure window is unchanged.
    const cooldownOut = await evaluate(request);
    expect(cooldownOut.fired).toBe(false);
    expect(cooldownOut.reason).toBe("in_cooldown");

    // Dismissal does NOT re-arm the cooldown — that's the point of using the
    // most recent alert (regardless of dismissedAt) as the cooldown anchor.
    const dismiss = await call(
      request,
      "POST",
      `/api/auth/email-delivery-alerts/${alert!.id}/dismiss`,
    );
    expect(dismiss.status).toBe(200);

    const stillCooled = await evaluate(request);
    expect(stillCooled.fired).toBe(false);
    expect(stillCooled.reason).toBe("in_cooldown");

    // After dismissal the active query returns null — the banner unmounts.
    const afterDismiss = await call(request, "GET", "/api/auth/email-delivery-alerts/active");
    expect(afterDismiss.body).toBeNull();
  });

  test("ratio gate respects minSamplesForRatio", async ({ request }) => {
    // Configure so the absolute rule will never trip (1000 failures needed)
    // but the ratio rule would — IF there were enough samples.
    //   ratio    = 0.5  (50%)
    //   minSamples = 20
    await writeSettings(request, {
      absoluteThreshold: 1000,
      ratioThreshold: 0.5,
      minSamplesForRatio: 20,
    });

    // Phase 1 — ratio comfortably above the floor but BELOW the min-samples
    // gate. The denominator (sends) only counts `sent`/`send_failed`/
    // `not_configured` — bounces are *not* sends, so this seed yields:
    //   failures = 5 (bounces), sends = 5 (sents) → ratio = 100%, samples = 5
    // The 20-sample gate must suppress the fire even though the ratio is
    // far above the threshold.
    await seedEvents("bounced", 5);
    await seedEvents("sent", 5);

    const lowSamples = await evaluate(request);
    expect(
      lowSamples.fired,
      `min-samples gate should suppress fire — got ${JSON.stringify(lowSamples)}`,
    ).toBe(false);
    expect(lowSamples.reason).toBe("below_threshold");
    expect(lowSamples.failures).toBe(5);
    expect(lowSamples.sends).toBe(5);

    // Phase 2 — pad both numerator and denominator until the gate is met.
    //   failures = 20 (bounces), sends = 20 (sents) → ratio = 100%, samples = 20
    // Samples now meets the 20-sample floor, ratio still well above 50%, so
    // the evaluator must fire — and the structured outcome must report the
    // ratio rule (not the absolute one — absoluteThreshold is 1000).
    await seedEvents("bounced", 15);
    await seedEvents("sent", 15);

    const aboveFloor = await evaluate(request);
    expect(
      aboveFloor.fired,
      `ratio rule should fire once min-samples is met — got ${JSON.stringify(aboveFloor)}`,
    ).toBe(true);
    expect(aboveFloor.reason).toBe("ratio");
    expect(aboveFloor.failures).toBe(20);
    expect(aboveFloor.sends).toBe(20);
  });
});

// ===========================================================================
// 2) Route authorization — every /api/auth/email-delivery-alerts/* endpoint
//    is owner-only. The viewer + accountant suites assert 403 on each.
// ===========================================================================
const NON_OWNER_ROLES: { label: "viewer" | "accountant"; storageFile: string }[] = [
  { label: "viewer", storageFile: ROLE_FILES.viewer },
  { label: "accountant", storageFile: ROLE_FILES.accountant },
];

for (const { label, storageFile } of NON_OWNER_ROLES) {
  test.describe(`delivery-alert routes are owner-only — ${label} @alerts`, () => {
    test.use({ storageState: storageFile });

    test("GET /settings → 403", async ({ request }) => {
      const r = await call(request, "GET", "/api/auth/email-delivery-alerts/settings");
      expect(r.status).toBe(403);
    });

    test("PUT /settings → 403", async ({ request }) => {
      const r = await call(request, "PUT", "/api/auth/email-delivery-alerts/settings", PERMISSIVE);
      expect(r.status).toBe(403);
    });

    test("GET /active → 403", async ({ request }) => {
      const r = await call(request, "GET", "/api/auth/email-delivery-alerts/active");
      expect(r.status).toBe(403);
    });

    test("POST /evaluate → 403", async ({ request }) => {
      const r = await call(request, "POST", "/api/auth/email-delivery-alerts/evaluate");
      expect(r.status).toBe(403);
    });

    test("POST /:id/dismiss → 403 (route gate runs before id lookup)", async ({ request }) => {
      // Use a syntactically valid id — the role gate must reject before
      // the handler ever queries the row, so a fake id is the right probe.
      const r = await call(
        request,
        "POST",
        `/api/auth/email-delivery-alerts/${crypto.randomUUID()}/dismiss`,
      );
      expect(r.status).toBe(403);
    });

    test("GET /:id/recipients → 403", async ({ request }) => {
      const r = await call(
        request,
        "GET",
        `/api/auth/email-delivery-alerts/${crypto.randomUUID()}/recipients`,
      );
      expect(r.status).toBe(403);
    });

    test("POST /:id/recipients/retry → 403", async ({ request }) => {
      const r = await call(
        request,
        "POST",
        `/api/auth/email-delivery-alerts/${crypto.randomUUID()}/recipients/retry`,
        { email: "x@example.com" },
      );
      expect(r.status).toBe(403);
    });
  });
}

// Positive control: the owner CAN call each endpoint. This catches a
// regression where the role check accidentally rejects owners too.
test.describe("delivery-alert routes accept the owner @alerts", () => {
  test.use({ storageState: ROLE_FILES.owner });

  test.beforeEach(async () => {
    await resetAlertState();
  });

  test("owner gets 200 on GET, PUT, POST evaluate, GET active", async ({ request }) => {
    expect((await call(request, "GET", "/api/auth/email-delivery-alerts/settings")).status).toBe(
      200,
    );
    expect(
      (await call(request, "PUT", "/api/auth/email-delivery-alerts/settings", PERMISSIVE)).status,
    ).toBe(200);
    expect((await call(request, "POST", "/api/auth/email-delivery-alerts/evaluate")).status).toBe(
      200,
    );
    expect((await call(request, "GET", "/api/auth/email-delivery-alerts/active")).status).toBe(200);
  });

  test("GET /:id/recipients — latest-status roll-up + attempt counts", async ({ request }) => {
    // Seed an alert with a multi-attempt history for one address (two
    // failures then a success — latest must be `sent`, attempts=3) and a
    // single-attempt failure for another address. The roll-up must
    // collapse the multi-row history to one row per email and report
    // the most recent status + total attempt count.
    const { companyId } = await getShared();
    const alertId = crypto.randomUUID();
    const client = new pg.Client({ connectionString: requiredDbUrl() });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO email_delivery_alerts
           (id, company_id, window_hours, failure_count, send_count, reason, snapshot, email_sent, email_recipients)
         VALUES ($1, $2, 24, 7, 50, 'absolute', '{}'::jsonb, true, 2)`,
        [alertId, companyId],
      );
      // Three attempts for one address — fail, fail, succeed. The
      // explicit attempted_at offsets force a deterministic ordering so
      // we can assert which attempt the DISTINCT ON keeps.
      await client.query(
        `INSERT INTO email_delivery_alert_recipients
           (alert_id, company_id, email, reason, status, error, attempted_at)
         VALUES
           ($1, $2, 'multi@example.com', 'absolute', 'failed', 'first try',  NOW() - INTERVAL '3 minutes'),
           ($1, $2, 'multi@example.com', 'absolute', 'failed', 'second try', NOW() - INTERVAL '2 minutes'),
           ($1, $2, 'multi@example.com', 'absolute', 'sent',   NULL,         NOW() - INTERVAL '1 minute'),
           ($1, $2, 'lone@example.com',  'absolute', 'failed', 'smtp 421',   NOW())`,
        [alertId, companyId],
      );
    } finally {
      await client.end();
    }

    const r = await call(
      request,
      "GET",
      `/api/auth/email-delivery-alerts/${alertId}/recipients`,
    );
    expect(r.status).toBe(200);
    const body = r.body as {
      alertId: string;
      emailSent: boolean;
      emailRecipients: number;
      recipients: Array<{
        email: string;
        status: string;
        error: string | null;
        attempts: number;
        attemptedAt: string;
      }>;
    };
    expect(body.alertId).toBe(alertId);
    expect(body.emailSent).toBe(true);
    expect(body.emailRecipients).toBe(2);
    // Two distinct email rows (the three multi@ rows collapse to one).
    expect(body.recipients).toHaveLength(2);

    const multi = body.recipients.find((x) => x.email === "multi@example.com");
    expect(multi, "multi@ should appear in the roll-up").toBeDefined();
    expect(multi!.status).toBe("sent");
    expect(multi!.attempts).toBe(3);
    expect(multi!.error).toBeNull();

    const lone = body.recipients.find((x) => x.email === "lone@example.com");
    expect(lone, "lone@ should appear in the roll-up").toBeDefined();
    expect(lone!.status).toBe("failed");
    expect(lone!.attempts).toBe(1);
    expect(lone!.error).toBe("smtp 421");
  });

  test("recipient retry guardrail — only failed addresses on this alert", async ({ request }) => {
    // Seed an alert with two recipient rows: one sent, one failed.
    const { companyId } = await getShared();
    const alertId = crypto.randomUUID();
    const client = new pg.Client({ connectionString: requiredDbUrl() });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO email_delivery_alerts
           (id, company_id, window_hours, failure_count, send_count, reason, snapshot, email_sent, email_recipients)
         VALUES ($1, $2, 24, 7, 50, 'absolute', '{}'::jsonb, true, 2)`,
        [alertId, companyId],
      );
      await client.query(
        `INSERT INTO email_delivery_alert_recipients
           (alert_id, company_id, email, reason, status, error)
         VALUES
           ($1, $2, 'guardrail-sent@example.com', 'absolute', 'sent', NULL),
           ($1, $2, 'guardrail-failed@example.com', 'absolute', 'failed', 'smtp 421')`,
        [alertId, companyId],
      );
    } finally {
      await client.end();
    }

    // 1. Unknown recipient → 404 (route refuses to send to addresses
    //    that were never on this alert's roster).
    const unknown = await call(
      request,
      "POST",
      `/api/auth/email-delivery-alerts/${alertId}/recipients/retry`,
      { email: "stranger@example.com" },
    );
    expect(unknown.status).toBe(404);

    // 2. Known recipient whose latest status is `sent` → 409 (no need
    //    to retry; sending again would bump emailRecipients without a
    //    failure to recover from).
    const alreadySent = await call(
      request,
      "POST",
      `/api/auth/email-delivery-alerts/${alertId}/recipients/retry`,
      { email: "guardrail-sent@example.com" },
    );
    expect(alreadySent.status).toBe(409);

    // 3. Missing/empty email → 400.
    const empty = await call(
      request,
      "POST",
      `/api/auth/email-delivery-alerts/${alertId}/recipients/retry`,
      {},
    );
    expect(empty.status).toBe(400);

    // 4. Cross-workspace alert id → 404 from the alert lookup, before
    //    we even hit the recipient table.
    const wrongAlert = await call(
      request,
      "POST",
      `/api/auth/email-delivery-alerts/${crypto.randomUUID()}/recipients/retry`,
      { email: "guardrail-failed@example.com" },
    );
    expect(wrongAlert.status).toBe(404);

    // 5. Failed recipient → 200 (route is reachable; the actual send
    //    may succeed or return ok:false depending on transport, both
    //    are 200 by design — we're asserting the gate passes here).
    const ok = await call(
      request,
      "POST",
      `/api/auth/email-delivery-alerts/${alertId}/recipients/retry`,
      { email: "guardrail-failed@example.com" },
    );
    expect(ok.status).toBe(200);
  });
});

// ===========================================================================
// 3) Frontend banner — owner shell mounts the banner when an active alert
//    exists, and clicking dismiss invalidates the active query so the
//    banner unmounts on the next refetch.
// ===========================================================================
test.describe("delivery-alert banner @alerts", () => {
  test.use({
    storageState: ROLE_FILES.owner,
    // The banner lives in the desktop app shell. The default 360px mobile
    // viewport collapses some chrome but the banner itself is rendered at
    // every width — still, pin a desktop width so we're asserting against
    // the same layout the owner sees in production.
    viewport: { width: 1280, height: 800 },
  });

  test.beforeEach(async () => {
    await resetAlertState();
  });

  /** Insert a fired alert directly so the banner has something to render
   *  without us having to drive the evaluator from the browser. */
  async function seedAlert(): Promise<{ id: string }> {
    const { companyId } = await getShared();
    const id = crypto.randomUUID();
    const client = new pg.Client({ connectionString: requiredDbUrl() });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO email_delivery_alerts
           (id, company_id, window_hours, failure_count, send_count, reason, snapshot, email_sent, email_recipients)
         VALUES ($1, $2, 24, 7, 50, 'absolute', $3::jsonb, false, 0)`,
        [id, companyId, JSON.stringify({ bounced: 5, complained: 1, send_failed: 1 })],
      );
    } finally {
      await client.end();
    }
    return { id };
  }

  async function gotoOwnerShell(page: Page): Promise<void> {
    // Pin locale via the `?lang=en` URL override so the headline assertion
    // is in English. We can't rely on `localStorage["app.locale"]` alone:
    // `LocaleSync` (in `client/src/components/layout/main-layout.tsx`) reads
    // the signed-in user's `preferredLocale` from `/api/auth/user` once the
    // auth query resolves and calls `setLocale()` with it, which would
    // clobber any `addInitScript`-seeded value moments after first paint.
    // The URL override is honoured by both `LocaleProvider`'s initializer
    // AND `LocaleSync`'s early-return guard, so the locale stays English
    // for the lifetime of the page. Theme is still safe to seed via
    // localStorage because nothing reconciles it from the server.
    //
    // The dedicated owner's stored `preferred_locale` is forced to 'ar' by
    // `email-delivery-alerts.setup.ts` precisely so this URL override is
    // the load-bearing piece for the English headline assertion. Don't
    // change either side in isolation — they're paired guardrails.
    await page.addInitScript(() => {
      window.localStorage.setItem("app.theme", "light");
    });
    await page.goto("/app?lang=en", { waitUntil: "domcontentloaded" });
  }

  test("renders for owners and dismisses cleanly", async ({ page }) => {
    await seedAlert();
    await gotoOwnerShell(page);

    const banner = page.locator('[data-testid="banner-email-delivery-alert"]');
    await expect(banner, "banner should appear for owners with an active alert").toBeVisible({
      timeout: 15_000,
    });

    // Headline must reflect the seeded counts so we know the data path is
    // wired (not just an empty banner shell).
    const headline = page.locator('[data-testid="text-email-delivery-alert-headline"]');
    await expect(headline).toContainText("7 email failures");
    await expect(headline).toContainText("24h");

    // Click dismiss. The mutation invalidates the active query, the next
    // fetch returns null (because dismissedAt is now set), and the banner
    // unmounts.
    await page.locator('[data-testid="button-dismiss-email-delivery-alert"]').click();
    await expect(banner, "banner should unmount after dismiss").toBeHidden({ timeout: 10_000 });

    // Belt-and-braces: the API itself must now return null for the active
    // alert. This proves dismiss didn't merely toggle local state — it
    // actually updated the row server-side.
    const after = await page.request.get("/api/auth/email-delivery-alerts/active", {
      headers: { "x-company-id": String((await getShared()).companyId) },
    });
    expect(after.status()).toBe(200);
    expect(await after.json()).toBeNull();
  });

  test("expanding the banner reveals the per-recipient delivery list", async ({ page }) => {
    const seeded = await seedAlert();

    // Seed a few per-recipient outcomes for the freshly-fired alert so the
    // expansion has something concrete to render. One sent, one failed —
    // the failed row must surface a Retry button.
    const { companyId } = await getShared();
    const client = new pg.Client({ connectionString: requiredDbUrl() });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO email_delivery_alert_recipients
           (alert_id, company_id, email, reason, status, error)
         VALUES
           ($1, $2, 'sent-recipient@example.com', 'absolute', 'sent', NULL),
           ($1, $2, 'failed-recipient@example.com', 'absolute', 'failed', 'smtp 421')`,
        [seeded.id, companyId],
      );
    } finally {
      await client.end();
    }

    await gotoOwnerShell(page);
    const banner = page.locator('[data-testid="banner-email-delivery-alert"]');
    await expect(banner).toBeVisible({ timeout: 15_000 });

    // The toggle is rendered eagerly (the recipient query is lazy though).
    const toggle = page.locator('[data-testid="button-toggle-recipients"]');
    await toggle.click();

    // Both seeded addresses must appear. We assert on the row's testid
    // rather than the localized status label so the test is locale-
    // agnostic (the rest of the surface is tested in the en/ar i18n suite).
    await expect(
      page.locator(
        '[data-testid="row-recipient-sent-recipient@example.com"]',
      ),
    ).toBeVisible();
    await expect(
      page.locator(
        '[data-testid="row-recipient-failed-recipient@example.com"]',
      ),
    ).toBeVisible();
    // The failed address must surface a Retry button; the successful one
    // must not (no need to retry a delivery that landed).
    await expect(
      page.locator(
        '[data-testid="button-retry-recipient-failed-recipient@example.com"]',
      ),
    ).toBeVisible();
    await expect(
      page.locator(
        '[data-testid="button-retry-recipient-sent-recipient@example.com"]',
      ),
    ).toHaveCount(0);
  });

  test("banner does NOT render for non-owners", async ({ browser }) => {
    // Seed an alert under the shared workspace, then visit the same shell
    // as a viewer. The component is OwnerOnly client-side AND the /active
    // endpoint is owner-gated server-side; both must combine to keep the
    // banner hidden.
    await seedAlert();
    const ctx = await browser.newContext({
      storageState: ROLE_FILES.viewer,
      viewport: { width: 1280, height: 800 },
    });
    try {
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        window.localStorage.setItem("app.locale", "en");
        window.localStorage.setItem("app.theme", "light");
      });
      await page.goto("/app", { waitUntil: "domcontentloaded" });
      // Wait for the shell to mount before asserting absence so we're not
      // racing the initial render.
      await expect(page.locator('[data-testid="app-topbar"]').first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.locator('[data-testid="banner-email-delivery-alert"]'),
      ).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 4) Dedupe + retry — locks down the per-recipient outcome contract that
//    the in-app banner and the email side-channel both depend on. Drives
//    the in-process Resend transport via a NODE_ENV-gated test stub so we
//    can simulate one address succeeding and another failing on the same
//    fire, then re-fire and assert that the dedupe gate skips the
//    already-emailed owner while the retry pass eventually clears the
//    transient failure for the other (and bumps the alert's
//    `emailRecipients` denormalized counter).
//
//    Anchored on the same dedicated workspace as block (1) so the
//    evaluator's window query stays deterministic — but provisions a
//    *second* owner-role membership at runtime (idempotently) so the
//    side-channel has two distinct addresses to drive a sent vs. failed
//    outcome on a single fire. Without that second owner the dedupe gate
//    has nothing to skip on the re-fire.
// ===========================================================================
const OWNER_A_EMAIL = "e2e-edap-owner@example.test";
const OWNER_B_EMAIL = "e2e-edap-owner-b@example.test";

interface AlertRow {
  id: string;
  emailSent: boolean;
  emailRecipients: number;
}

interface RecipientRow {
  alertId: string;
  email: string;
  status: string;
  error: string | null;
  attemptedAt: string;
}

/**
 * Provision a second owner-role membership in the dedicated workspace.
 *
 * The existing `email-delivery-alerts.setup.ts` only seats the dedicated
 * `e2e-edap-owner@...` user as the workspace's sole owner — which is
 * exactly what blocks (1)/(2)/(3) want. The dedupe + retry block here
 * needs *two* owner-role addresses so we can simulate one Resend success
 * and one failure on the same fire, so we plant a second owner-role
 * membership for `e2e-edap-owner-b@...` on first use. Idempotent: we run
 * once per spec invocation but tolerate prior runs (the user + membership
 * may already exist from a previous Playwright run that didn't reach the
 * cleanup step).
 *
 * Returns the user id so the dedicated workspace's recipient/event log
 * can be cleaned up in `beforeEach` without scanning by email.
 */
async function ensureSecondOwner(): Promise<string> {
  const { companyId } = await getShared();
  const client = new pg.Client({ connectionString: requiredDbUrl() });
  await client.connect();
  try {
    const existing = (
      await client.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [
        OWNER_B_EMAIL,
      ])
    ).rows[0];
    let uid: string;
    if (existing) {
      uid = existing.id;
    } else {
      uid = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, email, first_name, last_name, preferred_locale)
         VALUES ($1, $2, 'E2E', 'Edap-owner-b', 'en')`,
        [uid, OWNER_B_EMAIL],
      );
    }
    const member = (
      await client.query(
        `SELECT id FROM memberships WHERE user_id = $1 AND company_id = $2 LIMIT 1`,
        [uid, companyId],
      )
    ).rows[0];
    if (member) {
      await client.query(`UPDATE memberships SET role = 'owner' WHERE id = $1`, [
        member.id,
      ]);
    } else {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, role)
         VALUES ($1, $2, $3, 'owner')`,
        [crypto.randomUUID(), uid, companyId],
      );
    }
    return uid;
  } finally {
    await client.end();
  }
}

/** Tell the running server to stub the Resend transport. */
async function installEmailStub(
  request: APIRequestContext,
  failAddresses: string[],
): Promise<void> {
  const r = await request.fetch("/api/dev/email-stub", {
    method: "POST",
    headers: { "content-type": "application/json" },
    data: { failAddresses },
  });
  expect(
    r.status(),
    `installing email stub should return 200 (route is NODE_ENV-gated; failure here usually means NODE_ENV=production); got ${r.status()}`,
  ).toBe(200);
}

/** Clear any previously installed stub so the real transport takes over. */
async function clearEmailStub(request: APIRequestContext): Promise<void> {
  const r = await request.fetch("/api/dev/email-stub", {
    method: "POST",
    headers: { "content-type": "application/json" },
    data: { clear: true },
  });
  expect(r.status()).toBe(200);
}

/** Re-fire the evaluator with the dev cooldown bypass so a second / third
 *  fire in the same test doesn't have to wait six hours of wall-clock. */
async function evaluateSkippingCooldown(
  request: APIRequestContext,
): Promise<EvaluateOutcome & { emailDeduped?: number; retried?: number }> {
  const r = await call(
    request,
    "POST",
    "/api/auth/email-delivery-alerts/evaluate?skipCooldown=1",
  );
  expect(r.status, `POST evaluate?skipCooldown=1 should return 200, got ${r.status}: ${JSON.stringify(r.body)}`).toBe(
    200,
  );
  return r.body as EvaluateOutcome & { emailDeduped?: number; retried?: number };
}

/** Fetch the alert row directly so we can assert on the denormalized
 *  `email_recipients` counter the in-app banner reads. */
async function readAlert(alertId: string): Promise<AlertRow> {
  const client = new pg.Client({ connectionString: requiredDbUrl() });
  await client.connect();
  try {
    const row = (
      await client.query(
        `SELECT id, email_sent AS "emailSent", email_recipients AS "emailRecipients"
         FROM email_delivery_alerts WHERE id = $1`,
        [alertId],
      )
    ).rows[0];
    if (!row) throw new Error(`alert ${alertId} not found`);
    return {
      id: row.id,
      emailSent: row.emailSent,
      emailRecipients: row.emailRecipients,
    };
  } finally {
    await client.end();
  }
}

/** Read the per-recipient attempt log for an alert in attempt order so
 *  the test can reason about retries appended to the same alert id. */
async function readRecipients(alertId: string): Promise<RecipientRow[]> {
  const client = new pg.Client({ connectionString: requiredDbUrl() });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT alert_id AS "alertId", email, status, error,
              attempted_at AS "attemptedAt"
       FROM email_delivery_alert_recipients
       WHERE alert_id = $1
       ORDER BY attempted_at ASC, id ASC`,
      [alertId],
    );
    return result.rows as RecipientRow[];
  } finally {
    await client.end();
  }
}

test.describe("delivery-alert dedupe + retry @alerts", () => {
  test.use({ storageState: ROLE_FILES.owner });

  test.beforeAll(async () => {
    await ensureSecondOwner();
  });

  test.beforeEach(async ({ request }) => {
    // Reset evaluator state, then guarantee the stub starts cleared so a
    // failed previous run can't leak in-process state into this case.
    // `resetAlertState`'s `DELETE FROM email_delivery_alerts` cascades into
    // `email_delivery_alert_recipients` via the FK restored by migration
    // 0017, so we don't need a separate wipe of the recipients table here.
    await resetAlertState();
    await clearEmailStub(request);
  });

  test.afterAll(async ({ request }) => {
    // Don't let the stub linger past the spec — a subsequent block (or
    // the next `npx playwright test` run that reuses the dev server) must
    // see the real transport again. Best-effort: if the dev server has
    // already gone away the request just throws and we move on.
    try {
      await clearEmailStub(request);
    } catch {
      /* server gone — nothing to clear */
    }
  });

  test(
    "first fire records sent+failed; re-fire dedupes the sent owner; retry pass clears the transient failure",
    async ({ request }) => {
      // (1) Install a stub that fails owner-b on every send while letting
      //     owner-a through. This is the simulated transient outage on a
      //     single address. The stub also short-circuits the Resend HTTP
      //     call entirely so the test doesn't depend on a real provider.
      await installEmailStub(request, [OWNER_B_EMAIL]);

      // Threshold low enough for three bounces to fire absolute; cooldown
      // generous so only the explicit `?skipCooldown=1` bypass can re-fire
      // (no chance of a wall-clock race between the two evaluator calls).
      // Email side-channel ON so the recipient log + counters get written.
      await writeSettings(request, {
        absoluteThreshold: 3,
        cooldownMinutes: 360,
        emailEnabled: true,
      });
      await seedEvents("bounced", 3);

      // ---------------------------------------------------------------
      // Fire #1 — both owners attempted; one sent, one failed; alert row
      // reflects the single successful delivery.
      // ---------------------------------------------------------------
      const fire1 = (await evaluate(request)) as EvaluateOutcome & {
        emailDeduped?: number;
        retried?: number;
      };
      expect(fire1.fired, `fire #1 should trip absolute threshold — got ${JSON.stringify(fire1)}`).toBe(
        true,
      );
      expect(fire1.reason).toBe("absolute");
      expect(fire1.alertId).toBeTruthy();
      expect(fire1.emailSent, "owner-a's send should land").toBe(true);
      expect(fire1.emailRecipients, "exactly one of two owners should be counted").toBe(1);
      expect(fire1.emailDeduped, "no prior fires → nothing to dedupe").toBe(0);
      const alertId1 = fire1.alertId!;

      const recipients1 = await readRecipients(alertId1);
      expect(recipients1, "exactly one row per attempted address").toHaveLength(2);
      const a1 = recipients1.find((r) => r.email === OWNER_A_EMAIL);
      const b1 = recipients1.find((r) => r.email === OWNER_B_EMAIL);
      expect(a1, "owner-a should appear in the per-recipient log").toBeDefined();
      expect(b1, "owner-b should appear in the per-recipient log").toBeDefined();
      expect(a1!.status).toBe("sent");
      expect(a1!.error).toBeNull();
      expect(b1!.status).toBe("failed");
      expect(b1!.error, "stub error string should propagate to the row").toBe("stub_failed");

      const alert1Initial = await readAlert(alertId1);
      expect(alert1Initial.emailSent).toBe(true);
      expect(alert1Initial.emailRecipients, "alert counter mirrors per-fire success count").toBe(1);

      // ---------------------------------------------------------------
      // Fire #2 — same stub (owner-b still failing). Cooldown bypassed
      // via the dev-only query param. The dedupe gate must skip owner-a
      // (recently sent, same reason, within the 12h dedupe window) and
      // the retry pass + re-fire of owner-b must both still fail.
      // ---------------------------------------------------------------
      const fire2 = await evaluateSkippingCooldown(request);
      expect(fire2.fired, "skipCooldown bypass must allow a second fire").toBe(true);
      expect(fire2.reason).toBe("absolute");
      expect(
        fire2.emailDeduped,
        "owner-a should be skipped by the per-recipient dedupe gate",
      ).toBe(1);
      expect(
        fire2.emailRecipients,
        "owner-b is still in the failing stub set so no new successes",
      ).toBe(0);
      expect(fire2.emailSent).toBe(false);
      expect(
        fire2.retried,
        "retry pass tried owner-b but the stub still fails them, so 0 successes",
      ).toBe(0);

      // Critical contract: owner-a got NO new send on fire #2. The whole
      // point of the dedupe gate is to keep the second alert from emailing
      // them again during a flap.
      const recipientsAfterFire2 = await readRecipients(alertId1);
      const ownerASentRows = recipientsAfterFire2.filter(
        (r) => r.email === OWNER_A_EMAIL && r.status === "sent",
      );
      expect(
        ownerASentRows,
        "owner-a should still have only the one 'sent' row from fire #1",
      ).toHaveLength(1);
      // Alert #1's denormalized counter must NOT move on a re-fire — only
      // the new alert (fire #2) and any successful retries should bump it.
      const alert1AfterFire2 = await readAlert(alertId1);
      expect(alert1AfterFire2.emailRecipients).toBe(1);

      // ---------------------------------------------------------------
      // Fire #3 — clear the stub (owner-b's "transient outage" is over)
      // and re-evaluate. The retry pass should pick up the failed owner-b
      // attempts on every prior alert, succeed on each, and bump those
      // alerts' denormalized `emailRecipients` counter on success.
      // ---------------------------------------------------------------
      await installEmailStub(request, []); // empty failure list = stub but always succeed
      const fire3 = await evaluateSkippingCooldown(request);
      expect(fire3.fired, "third fire still trips because seeded events remain").toBe(true);
      // The retry pass groups by alert id; owner-b had failed rows on
      // both alert #1 and the alert that fire #2 created. With the stub
      // now succeeding for everyone, both retries land — so retried >= 2.
      expect(
        fire3.retried,
        `retry pass should re-attempt owner-b on every alert with a stuck failure (>= 2) — got ${fire3.retried}`,
      ).toBeGreaterThanOrEqual(2);

      // The original alert's counter must reflect the successful retry —
      // the in-app banner reads this denormalized field as
      // "delivered to N owners", so a retry that doesn't bump the field
      // would silently under-report deliveries.
      const alert1Final = await readAlert(alertId1);
      expect(
        alert1Final.emailRecipients,
        "alert #1's emailRecipients should now include owner-b's successful retry",
      ).toBe(2);
      expect(alert1Final.emailSent).toBe(true);

      // And the per-recipient log for alert #1 must contain a fresh
      // 'sent' row for owner-b appended after the failures — that's the
      // append-only contract the recipient roll-up reads.
      const recipientsFinal = await readRecipients(alertId1);
      const ownerBSentOnAlert1 = recipientsFinal.filter(
        (r) => r.email === OWNER_B_EMAIL && r.status === "sent",
      );
      expect(
        ownerBSentOnAlert1,
        "owner-b should now have at least one 'sent' row on alert #1 after the retry",
      ).not.toHaveLength(0);
    },
  );
});

// ===========================================================================
// 4) Recent-alerts cursor pagination — drives the `useInfiniteQuery` flow on
//    /app/settings/email-delivery (RecentAlertsCard). Seeds enough rows in
//    the dedicated workspace to force two pages, then asserts the first page
//    is exactly `RECENT_ALERTS_PAGE_SIZE`, that "Load older" advances to the
//    second page, that the row count grows past one page, and that the
//    button is replaced by the `text-no-more-alerts` terminator once the
//    cursor returns null. Locks the contract that a future refactor of
//    `listRecentEmailDeliveryAlerts` (cursor column, response shape, or the
//    `nextCursor === null` end-of-stream signal) cannot silently break the
//    "Load older" flow that owners rely on to audit alert history.
// ===========================================================================

// Mirrors `RECENT_ALERTS_PAGE_SIZE` in client/src/pages/settings/email-delivery.tsx.
// Keep in sync if the page-size constant ever changes there.
const RECENT_ALERTS_PAGE_SIZE = 20;

/**
 * Seed `count` alert rows for the dedicated workspace with strictly
 * decreasing `firedAt` timestamps. Distinct timestamps are required so the
 * keyset cursor (`lt(firedAt, before)`) produces deterministic page
 * boundaries — equal timestamps on the page edge could let a row leak onto
 * both pages or get skipped, which would make the row-count assertions
 * flaky.
 */
async function seedRecentAlerts(count: number): Promise<void> {
  if (count <= 0) return;
  const { companyId } = await getShared();
  const client = new pg.Client({ connectionString: requiredDbUrl() });
  await client.connect();
  try {
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const off = i * 3;
      values.push(
        `($${off + 1}, $${off + 2}, NOW() - ($${off + 3}::int * INTERVAL '1 minute'), 24, 3, 5, 'absolute', '{"bounced":3,"complained":0,"send_failed":0}'::jsonb, false, 0)`,
      );
      params.push(crypto.randomUUID(), companyId, i + 1);
    }
    await client.query(
      `INSERT INTO email_delivery_alerts
         (id, company_id, fired_at, window_hours, failure_count, send_count, reason, snapshot, email_sent, email_recipients)
       VALUES ${values.join(",")}`,
      params,
    );
  } finally {
    await client.end();
  }
}

test.describe("recent-alerts pagination @alerts", () => {
  test.use({
    storageState: ROLE_FILES.owner,
    // The Recent alerts table lives on the desktop settings page; pin a
    // desktop viewport so the layout (and the load-older button) is the
    // same shape an owner sees in production.
    viewport: { width: 1280, height: 800 },
  });

  test.beforeEach(async () => {
    await resetAlertState();
  });

  test("Load older fetches the next page and the no-more-alerts terminator appears at the end", async ({
    page,
  }) => {
    // Seed exactly one full page + a remainder so the second fetch comes
    // back short — that's what flips `nextCursor` to null and unmounts the
    // "Load older" button in favour of the terminator copy.
    const remainder = 5;
    const totalSeeded = RECENT_ALERTS_PAGE_SIZE + remainder;
    await seedRecentAlerts(totalSeeded);

    // Pin English via the URL override (the same trick the banner test
    // uses) so the page mounts in a known locale even though our
    // assertions only target locale-agnostic testids — it keeps the
    // headlines/buttons readable in failure screenshots.
    await page.addInitScript(() => {
      window.localStorage.setItem("app.theme", "light");
    });
    await page.goto("/app/settings/email-delivery?lang=en", {
      waitUntil: "domcontentloaded",
    });

    // The page is owner-only; if the role guard fired we'd land on
    // `email-delivery-forbidden` instead of `page-email-delivery`.
    // Asserting up front turns auth misconfiguration into a clear
    // failure rather than a confusing "table never appeared".
    await expect(
      page.getByTestId("page-email-delivery"),
      "owner should land on the email-delivery page (not the forbidden message)",
    ).toBeVisible({ timeout: 15_000 });

    // Wait for the table to mount — the card is rendered conditionally
    // on `role === "owner"` after the auth query resolves.
    await expect(page.getByTestId("table-recent-alerts")).toBeVisible({
      timeout: 15_000,
    });

    const rowLocator = page.locator('[data-testid^="row-recent-alert-"]');

    // First page must contain *exactly* one full page worth of rows. A
    // regression that drops the limit (e.g. server starts paginating by
    // 10) or that silently merges pages (e.g. an OFFSET refactor) would
    // break this exact-count assertion.
    await expect(
      rowLocator,
      `first page should render exactly ${RECENT_ALERTS_PAGE_SIZE} rows`,
    ).toHaveCount(RECENT_ALERTS_PAGE_SIZE);

    // With more rows on the server, the "Load older" affordance must be
    // visible and the terminator copy must NOT yet be on the page.
    const loadOlder = page.getByTestId("button-load-older-alerts");
    await expect(loadOlder, "Load older should be visible while more pages exist").toBeVisible();
    await expect(
      page.getByTestId("text-no-more-alerts"),
      "terminator copy should not appear until pagination is exhausted",
    ).toHaveCount(0);

    // Click through to the second page. The mutation invalidates nothing —
    // useInfiniteQuery just appends the next page in place — so we can
    // assert the row count grows past `pageSize`.
    await loadOlder.click();

    await expect(
      rowLocator,
      `after loading the next page the table should show all ${totalSeeded} seeded rows`,
    ).toHaveCount(totalSeeded);

    // Once the second page returns a short result the server emits
    // `nextCursor: null`, `hasNextPage` flips to false, and the page
    // swaps the button for the terminator copy. Both halves of that
    // swap must hold.
    await expect(
      page.getByTestId("button-load-older-alerts"),
      "Load older button should disappear once the cursor is exhausted",
    ).toHaveCount(0);
    await expect(
      page.getByTestId("text-no-more-alerts"),
      "terminator copy should appear once there are no older alerts",
    ).toBeVisible();
  });
});

// ===========================================================================
// 5) Alert tuning fields — locks down the GET shape and PUT bounds for the
//    new per-workspace `dedupeHours` / `retryMinutes` overrides surfaced on
//    the operator-facing settings card.
//
//    Until this block landed, the Playwright suite exercised every other
//    knob on the card but not these two — a refactor of the card or the
//    upsert schema could silently drop the per-workspace override (the
//    evaluator would fall back to the env value) and we'd only learn
//    about it when a customer's inbox got spammed by a flapping provider.
//
//    The override columns are nullable on purpose (legacy rows pre-date
//    them); the GET shape must reflect that with `number | null` and
//    *also* surface a numeric `effective*` fallback so the UI can show an
//    "inherited vs. custom" badge instead of silently substituting a
//    default that looks identical to a saved override. The PUT bounds
//    mirror the env-fallback clamp inside `getDedupeHours` /
//    `getRetryMinutes` (one week / one day) so a misconfigured value
//    can't permanently mute alerts.
// ===========================================================================
test.describe("delivery-alert tuning fields shape + bounds @alerts", () => {
  test.use({ storageState: ROLE_FILES.owner });

  test.beforeEach(async () => {
    await resetAlertState();
  });

  test("GET /settings exposes dedupeHours/retryMinutes (number | null) and effective fallbacks", async ({
    request,
  }) => {
    interface SettingsBody {
      dedupeHours: number | null;
      retryMinutes: number | null;
      effectiveDedupeHours: number;
      effectiveRetryMinutes: number;
    }

    // Phase 1 — fresh workspace (no settings row written). The columns
    // are nullable so the GET must surface `null` on the override fields
    // and a positive number on the effective fields (the env-derived
    // fallback the evaluator would actually use right now). Asserting
    // the env-fallback is *positive* — rather than pinning to an exact
    // 12h/60min — keeps the test robust against operators tuning the
    // process-wide defaults via env.
    const fresh = await call(request, "GET", "/api/auth/email-delivery-alerts/settings");
    expect(fresh.status).toBe(200);
    const freshBody = fresh.body as SettingsBody;
    expect(freshBody.dedupeHours, "fresh workspace: dedupeHours override is null").toBeNull();
    expect(freshBody.retryMinutes, "fresh workspace: retryMinutes override is null").toBeNull();
    expect(typeof freshBody.effectiveDedupeHours).toBe("number");
    expect(typeof freshBody.effectiveRetryMinutes).toBe("number");
    expect(freshBody.effectiveDedupeHours).toBeGreaterThan(0);
    expect(freshBody.effectiveRetryMinutes).toBeGreaterThan(0);

    // Phase 2 — write explicit overrides; GET must echo them and the
    // effective values must collapse onto the override (the evaluator
    // prefers a non-null per-workspace value over the env fallback).
    await writeSettings(request, { dedupeHours: 24, retryMinutes: 30 });
    const after = await call(request, "GET", "/api/auth/email-delivery-alerts/settings");
    expect(after.status).toBe(200);
    const afterBody = after.body as SettingsBody;
    expect(afterBody.dedupeHours).toBe(24);
    expect(afterBody.retryMinutes).toBe(30);
    expect(afterBody.effectiveDedupeHours).toBe(24);
    expect(afterBody.effectiveRetryMinutes).toBe(30);

    // Phase 3 — clear the overrides back to null. The evaluator falls
    // back to the env value again, so the effective fields go positive
    // while the override fields go null — proving the API distinguishes
    // "operator explicitly cleared" from "operator picked a value".
    await writeSettings(request, { dedupeHours: null, retryMinutes: null });
    const cleared = await call(request, "GET", "/api/auth/email-delivery-alerts/settings");
    expect(cleared.status).toBe(200);
    const clearedBody = cleared.body as SettingsBody;
    expect(clearedBody.dedupeHours, "after clearing: dedupeHours back to null").toBeNull();
    expect(clearedBody.retryMinutes, "after clearing: retryMinutes back to null").toBeNull();
    expect(typeof clearedBody.effectiveDedupeHours).toBe("number");
    expect(typeof clearedBody.effectiveRetryMinutes).toBe("number");
    expect(clearedBody.effectiveDedupeHours).toBeGreaterThan(0);
    expect(clearedBody.effectiveRetryMinutes).toBeGreaterThan(0);
  });

  test("PUT /settings enforces 0..168 dedupeHours and 0..1440 retryMinutes bounds", async ({
    request,
  }) => {
    // Boundary values inside each range must be accepted. 0 explicitly
    // disables the gate — verifying it round-trips proves the schema
    // didn't accidentally use `.positive()` instead of `.min(0)`.
    const allowed: Array<Partial<AlertSettings>> = [
      { dedupeHours: 0, retryMinutes: 0 },
      { dedupeHours: 168, retryMinutes: 1440 },
      { dedupeHours: null, retryMinutes: null },
    ];
    for (const ok of allowed) {
      const r = await call(
        request,
        "PUT",
        "/api/auth/email-delivery-alerts/settings",
        { ...PERMISSIVE, ...ok },
      );
      expect(
        r.status,
        `boundary ${JSON.stringify(ok)} should be accepted, got ${r.status}: ${JSON.stringify(r.body)}`,
      ).toBe(200);
    }

    // Just-outside values (one tick past either end of each range) must
    // be rejected. We probe both ends of both fields independently so a
    // future schema bug that swapped one bound for another (e.g. dedupe
    // accidentally clamped at 1440 like retry, or retry at 168 like
    // dedupe) is still caught here rather than only when the evaluator
    // mis-clamps in production.
    const rejected: Array<Partial<AlertSettings>> = [
      { dedupeHours: -1 },
      { dedupeHours: 169 },
      { retryMinutes: -1 },
      { retryMinutes: 1441 },
    ];
    for (const bad of rejected) {
      const r = await call(
        request,
        "PUT",
        "/api/auth/email-delivery-alerts/settings",
        { ...PERMISSIVE, ...bad },
      );
      expect(
        r.status,
        `out-of-range ${JSON.stringify(bad)} should be rejected, got ${r.status}: ${JSON.stringify(r.body)}`,
      ).toBe(400);
    }
  });
});

// ===========================================================================
// 6) dedupeHours override beats env value — proves the per-workspace column
//    drives the dedupe gate, not the EMAIL_DELIVERY_ALERT_DEDUPE_HOURS env
//    fallback. Without this assertion a refactor that accidentally read
//    only the env value would still pass every other test in this file
//    (the gate would simply use the wrong number) but operators who set
//    a non-default override would silently get the env behaviour instead
//    — the exact scenario that motivated the per-workspace column.
//
//    Mechanism: the dedupe gate consults
//    `email_delivery_alert_recipients` for any `status='sent'` row whose
//    `attempted_at` is within the configured window. We pre-seed a
//    successful "previously alerted 4h ago" row for *every* workspace
//    owner, then run two evaluator passes back-to-back with different
//    override values. The 4h-old rows are *outside* a 2h window (every
//    owner re-emailed, deduped=0) but *inside* a 12h window (every owner
//    deduped, deduped=ownerCount). Same fixture, two outcomes — driven
//    entirely by the per-workspace override.
//
//    Pre-seeding *every* owner (not just OWNER_A) keeps the assertion
//    deterministic regardless of whether section 4 — which idempotently
//    plants OWNER_B in this workspace — has already run, and uses the
//    NODE_ENV-gated email stub so the test doesn't depend on Resend.
// ===========================================================================
test.describe("delivery-alert dedupeHours override beats env @alerts", () => {
  test.use({ storageState: ROLE_FILES.owner });

  test.beforeAll(async () => {
    // Plant the second owner regardless of whether section 4 ran first,
    // so the assertion below is deterministic in isolation (e.g. when a
    // developer runs `npx playwright test -g "dedupeHours override"`).
    // Idempotent: section 4 calls the same helper. Either way, this
    // workspace ends up with the {OWNER_A, OWNER_B} owner pair the test
    // pre-seeds prior-send history for.
    await ensureSecondOwner();
  });

  test.beforeEach(async ({ request }) => {
    // Fully reset so the dedupe gate has nothing to draw on except the
    // pre-seeded "previously alerted" rows this test plants. Mirrors the
    // belt-and-braces wipe in section 4 — the production schema doesn't
    // actually carry the alert→recipient FK so prior runs of any spec
    // can leave orphaned recipient rows that would trip the gate.
    await resetAlertState();
    await wipeRecipientsForSharedCompany();
    await clearEmailStub(request);
  });

  test.afterAll(async ({ request }) => {
    // Best-effort: don't let the stub linger past this block — a later
    // spec (or the next `npx playwright test` run reusing the dev
    // server) must see the real transport again. If the dev server has
    // already gone away the request just throws and we move on.
    try {
      await clearEmailStub(request);
    } catch {
      /* server gone — nothing to clear */
    }
  });

  test("4h-old send is outside dedupeHours=2 (re-emails) but inside dedupeHours=12 (skips)", async ({
    request,
  }) => {
    // Stub Resend so every send always succeeds — we're not testing the
    // transport here, we're testing which knob drives the dedupe gate.
    await installEmailStub(request, []);

    // The workspace owner pair is fixed by `ensureSecondOwner()` (in
    // beforeAll) plus the dedicated setup — listing them once and
    // pinning both phases to the same number keeps the assertion
    // explicit instead of hard-coding "2".
    const ownerEmails = [OWNER_A_EMAIL, OWNER_B_EMAIL];
    const ownerCount = ownerEmails.length;

    // ---------------------------------------------------------------
    // Phase 1 — dedupeHours=2. Every owner has a 4h-old prior send,
    // OUTSIDE the 2h window, so the dedupe gate must NOT skip anyone.
    // ---------------------------------------------------------------
    await writeSettings(request, {
      absoluteThreshold: 3,
      cooldownMinutes: 360,
      emailEnabled: true,
      dedupeHours: 2,
    });
    await seedEvents("bounced", 3);
    for (const email of ownerEmails) {
      await seedRecipientHistory({ email, hoursAgo: 4 });
    }

    const fire1 = (await evaluate(request)) as EvaluateOutcome & {
      emailDeduped?: number;
    };
    expect(
      fire1.fired,
      `phase 1: evaluator should fire — got ${JSON.stringify(fire1)}`,
    ).toBe(true);
    expect(
      fire1.emailRecipients,
      `dedupeHours=2 must NOT skip a 4h-old send for any owner — got ${JSON.stringify(fire1)}`,
    ).toBe(ownerCount);
    expect(fire1.emailDeduped, "phase 1: nothing deduped under the 2h window").toBe(0);
    expect(fire1.emailSent, "phase 1: every owner emailed").toBe(true);

    // Reset between phases — we need the dedupe-gate input to be EXACTLY
    // the pre-seeded 4h-old rows, not the fresh `attempted_at = NOW()`
    // rows that fire #1 just appended (which would suppress the owners
    // under dedupeHours=12 *regardless* of the per-workspace override
    // and prove nothing). Same workspace, same owners, same fixture.
    await resetAlertState();
    await wipeRecipientsForSharedCompany();

    // ---------------------------------------------------------------
    // Phase 2 — dedupeHours=12. Pre-seeded sends are still 4h old,
    // INSIDE the 12h window, so the dedupe gate must skip every owner.
    // The alert row itself still gets written (the gate is per-email,
    // not per-alert), but `emailRecipients` collapses to 0 and
    // `emailDeduped` rises to ownerCount — that's how we prove the
    // override value, not the env fallback, drove the outcome.
    // ---------------------------------------------------------------
    await writeSettings(request, {
      absoluteThreshold: 3,
      cooldownMinutes: 360,
      emailEnabled: true,
      dedupeHours: 12,
    });
    await seedEvents("bounced", 3);
    for (const email of ownerEmails) {
      await seedRecipientHistory({ email, hoursAgo: 4 });
    }

    const fire2 = (await evaluate(request)) as EvaluateOutcome & {
      emailDeduped?: number;
    };
    expect(
      fire2.fired,
      `phase 2: evaluator still fires (alert row); only the email side is deduped — got ${JSON.stringify(fire2)}`,
    ).toBe(true);
    expect(
      fire2.emailRecipients,
      `dedupeHours=12 must skip a 4h-old send for every owner — got ${JSON.stringify(fire2)}`,
    ).toBe(0);
    expect(
      fire2.emailDeduped,
      "phase 2: every owner skipped by the 12h window",
    ).toBe(ownerCount);
    expect(
      fire2.emailSent,
      "phase 2: no successful sends because every owner was deduped",
    ).toBe(false);
  });
});

/**
 * Insert a successful per-recipient outcome row with a controlled
 * `attempted_at`, so the dedupe gate has a deterministic "previously
 * alerted N hours ago" record to consult.
 *
 * The dedupe lookup (`listRecentlyAlertedRecipients`) hits the
 * `(company_id, reason, email, attempted_at)` index and never joins back
 * to the parent alert row, so the `alert_id` value is allowed to be a
 * synthetic UUID with no matching `email_delivery_alerts` row — that's
 * also why this seeder doesn't bother creating one.
 */
async function seedRecipientHistory(opts: {
  email: string;
  hoursAgo: number;
  reason?: "absolute" | "ratio";
}): Promise<void> {
  const { companyId } = await getShared();
  const reason = opts.reason ?? "absolute";
  const client = new pg.Client({ connectionString: requiredDbUrl() });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO email_delivery_alert_recipients
         (alert_id, company_id, email, reason, status, error, attempted_at)
       VALUES ($1, $2, $3, $4, 'sent', NULL,
               NOW() - ($5::int * INTERVAL '1 hour'))`,
      [
        crypto.randomUUID(),
        companyId,
        opts.email.trim().toLowerCase(),
        reason,
        opts.hoursAgo,
      ],
    );
  } finally {
    await client.end();
  }
}
