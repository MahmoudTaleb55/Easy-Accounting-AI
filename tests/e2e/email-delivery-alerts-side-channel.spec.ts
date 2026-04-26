/**
 * Integration coverage for the email side-channel inside
 * `evaluateEmailDeliveryAlertsForCompany` (server/auth/email-delivery-alerts.ts,
 * lines ~99–156). The companion e2e suite
 * (`email-delivery-alerts.spec.ts`) deliberately turns `emailEnabled` off
 * so its evaluator assertions don't depend on a live Resend account, which
 * leaves the side-channel — owner lookup, locale heuristic, link
 * composition, the per-recipient `sendEmailDeliveryAlertEmail` call, and
 * the `emailSent` / `emailRecipients` counters persisted on the alert row
 * — completely untested. A regression there is silent: admins simply stop
 * receiving the alert *email*, while the in-app banner keeps working.
 *
 * This spec runs the evaluator *in-process* (it imports the module
 * directly) so it can swap in a fetch stub for the Resend HTTP API
 * without touching production code or needing a network. The alert tables
 * (`email_delivery_alerts`, `email_delivery_alert_settings`,
 * `email_delivery_alert_recipients`) are not RLS-protected, so wrapping
 * the evaluator call in `withRlsBypass` mirrors how the production sweep
 * runs (`runEmailDeliveryAlertSweep`) and keeps the in-process behaviour
 * faithful to the cron path.
 *
 * Coverage matrix:
 *   1. Success — `emailEnabled=true` + healthy transport: one Resend call
 *      per owner, `emailSent=true`, `emailRecipients=N`, both persisted on
 *      the alert row, and per-recipient `sent` rows in
 *      `email_delivery_alert_recipients`.
 *   2. Transport failure — fetch stub returns 500 for every owner: alert
 *      row is still written, `emailSent=false`, `emailRecipients=0`, every
 *      attempt logged as `failed` so the retry pass on the next sweep can
 *      pick them up.
 *   3. Fetch throw — fetch stub throws (simulates a network error,
 *      different code path than a 500 response): same contract as #2 plus
 *      the evaluator must not propagate the error to the caller.
 *   4. Locale heuristic — first owner with `preferredLocale='en'` produces
 *      an English subject; the default Arabic owner (preferredLocale set
 *      to 'ar') produces the Arabic one.
 *
 * The dedicated workspace + owners are created by this spec (not shared
 * with `email-delivery-alerts.setup.ts`) so it can pin one owner to each
 * locale and tear down without disturbing any sibling spec.
 */

// IMPORTANT: This must be set before *any* server module imports. Even
// though `sendEmail` reads `process.env.RESEND_API_KEY` at call-time
// (so a later assignment would still flow through), keeping this at the
// very top makes the test's dependency on the env explicit and avoids
// any future module-level cache from observing an unset value.
process.env.RESEND_API_KEY = "test_eda_sidechannel_stub";

import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import pg from "pg";
import { evaluateEmailDeliveryAlertsForCompany } from "../../server/auth/email-delivery-alerts";
import { withRlsBypass, pool } from "../../server/db";
import { ensureUser, requireDbUrl } from "./_helpers/forge-session";

const RESEND_URL = "https://api.resend.com/emails";

interface CapturedRequest {
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
}

type StubMode = "ok" | "fail-status" | "fail-throw";

let captured: CapturedRequest[] = [];
let stubMode: StubMode = "ok";
let originalFetch: typeof globalThis.fetch | null = null;

function installFetchStub(): void {
  if (originalFetch) return;
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    if (urlStr === RESEND_URL) {
      const raw =
        init?.body && typeof init.body === "string"
          ? init.body
          : "{}";
      const parsed = JSON.parse(raw) as {
        from: string;
        to: string[];
        subject: string;
        html: string;
        text?: string;
      };
      captured.push({
        from: parsed.from,
        to: parsed.to[0],
        subject: parsed.subject,
        html: parsed.html,
        text: parsed.text,
      });
      if (stubMode === "fail-throw") {
        throw new Error("simulated network failure");
      }
      if (stubMode === "fail-status") {
        return new Response("simulated upstream error", { status: 502 });
      }
      const id = `stub_${captured.length}`;
      return new Response(JSON.stringify({ id }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch!(input, init);
  }) as typeof globalThis.fetch;
}

function restoreFetch(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
}

const COMPANY_NAME = "E2E EDA Side-Channel Co";
// Owners created in this order — the locale heuristic uses the *first*
// owner by membership.createdAt, so OWNERS[0] is always the determinant.
const OWNERS = [
  { email: "edap-sidechan-owner-a@example.test", firstName: "OwnerA" },
  { email: "edap-sidechan-owner-b@example.test", firstName: "OwnerB" },
] as const;

interface OwnerRow {
  email: string;
  userId: string;
}

let companyId = 0;
let ownerRows: OwnerRow[] = [];

async function dbConnect(): Promise<pg.Client> {
  const c = new pg.Client({
    connectionString: requireDbUrl("the email-delivery-alerts side-channel spec"),
  });
  await c.connect();
  return c;
}

/** Idempotently provision the dedicated workspace + two owners. Each
 *  owner is pinned to a single membership in this workspace (defensive
 *  cleanup of any stray cross-workspace memberships from prior runs). */
async function ensureFixture(): Promise<void> {
  const c = await dbConnect();
  try {
    ownerRows = [];
    for (const o of OWNERS) {
      // Route user creation through the shared helper so cookie-name /
      // SESSION_SECRET / users-schema changes only need to be made in
      // one place. Pin `preferredLocale: 'ar'` to preserve the prior
      // fresh-insert default — `resetAlertState` always rewrites this
      // column anyway, so the locale-heuristic assertions are still in
      // charge of what the row holds at evaluator-call time.
      const uid = await ensureUser(c, {
        email: o.email,
        password: `${o.email}-pw`,
        firstName: o.firstName,
        lastName: "SideChan",
        preferredLocale: "ar",
      });
      ownerRows.push({ email: o.email, userId: uid });
    }

    const cRow = (
      await c.query<{ id: number }>(
        `SELECT id FROM companies WHERE name = $1 LIMIT 1`,
        [COMPANY_NAME],
      )
    ).rows[0];
    if (cRow) {
      companyId = Number(cRow.id);
      await c.query(
        `UPDATE companies SET owner_user_id=$1, functional_currency='USD', currency_symbol='$', is_active=true WHERE id=$2`,
        [ownerRows[0].userId, companyId],
      );
    } else {
      const inserted = (
        await c.query<{ id: number }>(
          `INSERT INTO companies (name, owner_user_id, functional_currency, currency_symbol, is_default, is_active)
           VALUES ($1, $2, 'USD', '$', false, true) RETURNING id`,
          [COMPANY_NAME, ownerRows[0].userId],
        )
      ).rows[0];
      companyId = Number(inserted.id);
    }

    // Ensure each owner has *exactly* one membership in this workspace —
    // the locale heuristic finds the first owner by membership.createdAt
    // so a stable membership ordering is what makes the locale assertion
    // deterministic. Insert in OWNERS array order so OWNERS[0]'s
    // membership has the earliest createdAt.
    for (const o of ownerRows) {
      const m = (
        await c.query<{ id: string }>(
          `SELECT id FROM memberships WHERE user_id = $1 AND company_id = $2 LIMIT 1`,
          [o.userId, companyId],
        )
      ).rows[0];
      if (m) {
        await c.query(`UPDATE memberships SET role='owner' WHERE id=$1`, [m.id]);
      } else {
        await c.query(
          `INSERT INTO memberships (id, user_id, company_id, role)
           VALUES ($1, $2, $3, 'owner')`,
          [crypto.randomUUID(), o.userId, companyId],
        );
      }
      // Strip stray memberships that prior runs may have planted in other
      // workspaces — keeping the user pinned to *this* workspace makes the
      // owner-list assertions deterministic and avoids leaking events
      // through the sibling-workspace roll-up.
      await c.query(
        `DELETE FROM memberships WHERE user_id = $1 AND company_id <> $2`,
        [o.userId, companyId],
      );
    }
  } finally {
    await c.end();
  }
}

/** Wipe the alert + event state for this workspace so each test starts
 *  from a known floor. `ownerLocales` lets a test pin the
 *  `preferred_locale` of the first owner for the locale-heuristic
 *  assertions; absent overrides default to 'ar' (the schema default and
 *  the production default for new accounts in this app). */
async function resetAlertState(opts: {
  ownerLocales?: Partial<Record<(typeof OWNERS)[number]["email"], "ar" | "en">>;
} = {}): Promise<void> {
  const c = await dbConnect();
  try {
    // Recipients FK-cascades on alert delete, but be explicit so a future
    // schema change that drops ON DELETE CASCADE doesn't silently let
    // stale rows survive.
    await c.query(
      `DELETE FROM email_delivery_alert_recipients WHERE company_id = $1`,
      [companyId],
    );
    await c.query(
      `DELETE FROM email_delivery_alerts WHERE company_id = $1`,
      [companyId],
    );
    await c.query(
      `DELETE FROM email_delivery_alert_settings WHERE company_id = $1`,
      [companyId],
    );
    for (const o of ownerRows) {
      await c.query(
        `DELETE FROM password_reset_email_events
         WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '8 days'`,
        [o.userId],
      );
      const locale = opts.ownerLocales?.[o.email as (typeof OWNERS)[number]["email"]] ?? "ar";
      await c.query(`UPDATE users SET preferred_locale=$1 WHERE id=$2`, [locale, o.userId]);
    }
  } finally {
    await c.end();
  }
}

/** Insert the canonical permissive settings row with `emailEnabled=true`,
 *  letting the caller patch any subset. The defaults match the
 *  `PERMISSIVE` table in `email-delivery-alerts.spec.ts` so behaviour is
 *  consistent with the e2e suite — the only difference is `email_enabled`
 *  is on here. */
async function setSettings(patch: Partial<{
  enabled: boolean;
  emailEnabled: boolean;
  windowHours: number;
  absoluteThreshold: number;
  ratioThreshold: string;
  minSamplesForRatio: number;
  cooldownMinutes: number;
}> = {}): Promise<void> {
  const merged = {
    enabled: true,
    emailEnabled: true,
    windowHours: 24,
    absoluteThreshold: 3,
    ratioThreshold: "0.5000",
    minSamplesForRatio: 20,
    cooldownMinutes: 360,
    ...patch,
  };
  const c = await dbConnect();
  try {
    await c.query(
      `INSERT INTO email_delivery_alert_settings
         (company_id, enabled, email_enabled, window_hours, absolute_threshold,
          ratio_threshold, min_samples_for_ratio, cooldown_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (company_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         email_enabled = EXCLUDED.email_enabled,
         window_hours = EXCLUDED.window_hours,
         absolute_threshold = EXCLUDED.absolute_threshold,
         ratio_threshold = EXCLUDED.ratio_threshold,
         min_samples_for_ratio = EXCLUDED.min_samples_for_ratio,
         cooldown_minutes = EXCLUDED.cooldown_minutes`,
      [
        companyId,
        merged.enabled,
        merged.emailEnabled,
        merged.windowHours,
        merged.absoluteThreshold,
        merged.ratioThreshold,
        merged.minSamplesForRatio,
        merged.cooldownMinutes,
      ],
    );
  } finally {
    await c.end();
  }
}

/** Seed N rows of the given event type against the first owner so the
 *  failure window query crosses the configured threshold. Mirrors the
 *  helper in `email-delivery-alerts.spec.ts`. */
async function seedFailures(n: number, type = "bounced"): Promise<void> {
  if (n <= 0) return;
  const c = await dbConnect();
  try {
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < n; i++) {
      const off = i * 3;
      values.push(`($${off + 1}, $${off + 2}, $${off + 3})`);
      params.push(crypto.randomUUID(), ownerRows[0].userId, type);
    }
    await c.query(
      `INSERT INTO password_reset_email_events (token_id, user_id, type) VALUES ${values.join(",")}`,
      params,
    );
  } finally {
    await c.end();
  }
}

interface AlertRow {
  id: string;
  email_sent: boolean;
  email_recipients: number;
}

async function fetchAlertRow(alertId: string): Promise<AlertRow> {
  const c = await dbConnect();
  try {
    const row = (
      await c.query<AlertRow>(
        `SELECT id, email_sent, email_recipients FROM email_delivery_alerts WHERE id = $1`,
        [alertId],
      )
    ).rows[0];
    if (!row) throw new Error(`alert ${alertId} not found`);
    return row;
  } finally {
    await c.end();
  }
}

interface RecipientRow {
  email: string;
  status: string;
  error: string | null;
}

async function fetchRecipientRows(alertId: string): Promise<RecipientRow[]> {
  const c = await dbConnect();
  try {
    const rows = (
      await c.query<RecipientRow>(
        `SELECT email, status, error FROM email_delivery_alert_recipients
         WHERE alert_id = $1 ORDER BY email ASC`,
        [alertId],
      )
    ).rows;
    return rows;
  } finally {
    await c.end();
  }
}

async function evaluate(alertLink = "https://app.example.test/eda"): Promise<
  Awaited<ReturnType<typeof evaluateEmailDeliveryAlertsForCompany>>
> {
  return withRlsBypass("test:eda-sidechannel", () =>
    evaluateEmailDeliveryAlertsForCompany(companyId, {
      skipCooldown: true,
      alertLink,
    }),
  );
}

// Serial within the project so the shared workspace doesn't end up in
// inconsistent states between cases — each test resets the alert state in
// `beforeEach` and re-seeds the inputs it needs.
test.describe.configure({ mode: "serial" });

test.describe("email delivery alert email side-channel @alerts-integration", () => {
  test.beforeAll(async () => {
    await ensureFixture();
    installFetchStub();
  });

  test.afterAll(async () => {
    restoreFetch();
    // Close the in-process pool so the test process exits cleanly.
    // Swallow errors — Playwright may have already torn the worker down.
    try {
      await pool.end();
    } catch {
      /* noop */
    }
  });

  test.beforeEach(async () => {
    captured = [];
    stubMode = "ok";
    await resetAlertState();
    await setSettings({});
    await seedFailures(5);
  });

  test("calls the transport once per owner and persists emailSent + emailRecipients", async () => {
    const out = await evaluate();
    expect(out.fired, `evaluator should fire — got ${JSON.stringify(out)}`).toBe(true);
    if (!out.fired) return;

    expect(out.emailSent).toBe(true);
    expect(out.emailRecipients).toBe(2);
    expect(out.emailDeduped).toBe(0);

    // One Resend POST per owner — both owners targeted, no dedupe (no
    // prior alert rows in the dedupe window after `resetAlertState`).
    expect(captured).toHaveLength(2);
    const tos = captured.map((r) => r.to).sort();
    expect(tos).toEqual([OWNERS[0].email, OWNERS[1].email].slice().sort());

    // Body invariants on every Resend POST: the `from` line is non-empty
    // (whether DEFAULT_FROM or EMAIL_FROM is in effect doesn't matter
    // here), the workspace name appears verbatim in the rendered HTML,
    // and the `link` arg the evaluator composed flows through the email
    // body — a refactor that drops the link plumbing would surface as a
    // missing href.
    for (const r of captured) {
      expect(r.from.length).toBeGreaterThan(0);
      expect(r.subject).toBeTruthy();
      expect(r.html).toContain(COMPANY_NAME);
      expect(r.html).toContain("https://app.example.test/eda");
    }

    // The persisted alert row must reflect the side-channel result, not
    // just the structured outcome — that's what `/active` reads.
    const row = await fetchAlertRow(out.alertId);
    expect(row.email_sent).toBe(true);
    expect(row.email_recipients).toBe(2);

    // Per-recipient log is the audit surface for the dedupe + retry
    // gates; both owners should be `sent` with no error.
    const recipients = await fetchRecipientRows(out.alertId);
    expect(recipients).toHaveLength(2);
    for (const r of recipients) {
      expect(r.status).toBe("sent");
      expect(r.error).toBeNull();
    }
  });

  test("transport 5xx response leaves the alert row but with emailSent=false", async () => {
    stubMode = "fail-status";
    const out = await evaluate();
    expect(out.fired, `evaluator should fire — got ${JSON.stringify(out)}`).toBe(true);
    if (!out.fired) return;

    // Both owners attempted, both rejected.
    expect(captured).toHaveLength(2);
    expect(out.emailSent).toBe(false);
    expect(out.emailRecipients).toBe(0);

    const row = await fetchAlertRow(out.alertId);
    expect(row.email_sent).toBe(false);
    expect(row.email_recipients).toBe(0);

    // Every attempt logged as `failed` so the next sweep's retry pass
    // can pick them up (the retry pass reads from this exact table).
    const recipients = await fetchRecipientRows(out.alertId);
    expect(recipients).toHaveLength(2);
    for (const r of recipients) {
      expect(r.status).toBe("failed");
      // The 5xx maps to `send_failed` with the upstream status echoed
      // into the error column.
      expect(r.error ?? "").toMatch(/502|send_failed/);
    }
  });

  test("fetch throw is swallowed; alert row is still written with emailSent=false", async () => {
    stubMode = "fail-throw";
    // The evaluator must not propagate the network error — it catches
    // on the per-recipient `sendEmail` boundary and on the outer
    // side-channel try-block.
    const out = await evaluate();
    expect(out.fired).toBe(true);
    if (!out.fired) return;

    expect(out.emailSent).toBe(false);
    expect(out.emailRecipients).toBe(0);
    // Each owner triggers one fetch attempt — the throw doesn't stop
    // the loop because Promise.all in `sendEmailDeliveryAlertEmail`
    // collects each `sendEmail`'s structured result.
    expect(captured).toHaveLength(2);

    const row = await fetchAlertRow(out.alertId);
    expect(row.email_sent).toBe(false);
    expect(row.email_recipients).toBe(0);
  });

  test("first owner with preferredLocale='en' yields an English subject", async () => {
    await resetAlertState({
      ownerLocales: { [OWNERS[0].email]: "en", [OWNERS[1].email]: "en" },
    });
    await setSettings({});
    await seedFailures(5);

    const out = await evaluate();
    expect(out.fired).toBe(true);
    expect(captured.length).toBeGreaterThan(0);

    // English template subject is `Email delivery alert — <workspace>`
    // — the Arabic template's subject begins with the Arabic word for
    // "alert" (`تنبيه`), which must NOT appear here.
    for (const r of captured) {
      expect(r.subject).toContain("Email delivery alert");
      expect(r.subject).toContain(COMPANY_NAME);
      expect(r.subject).not.toContain("تنبيه");
      // `lang="en"` lives on the <html> element from the layout — proves
      // the body was rendered in the English branch, not just the
      // subject line.
      expect(r.html).toContain('lang="en"');
      expect(r.html).toContain('dir="ltr"');
    }
  });

  test("default Arabic owner yields an Arabic subject", async () => {
    // resetAlertState defaults preferredLocale to 'ar' for every owner
    // (the schema default, the production default for new accounts).
    await resetAlertState();
    await setSettings({});
    await seedFailures(5);

    const out = await evaluate();
    expect(out.fired).toBe(true);
    expect(captured.length).toBeGreaterThan(0);

    for (const r of captured) {
      expect(r.subject).toContain("تنبيه صحة البريد");
      expect(r.subject).toContain(COMPANY_NAME);
      // The English subject begins with `Email delivery alert` — must
      // NOT appear in the Arabic case.
      expect(r.subject).not.toContain("Email delivery alert");
      expect(r.html).toContain('lang="ar"');
      expect(r.html).toContain('dir="rtl"');
    }
  });
});
