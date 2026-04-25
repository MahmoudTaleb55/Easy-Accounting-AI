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
    // Pin locale so the headline assertion is in English.
    await page.addInitScript(() => {
      window.localStorage.setItem("app.locale", "en");
      window.localStorage.setItem("app.theme", "light");
    });
    await page.goto("/app", { waitUntil: "domcontentloaded" });
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
