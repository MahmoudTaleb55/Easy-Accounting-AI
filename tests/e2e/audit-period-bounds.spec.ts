import { test, expect, type APIRequestContext } from "@playwright/test";
// `APIRequestContext` is `page.request`'s type; keeping it imported makes
// the helper signature self-documenting.
import pg from "pg";
import {
  ensureCompany,
  ensureUser,
  forgeSession,
  requireDbUrl,
} from "./_helpers/forge-session";

/**
 * Regression net for task #252 — pin the contract between the
 * `HistoryTimeline` period dropdown (`client/src/components/audit/history-drawer.tsx`)
 * and the audit list endpoint (`GET /api/audit/:entityType/:id`):
 *
 *   • When the request omits `from` / `to`, `storage.getAuditLog` is a
 *     no-op on the time axis and returns the full per-entity history.
 *   • When the request supplies `from` and/or `to`, the rows returned
 *     are filtered by `audit_log.occurred_at` so very large per-entity
 *     histories aren't paged into the browser only to be discarded by
 *     the client-side preset filter.
 *
 * Without this spec a refactor of the timeline that quietly drops the
 * query string (or of the route handler that quietly stops forwarding
 * the bounds into storage) would silently regress to fetching the full
 * history again — the UI would still look correct because the in-memory
 * preset filter would re-narrow the rows, but the wire payload would
 * blow up for entities with thousands of audit rows.
 *
 * The matching browser-side assertion (the period dropdown actually
 * reissues a request whose URL contains `from=`) lives in the
 * component-level vitest spec at
 * `client/src/components/audit/__tests__/history-drawer.test.tsx` —
 * that one drives the React component; this one pins the server side
 * of the same contract.
 *
 * Auth is handled by the shared `forgeSession` helper instead of going
 * through the public signup endpoint. Signup performs a deliberate
 * pre-membership `getUserByEmail` lookup that the workspace-isolation
 * runtime guard would refuse under `WORKSPACE_ISOLATION_GUARD=throw`,
 * which is exactly the mode the e2e webServer (and the dev workflow)
 * runs under — see playwright.config.ts.
 */

const TEST_EMAIL = "audit-period-bounds@example.test";
const TEST_PASSWORD = "playwright-audit-period-bounds-pw-2026";
const TEST_FIRST = "AuditPeriod";
const TEST_LAST = "Bounds";

interface SeededWorkspace {
  companyId: number;
  accountId: number;
}

/**
 * Seed a clean workspace + a single account with a known set of audit
 * rows whose `occurred_at` timestamps span more than 90 days. The
 * timestamps are anchored on wall-clock now so the same `Last 7 days`
 * preset that `HistoryTimeline` would compute brackets the most recent
 * row only.
 *
 * Inserting via direct SQL (rather than going through `/api/accounts`)
 * lets the spec wipe + re-seed deterministically across re-runs and
 * sidesteps any incidental audit row a route layer would write.
 */
async function seedWorkspaceFixtures(): Promise<SeededWorkspace> {
  const dbUrl = requireDbUrl("the audit-period-bounds spec");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const userId = await ensureUser(client, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: TEST_FIRST,
      lastName: TEST_LAST,
      preferredLocale: "en",
    });
    const companyId = await ensureCompany(client, {
      userId,
      companyName: "E2E Audit Period Co",
    });

    // Per-workspace unique account code so re-runs against the same
    // workspace replace cleanly. Every audit row this spec inserts
    // points at this account, so wiping by `entity_id = accountId`
    // below leaves any other suite's audit rows untouched.
    const code = `E2E-AUDIT-PERIOD-${companyId}`;
    let accountId: number;
    const existing = (
      await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [companyId, code],
      )
    ).rows[0];
    if (existing) {
      accountId = Number(existing.id);
    } else {
      accountId = Number(
        (
          await client.query(
            `INSERT INTO accounts
               (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
             VALUES ($1, $2, $3, $4, 'asset', 'current_asset', false, true)
             RETURNING id`,
            [companyId, code, "حساب فترة", "Audit Period Account"],
          )
        ).rows[0].id,
      );
    }

    // Wipe any prior audit rows pinned to this account so the row
    // counts the spec asserts on are deterministic across re-runs.
    await client.query(
      `DELETE FROM audit_log WHERE company_id = $1 AND entity_type = 'account' AND entity_id = $2`,
      [companyId, accountId],
    );

    // Layer in four synthetic audit rows with explicit timestamps that
    // span more than 90 days. We deliberately seed every row by hand
    // (instead of relying on `createAccount`'s implicit audit row)
    // because `ensureUser` may reuse a previously-created account from
    // an earlier run, in which case there'd be no fresh "create" row
    // for the spec to count on.
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    const oneTwentyDaysAgo = new Date(
      now.getTime() - 120 * 24 * 60 * 60 * 1000,
    );

    for (const occurredAt of [
      oneHourAgo,
      fiveDaysAgo,
      fortyDaysAgo,
      oneTwentyDaysAgo,
    ]) {
      await client.query(
        `INSERT INTO audit_log
           (company_id, entity_type, entity_id, action, actor, source, changes, occurred_at)
         VALUES ($1, 'account', $2, 'update', NULL, 'system',
                 '[{"field":"nameEn","from":"old","to":"new"}]'::jsonb, $3)`,
        [companyId, accountId, occurredAt.toISOString()],
      );
    }

    return { companyId, accountId };
  } finally {
    await client.end();
  }
}

interface AuditRow {
  id: number;
  action: string;
  occurredAt: string;
}

async function fetchAuditList(
  request: APIRequestContext,
  companyId: number,
  accountId: number,
  qs?: { from?: string; to?: string },
): Promise<{ status: number; rows: AuditRow[]; text: string; url: string }> {
  const params = new URLSearchParams();
  if (qs?.from) params.set("from", qs.from);
  if (qs?.to) params.set("to", qs.to);
  const path = `/api/audit/account/${accountId}${
    params.toString() ? `?${params.toString()}` : ""
  }`;
  const res = await request.get(path, {
    headers: { "x-company-id": String(companyId) },
  });
  const text = await res.text();
  if (res.status() !== 200) {
    return { status: res.status(), rows: [], text, url: path };
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  expect(Array.isArray(body), `expected array body, got ${text}`).toBe(true);
  return {
    status: res.status(),
    rows: body as AuditRow[],
    text,
    url: path,
  };
}

test.describe("audit list endpoint honours from/to bounds @api", () => {
  test("filters by occurred_at when from/to are passed; returns full history when omitted", async ({
    page,
  }) => {
    const { companyId, accountId } = await seedWorkspaceFixtures();
    const dbUrl = requireDbUrl("the audit-period-bounds spec");

    // Re-derive the userId (ensureUser is idempotent so the row already
    // exists) so forgeSession can plant the right `passport.user.sub`.
    const userClient = new pg.Client({ connectionString: dbUrl });
    await userClient.connect();
    let userId: string;
    try {
      const row = (
        await userClient.query(`SELECT id FROM users WHERE email = $1`, [
          TEST_EMAIL,
        ])
      ).rows[0];
      if (!row) throw new Error(`Expected seeded user ${TEST_EMAIL} to exist`);
      userId = row.id as string;
    } finally {
      await userClient.end();
    }

    await forgeSession({
      page,
      dbUrl,
      userId,
      email: TEST_EMAIL,
      firstName: TEST_FIRST,
      lastName: TEST_LAST,
    });
    // Sanity-check that the forged cookie actually landed on the page's
    // browser context — `page.request` reuses those cookies for every
    // /api/audit hit below, and a missing `connect.sid` would surface
    // as a confusing 401 buried in the first assertion.
    const cookies = await page.context().cookies();
    const sid = cookies.find((c) => c.name === "connect.sid");
    if (!sid) throw new Error("Expected forgeSession to plant connect.sid");

    // Now the actual contract assertions, all driven through
    // page.request which inherits the forged cookies automatically.
    const now = new Date();

    // (1) No bounds → no-op on the time axis: every seeded row visible.
    const unbounded = await fetchAuditList(
      page.request,
      companyId,
      accountId,
    );
    expect(unbounded.status, `unbounded GET: ${unbounded.text}`).toBe(200);
    expect(unbounded.url).toBe(`/api/audit/account/${accountId}`);
    expect(
      unbounded.rows.length,
      `unbounded fetch should include every seeded audit row (got ${JSON.stringify(
        unbounded.rows,
      )})`,
    ).toBe(4);

    // (2) "Last 7 days" preset → from=7d-ago, to=now. The 40-day-old
    // and 120-day-old synthetic rows must drop off; the 1-hour and
    // 5-day-old rows must remain.
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const sevenDay = await fetchAuditList(page.request, companyId, accountId, {
      from: sevenDaysAgo.toISOString(),
      to: now.toISOString(),
    });
    expect(sevenDay.status, `'7d' GET: ${sevenDay.text}`).toBe(200);
    expect(
      sevenDay.url,
      "Last 7 days fetch must put `from` on the wire",
    ).toContain("from=");
    expect(
      sevenDay.rows.length,
      `Last 7 days fetch should narrow the result set; got ${JSON.stringify(
        sevenDay.rows,
      )}`,
    ).toBe(2);
    // Every returned row must actually fall inside the requested window.
    for (const row of sevenDay.rows) {
      const at = new Date(row.occurredAt).getTime();
      expect(
        at >= sevenDaysAgo.getTime() && at <= now.getTime(),
        `row ${row.id} (occurredAt=${row.occurredAt}) leaked outside the ` +
          `[${sevenDaysAgo.toISOString()}, ${now.toISOString()}] window`,
      ).toBe(true);
    }

    // (3) "Last 90 days" preset → the 120-day-old row drops off but
    // the 40-day-old, 5-day-old, and 1-hour rows remain. This pins
    // the bound is *inclusive of recent rows* rather than e.g.
    // accidentally widening to ±90 days.
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const ninetyDay = await fetchAuditList(
      page.request,
      companyId,
      accountId,
      {
        from: ninetyDaysAgo.toISOString(),
        to: now.toISOString(),
      },
    );
    expect(ninetyDay.status, `'90d' GET: ${ninetyDay.text}`).toBe(200);
    expect(ninetyDay.rows.length).toBe(3);

    // (4) Only `to` is passed (no `from`) — must still narrow.
    // Setting `to` to 60 days ago should keep only the 120-day row.
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const onlyTo = await fetchAuditList(page.request, companyId, accountId, {
      to: sixtyDaysAgo.toISOString(),
    });
    expect(onlyTo.status, `only-to GET: ${onlyTo.text}`).toBe(200);
    expect(onlyTo.url).toContain("to=");
    expect(onlyTo.url).not.toContain("from=");
    expect(onlyTo.rows.length).toBe(1);
    expect(new Date(onlyTo.rows[0].occurredAt).getTime()).toBeLessThanOrEqual(
      sixtyDaysAgo.getTime(),
    );

    // (5) Garbage `from` must be rejected with 400 instead of being
    // silently ignored — that's how the route avoids accidentally
    // over-fetching after a client-side regression mangles the
    // timestamp it puts on the wire.
    const bogus = await fetchAuditList(page.request, companyId, accountId, {
      from: "not-a-date",
    });
    expect(
      bogus.status,
      `bogus from= should 400, got ${bogus.status}: ${bogus.text}`,
    ).toBe(400);
  });
});
