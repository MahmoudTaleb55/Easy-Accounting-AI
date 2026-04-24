import { test, expect } from "@playwright/test";
import pg from "pg";

/**
 * Regression net for "block payroll-run deletion when its journal entry is
 * locked or reconciled" (task 78).
 *
 * The DELETE /api/hr/payroll/runs/:id route used to drop the payroll_run +
 * payroll_lines rows but leave the auto-posted journal entry orphaned in the
 * GL. In an audit context that produces a silent HR/GL desync. The new
 * behaviour is:
 *
 *   1. Preferred path — the linked journal entry is reversed (deleted)
 *      atomically with the payroll run, so HR history and the GL stay in
 *      sync. Both deletions land in the audit log under their own entity.
 *
 *   2. Refuse path — if the JE has been picked up by another GL-impact
 *      module (another payroll run, depreciation run, impairment event,
 *      revaluation event, disposal, or document inbox post) the request
 *      is rejected with 409 Conflict + a clear message and BOTH the
 *      payroll run and the journal entry remain in place.
 *
 * Both arms are exercised below over real HTTP against a fresh signup.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000";
const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = "Sup3rS3cret!42";

class CookieJar {
  private store = new Map<string, string>();
  ingest(setCookieHeaders: string[]) {
    for (const h of setCookieHeaders) {
      const [pair] = h.split(";");
      const [name, ...rest] = pair.split("=");
      if (!name) continue;
      this.store.set(name.trim(), rest.join("=").trim());
    }
  }
  asHeader(): string {
    return Array.from(this.store.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

interface Session {
  jar: CookieJar;
  email: string;
  companyId: number;
  headers: Record<string, string>;
}

interface ApiResponse {
  status: number;
  body: unknown;
  text: string;
}

type HeadersWithGetSetCookie = Headers & { getSetCookie: () => string[] };

async function call(
  method: string,
  path: string,
  jar: CookieJar,
  init?: { body?: unknown; headers?: Record<string, string> },
): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-proto": "https",
    cookie: jar.asHeader(),
    ...(init?.headers ?? {}),
  };
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const setCookie = (res.headers as HeadersWithGetSetCookie).getSetCookie?.() ?? [];
  if (setCookie.length) jar.ingest(setCookie);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    /* keep raw text */
  }
  return { status: res.status, body, text };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error(`expected an object, got ${typeof value}: ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throw new Error(`${label} expected number, got ${typeof value}: ${value}`);
  }
  return value;
}

async function bootstrapUser(salt: string): Promise<Session> {
  const jar = new CookieJar();
  const email = `payroll-delete-${salt}-${RUN_TAG}@example.test`;
  // Spoof a unique forwarded IP so the express signup rate limiter (keyed by
  // client IP) does not throttle this test when re-run.
  const forwardedFor = `10.${(salt.charCodeAt(0) + (Date.now() % 200)) & 0xff}.${
    (Date.now() >> 8) & 0xff
  }.${Math.floor(Math.random() * 200) + 1}`;
  const ipHeader = { "x-forwarded-for": forwardedFor };

  const signup = await call("POST", "/api/auth/signup", jar, {
    body: {
      email,
      password: PASSWORD,
      firstName: "Pay",
      lastName: "Tester",
      preferredLocale: "en",
    },
    headers: ipHeader,
  });
  expect(signup.status, `signup ${salt}: ${signup.text}`).toBe(201);

  const company = await call("POST", "/api/companies", jar, {
    body: {
      name: `Payroll Delete ${salt} ${RUN_TAG}`,
      functionalCurrency: "USD",
      currencySymbol: "$",
      isDefault: false,
      isActive: true,
    },
  });
  expect(company.status, `create company ${salt}: ${company.text}`).toBe(201);
  const companyId = asNumber(asObject(company.body).id, "company.id");

  return { jar, email, companyId, headers: { "x-company-id": String(companyId) } };
}

async function postJson(
  s: Session,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const r = await call("POST", path, s.jar, { body, headers: s.headers });
  if (r.status !== 201) {
    throw new Error(`POST ${path} expected 201, got ${r.status}: ${r.text}`);
  }
  return asObject(r.body);
}

async function getJson(s: Session, path: string): Promise<unknown> {
  const r = await call("GET", path, s.jar, { headers: s.headers });
  expect(r.status, `GET ${path}: ${r.text}`).toBe(200);
  return r.body;
}

interface PreparedFixture {
  payrollRunId: number;
  journalEntryId: number;
  /** Cleanup hook so each test releases its pg.Client. */
  closeDb: () => Promise<void>;
  pgClient: pg.Client;
}

/**
 * Stand up a payroll-run row with a real journal entry attached, scoped to
 * the test user's workspace. We seed two unique-coded accounts via the
 * public /api/accounts route, post a balanced JE via /api/journal-entries
 * (so the JE creation path is the genuine one users hit), then insert the
 * matching payroll_run row directly — there is no public route to create a
 * payroll_run without going through the full payroll engine, which requires
 * the full IFRS chart of accounts the seeded company has but a brand-new
 * workspace does not.
 */
async function preparePayrollRunWithJournal(
  s: Session,
  tagSuffix: string,
): Promise<PreparedFixture> {
  const tag = `${RUN_TAG}-${s.companyId}-${tagSuffix}`;

  const acc1 = await postJson(s, "/api/accounts", {
    code: `9100-${tag}`,
    nameAr: `نقدية ${tag}`,
    nameEn: `Cash ${tag}`,
    type: "asset",
    subtype: "current_asset",
    isHeader: false,
    isActive: true,
  });
  const acc2 = await postJson(s, "/api/accounts", {
    code: `2130-${tag}`,
    nameAr: `رواتب مستحقة ${tag}`,
    nameEn: `Salaries Payable ${tag}`,
    type: "liability",
    subtype: "current_liability",
    isHeader: false,
    isActive: true,
  });

  const je = await postJson(s, "/api/journal-entries", {
    description: `Payroll JE ${tag}`,
    source: "manual",
    lines: [
      { accountId: acc1.id, debit: 1000, credit: 0 },
      { accountId: acc2.id, debit: 0, credit: 1000 },
    ],
  });
  const journalEntryId = asNumber(je.id, "je.id");

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for this test.");
  const pgClient = new pg.Client({ connectionString: dbUrl });
  await pgClient.connect();

  const inserted = await pgClient.query<{ id: number }>(
    `INSERT INTO payroll_runs
       (company_id, year, month, status, total_gross, total_net, journal_entry_id)
     VALUES ($1, $2, $3, 'posted', '1000.00', '900.00', $4)
     RETURNING id`,
    [s.companyId, 2099, (Math.floor(Math.random() * 12) + 1), journalEntryId],
  );
  const payrollRunId = inserted.rows[0].id;

  return {
    payrollRunId,
    journalEntryId,
    pgClient,
    closeDb: () => pgClient.end(),
  };
}

async function journalEntryExists(s: Session, jeId: number): Promise<boolean> {
  const list = (await getJson(s, "/api/journal-entries")) as Array<{ id: number }>;
  return list.some((j) => j.id === jeId);
}

async function payrollRunExists(s: Session, runId: number): Promise<boolean> {
  const list = (await getJson(s, "/api/hr/payroll/runs")) as Array<{ id: number }>;
  return list.some((r) => r.id === runId);
}

test.describe("DELETE /api/hr/payroll/runs/:id keeps HR and GL in sync @api", () => {
  test("reverses the linked journal entry alongside the payroll run", async () => {
    const user = await bootstrapUser("rev");
    const fixture = await preparePayrollRunWithJournal(user, "rev");
    try {
      // Sanity: both rows exist before the delete.
      expect(await journalEntryExists(user, fixture.journalEntryId)).toBe(true);
      expect(await payrollRunExists(user, fixture.payrollRunId)).toBe(true);

      const del = await call(
        "DELETE",
        `/api/hr/payroll/runs/${fixture.payrollRunId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete: ${del.text}`).toBe(204);

      // The payroll run AND its GL twin must both be gone — leaving the JE
      // behind is exactly the bug this regression net pins down.
      expect(await payrollRunExists(user, fixture.payrollRunId)).toBe(false);
      expect(await journalEntryExists(user, fixture.journalEntryId)).toBe(false);

      // The reversal must show up on the journal entry's audit thread, not
      // just the payroll run's, so the History drawer keyed on the JE id
      // documents the cascade. The public audit endpoint won't return rows
      // for an entity that no longer "belongs" to the company (the JE is
      // gone), so we read the audit_log table directly — this is exactly
      // the row a future "show full JE history" feature would surface.
      const audit = await fixture.pgClient.query<{
        action: string;
        changes: Array<{ field: string; to?: unknown }> | null;
      }>(
        `SELECT action, changes
           FROM audit_log
          WHERE entity_type = 'journal_entry'
            AND entity_id = $1`,
        [fixture.journalEntryId],
      );
      const deleteRow = audit.rows.find((r) => r.action === "delete");
      expect(
        deleteRow,
        `expected a delete row in journal_entry audit, got ${JSON.stringify(audit.rows)}`,
      ).toBeTruthy();
      const reversedBy = (deleteRow!.changes ?? []).find((c) => c.field === "reversedBy");
      expect(reversedBy?.to, "audit must record which payroll run triggered the reversal").toBe(
        `payroll_run#${fixture.payrollRunId}`,
      );
    } finally {
      await fixture.closeDb();
    }
  });

  test("refuses with 409 when the journal entry is referenced from another row", async () => {
    const user = await bootstrapUser("ref");
    const fixture = await preparePayrollRunWithJournal(user, "ref");
    try {
      // Simulate "the JE is otherwise referenced": pin a second payroll_run
      // row at the same journal entry. The guard treats this as a hard
      // conflict because reversing the JE would silently break the second
      // row's GL link.
      const second = await fixture.pgClient.query<{ id: number }>(
        `INSERT INTO payroll_runs
           (company_id, year, month, status, total_gross, total_net, journal_entry_id)
         VALUES ($1, 2099, 1, 'posted', '1000.00', '900.00', $2)
         RETURNING id`,
        [user.companyId, fixture.journalEntryId],
      );
      const secondRunId = second.rows[0].id;

      const del = await call(
        "DELETE",
        `/api/hr/payroll/runs/${fixture.payrollRunId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete should be 409 conflict, got ${del.status}: ${del.text}`).toBe(409);
      const body = asObject(del.body);
      expect(typeof body.message, "409 must carry a human-readable message").toBe("string");
      expect(
        String(body.message).length,
        "409 message must explain why the deletion was refused",
      ).toBeGreaterThan(10);

      // The whole point of the refuse path: nothing was destroyed. Both the
      // run and the JE must still be there.
      expect(
        await payrollRunExists(user, fixture.payrollRunId),
        "payroll run must survive a refused delete",
      ).toBe(true);
      expect(
        await journalEntryExists(user, fixture.journalEntryId),
        "journal entry must survive a refused delete",
      ).toBe(true);

      // Tidy up the synthetic second run so we leave the audit log clean.
      await fixture.pgClient.query(`DELETE FROM payroll_runs WHERE id = $1`, [secondRunId]);
    } finally {
      await fixture.closeDb();
    }
  });
});
