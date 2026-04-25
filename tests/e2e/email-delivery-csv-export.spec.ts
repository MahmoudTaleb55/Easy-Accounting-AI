import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * End-to-end coverage for the /api/auth/email-deliveries?format=csv
 * Content-Disposition filename contract.
 *
 * The CSV export from the email-delivery-health page is the audit
 * artifact compliance reviewers rely on, and the route's filename
 * branch (server/auth/local-routes.ts, ~lines 706-755) is doing two
 * jobs at once:
 *
 *   (a) Reflect the chosen window in the filename so reviewers can
 *       pull "Jan 2025" and "Feb 2025" side-by-side without one
 *       overwriting the other in their Downloads folder, and
 *   (b) Refuse to splice anything that isn't a strict YYYY-MM-DD into
 *       Content-Disposition — otherwise an attacker (or a careless
 *       admin pasting an ISO timestamp) could smuggle a CRLF or quote
 *       through the header.
 *
 * Until this spec landed neither half of that contract had a regression
 * test. A revert that swapped the strict /^\d{4}-\d{2}-\d{2}$/ guard
 * for a more permissive matcher, or that accidentally always wrote the
 * today-stamped fallback, would only surface when a human noticed
 * duplicate-named files (or, in the worst case, never).
 *
 * The spec piggybacks on the dedicated workspace + dedicated owner
 * provisioned by `email-delivery-alerts.setup.ts`. That setup already
 * provides an owner storage state and a known company id — exactly
 * what we need for an authenticated CSV pull. The route only reads the
 * filter parameters, so we don't have to seed any delivery rows; an
 * empty result set is a perfectly valid CSV and exercises the same
 * filename branch.
 */

const OWNER_STORAGE = ".playwright/edap-owner.json";

interface SharedFixture {
  companyId: number;
  ownerUserId: string;
}

function readSharedFixture(): SharedFixture {
  const fixturePath = path.resolve(
    ".playwright/email-delivery-alerts-fixture.json",
  );
  if (!fs.existsSync(fixturePath)) {
    throw new Error(
      `Missing ${fixturePath}. Run the email-delivery-alerts-setup project ` +
        `first (it persists the dedicated company id this spec relies on).`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Partial<
    SharedFixture
  >;
  if (!raw.companyId || !raw.ownerUserId) {
    throw new Error(
      `email-delivery-alerts-fixture.json missing companyId or ownerUserId`,
    );
  }
  return { companyId: raw.companyId, ownerUserId: raw.ownerUserId };
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

test.describe("email-delivery CSV export filename @csv-export", () => {
  test.use({ storageState: OWNER_STORAGE });

  let companyId: number;
  test.beforeAll(() => {
    companyId = readSharedFixture().companyId;
  });

  // Pin every call to the dedicated workspace via x-company-id. The
  // dedicated owner only holds one membership (the setup defensively
  // deletes any sibling memberships) so the server's "first
  // membership" fallback would land here too — but the explicit
  // header keeps the intent visible and matches the pinning style in
  // `email-delivery-alerts.spec.ts`.
  function headers(): Record<string, string> {
    return { "x-company-id": String(companyId) };
  }

  test("windowed filename: both from and to are valid YYYY-MM-DD", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/auth/email-deliveries?format=csv&from=2025-01-01&to=2025-01-31",
      { headers: headers() },
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers()["content-disposition"]).toBe(
      'attachment; filename="email-delivery-2025-01-01_to_2025-01-31.csv"',
    );
  });

  test("today-stamped fallback when neither from nor to is provided", async ({
    request,
  }) => {
    // Capture the date stamp on either side of the request so the
    // assertion still holds if the request happens to straddle a UTC
    // midnight tick. Either bound is acceptable.
    const before = todayStamp();
    const res = await request.get("/api/auth/email-deliveries?format=csv", {
      headers: headers(),
    });
    const after = todayStamp();
    expect(res.status()).toBe(200);
    const cd = res.headers()["content-disposition"];
    expect([
      `attachment; filename="email-delivery-${before}.csv"`,
      `attachment; filename="email-delivery-${after}.csv"`,
    ]).toContain(cd);
  });

  test("partial window filename: only `from` is a valid YYYY-MM-DD", async ({
    request,
  }) => {
    // Reviewers commonly pull "everything since <date>" — this exercises
    // the `from_<date>` filename branch in isolation. Without this case
    // a regression that swapped the partial-window branches for the
    // today-stamped fallback would slip through silently.
    const res = await request.get(
      "/api/auth/email-deliveries?format=csv&from=2025-01-01",
      { headers: headers() },
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers()["content-disposition"]).toBe(
      'attachment; filename="email-delivery-from_2025-01-01.csv"',
    );

    // Pair a valid `from` with a malformed `to`: the strict
    // YYYY-MM-DD guard must reject the bad `to` and still emit the
    // partial-window filename rather than collapsing all the way to
    // the today-stamped fallback. Catches a regression where a
    // refactor short-circuits to the fallback the moment any input
    // fails validation.
    const malformed = await request.get(
      "/api/auth/email-deliveries?format=csv&from=2025-01-01&to=garbage",
      { headers: headers() },
    );
    expect(malformed.status()).toBe(200);
    expect(malformed.headers()["content-disposition"]).toBe(
      'attachment; filename="email-delivery-from_2025-01-01.csv"',
    );
    expect(malformed.headers()["content-disposition"]).not.toContain(
      "garbage",
    );
  });

  test("partial window filename: only `to` is a valid YYYY-MM-DD", async ({
    request,
  }) => {
    // The mirror case of the `from`-only test: reviewers pulling
    // "everything before <date>" rely on the `to_<date>` filename
    // branch. Same shape of regression risk, exercised separately so
    // a failure points at the right branch.
    const res = await request.get(
      "/api/auth/email-deliveries?format=csv&to=2025-03-31",
      { headers: headers() },
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers()["content-disposition"]).toBe(
      'attachment; filename="email-delivery-to_2025-03-31.csv"',
    );

    // Pair a malformed `from` with a valid `to`: the bad `from` must
    // be rejected without dragging the valid `to` down with it into
    // the today-stamped fallback.
    const malformed = await request.get(
      "/api/auth/email-deliveries?format=csv&from=garbage&to=2025-03-31",
      { headers: headers() },
    );
    expect(malformed.status()).toBe(200);
    expect(malformed.headers()["content-disposition"]).toBe(
      'attachment; filename="email-delivery-to_2025-03-31.csv"',
    );
    expect(malformed.headers()["content-disposition"]).not.toContain(
      "garbage",
    );
  });

  test("non-YYYY-MM-DD inputs do not appear in the filename (header-injection guard)", async ({
    request,
  }) => {
    // Two probes layered into one request:
    //   * `from` carries a CRLF + quote injection payload that, if not
    //     filtered, would let the attacker close the filename and
    //     splice arbitrary header content (or even a second header)
    //     into the response.
    //   * `to` carries a "loose" date format (single-digit month/day)
    //     that the strict /^\d{4}-\d{2}-\d{2}$/ guard must still
    //     reject — catches a regression that swaps in a more
    //     permissive matcher.
    const malicious = '2025-01-01"; injected="x\r\nX-Evil: yes';
    const looseFmt = "2025-1-1";
    const url =
      "/api/auth/email-deliveries?format=csv" +
      `&from=${encodeURIComponent(malicious)}` +
      `&to=${encodeURIComponent(looseFmt)}`;

    const before = todayStamp();
    const res = await request.get(url, { headers: headers() });
    const after = todayStamp();

    expect(res.status()).toBe(200);
    const cd = res.headers()["content-disposition"];
    // Both inputs were rejected, so the route falls through to the
    // today-stamped fallback — matching the "no window" branch above.
    expect([
      `attachment; filename="email-delivery-${before}.csv"`,
      `attachment; filename="email-delivery-${after}.csv"`,
    ]).toContain(cd);

    // Belt-and-braces: the literal injection payload and the loose
    // date format must not appear anywhere in Content-Disposition.
    // These are stronger negative assertions than just checking the
    // exact filename — they catch a regression where a future
    // refactor accidentally interpolates the raw query value into
    // some other part of the header.
    expect(cd).not.toContain("injected");
    expect(cd).not.toContain("X-Evil");
    expect(cd).not.toContain("2025-1-1");

    // The server must not have surfaced the injected header either —
    // a smuggled CRLF would let the attacker append response headers
    // that weren't on our allow-list.
    expect(res.headers()["x-evil"]).toBeUndefined();
  });
});

/**
 * Body-level coverage for the same CSV export route. The filename block
 * above pins the Content-Disposition contract; this block pins what
 * compliance reviewers actually open in Excel:
 *
 *   * a leading UTF-8 BOM so non-ASCII recipient names (Arabic, etc.)
 *     decode correctly when Excel double-clicks the file,
 *   * CRLF row separators (so Windows spreadsheet apps don't see one
 *     mile-long line),
 *   * the strict 7-column header row in the documented order, and
 *   * `csvCell` quoting per RFC 4180 — a recipient containing a quote,
 *     a comma, and a newline must round-trip without splitting the row.
 *
 * Without this block a regression in any of those (someone strips the
 * BOM, switches to LF, reorders the header, or replaces csvCell with a
 * naive `String(v)`) would silently break a downloaded report and would
 * not be caught by the existing filename-only assertions.
 *
 * To stay deterministic alongside the sibling `email-delivery-alerts`
 * spec — which shares this dedicated workspace and resets all
 * `invitation_email_events` for it in `beforeEach` — we anchor every
 * seed row at a far-future date (year 2099) and pin every CSV pull to
 * the same far-future window. That guarantees:
 *   (a) our seeded row is the *only* row in the response body, no
 *       matter what other tests have planted in this workspace, and
 *   (b) our seeds never land in the alert evaluator's 24h failure
 *       window, so they can't disturb the alerts spec's count
 *       assertions if Playwright happens to run the two projects on
 *       different workers in parallel.
 *
 * Each test still cleans up the rows it inserted, so a re-run starts
 * from a known floor even if a prior run was interrupted.
 */

const SEED_WINDOW = { from: "2099-01-01", to: "2099-12-31" };
const SEED_EVENT_AT = "2099-06-15 12:00:00+00";
const EMPTY_WINDOW = { from: "2098-01-01", to: "2098-12-31" };

const CSV_HEADER =
  "transport,recipient,status,error,last_event_at,message_id,created_at";

function requiredDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set for the email-delivery-csv-export spec.",
    );
  }
  return url;
}

interface SeededInvitation {
  invitationId: string;
}

async function seedInvitationFailureRow(args: {
  companyId: number;
  ownerUserId: string;
  recipient: string;
  error: string;
}): Promise<SeededInvitation> {
  const client = new pg.Client({ connectionString: requiredDbUrl() });
  await client.connect();
  try {
    const invitationId = crypto.randomUUID();
    // Token must be unique per the schema and is unrelated to anything
    // we assert on. Use a UUID prefix to make the row trivially
    // identifiable in a manual DB inspection if a seed leaks.
    const token = `csv-export-test-${crypto.randomUUID()}`;
    await client.query(
      `INSERT INTO invitations
         (id, company_id, invited_by_user_id, email, role, token, status, expires_at)
       VALUES ($1, $2, $3, $4, 'viewer', $5, 'pending', NOW() + INTERVAL '7 days')`,
      [invitationId, args.companyId, args.ownerUserId, args.recipient, token],
    );
    // Backdate the event into the 2099 window so the GET below can pin
    // its date filter to a window no other spec uses.
    await client.query(
      `INSERT INTO invitation_email_events
         (invitation_id, message_id, type, error, created_at)
       VALUES ($1, $2, 'send_failed', $3, $4::timestamptz)`,
      [
        invitationId,
        `csv-export-msg-${crypto.randomUUID()}`,
        args.error,
        SEED_EVENT_AT,
      ],
    );
    return { invitationId };
  } finally {
    await client.end();
  }
}

async function deleteSeededInvitation(invitationId: string): Promise<void> {
  const client = new pg.Client({ connectionString: requiredDbUrl() });
  await client.connect();
  try {
    // Delete the events first to satisfy any FK consistency, then the
    // parent invitation row.
    await client.query(
      `DELETE FROM invitation_email_events WHERE invitation_id = $1`,
      [invitationId],
    );
    await client.query(`DELETE FROM invitations WHERE id = $1`, [invitationId]);
  } finally {
    await client.end();
  }
}

test.describe("email-delivery CSV export body @csv-export", () => {
  test.use({ storageState: OWNER_STORAGE });

  let companyId: number;
  let ownerUserId: string;
  test.beforeAll(() => {
    const fx = readSharedFixture();
    companyId = fx.companyId;
    ownerUserId = fx.ownerUserId;
  });

  function headers(): Record<string, string> {
    return { "x-company-id": String(companyId) };
  }

  test("body has BOM, CRLF separators, the documented header, and RFC4180-quotes a troublesome recipient", async ({
    request,
  }) => {
    // Recipient packs all three of csvCell's escape triggers into one
    // value: a comma (would split the row if not quoted), a double
    // quote (must be doubled inside the wrapping quotes), and a
    // newline (would split the row across CRLF-separated lines if
    // not quoted). Starts with `H` to dodge csvCell's leading
    // formula-injection guard (`'` prefix for `=+-@`-prefixed cells)
    // — that guard has its own coverage path and isn't what this
    // test is about.
    const recipient = 'Hello, "World"\nNewline';
    const expectedRecipientCell = '"Hello, ""World""\nNewline"';
    const seed = await seedInvitationFailureRow({
      companyId,
      ownerUserId,
      recipient,
      error: "smtp 550 mailbox unavailable",
    });
    try {
      const res = await request.get(
        `/api/auth/email-deliveries?format=csv` +
          `&from=${SEED_WINDOW.from}&to=${SEED_WINDOW.to}`,
        { headers: headers() },
      );
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toMatch(/^text\/csv/);

      // Pull the body as raw bytes and decode as UTF-8 so the BOM
      // survives — `res.text()` is also fine in practice but going
      // through Buffer makes the byte-level intent obvious.
      const body = (await res.body()).toString("utf8");

      // (a) UTF-8 BOM. Excel uses this to auto-detect encoding so
      //     non-ASCII recipient names (Arabic, etc.) render correctly.
      expect(body.charCodeAt(0)).toBe(0xfeff);

      // (b) CRLF row separators. Splitting on \r\n must produce more
      //     than one line, and there must be no bare LF row separator
      //     *between* rows. (The troublesome cell legitimately
      //     contains a bare \n, but it's wrapped inside quotes and
      //     therefore doesn't count as a row break.)
      const lines = body.slice(1).split("\r\n"); // strip BOM
      // The route always trails the body with a CRLF, so the final
      // split yields an empty string. Header + 1 data row + trailing
      // empty = 3 entries.
      expect(lines.length).toBe(3);
      expect(lines[lines.length - 1]).toBe("");

      // (c) Documented 7-column header in the documented order.
      expect(lines[0]).toBe(CSV_HEADER);

      // (d) The data row exists and quotes the troublesome recipient
      //     correctly. We assert on the substring rather than the
      //     whole line because the other six cells (transport, status,
      //     error, last_event_at, message_id, created_at) carry
      //     volatile values (timestamps, UUIDs) that aren't what this
      //     test is pinning.
      const dataRow = lines[1];
      expect(dataRow.startsWith("invitation,")).toBe(true);
      expect(dataRow).toContain(expectedRecipientCell);
      // The `,send_failed,` cell sits immediately after the recipient
      // — i.e. the quoted recipient actually closed correctly and
      // didn't bleed into the status column.
      expect(dataRow).toContain(`${expectedRecipientCell},send_failed,`);
    } finally {
      await deleteSeededInvitation(seed.invitationId);
    }
  });

  test("recipients starting with =, +, -, or @ are prefixed with a single quote (formula-injection guard, CWE-1236)", async ({
    request,
  }) => {
    // `csvCell` defuses spreadsheet formula injection by prefixing any
    // cell whose first character is `=`, `+`, `-`, or `@` with a
    // single quote. Without that prefix, a compliance reviewer who
    // opens the downloaded CSV in Excel would execute whatever
    // formula an attacker stuffed into an invitation email field —
    // for example `=HYPERLINK("https://evil/?", "Click")` or
    // `=cmd|...` — and leak data or fire a remote command.
    //
    // Seed one invitation per dangerous prefix, pull the CSV against
    // the same far-future window the sibling body test uses (so other
    // workspaces' rows can't bleed in), and assert each row's
    // recipient cell begins with a literal `'`. The prefixes
    // themselves are NOT csvCell quote-triggers (no comma / quote /
    // newline), so each cell appears unwrapped in the row — meaning
    // a literal `'<prefix>` substring is the right thing to look for.
    const prefixes = ["=", "+", "-", "@"] as const;
    const seeds: { prefix: string; recipient: string; invitationId: string }[] =
      [];
    try {
      for (const prefix of prefixes) {
        // Tag the local part with a UUID so we can locate this row
        // unambiguously in the CSV body even though several seeded
        // rows land in the same window.
        const recipient = `${prefix}fi-${crypto.randomUUID()}@example.com`;
        const seed = await seedInvitationFailureRow({
          companyId,
          ownerUserId,
          recipient,
          error: "smtp 550 mailbox unavailable",
        });
        seeds.push({ prefix, recipient, invitationId: seed.invitationId });
      }

      const res = await request.get(
        `/api/auth/email-deliveries?format=csv` +
          `&from=${SEED_WINDOW.from}&to=${SEED_WINDOW.to}`,
        { headers: headers() },
      );
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toMatch(/^text\/csv/);

      const body = (await res.body()).toString("utf8");
      // Strip BOM, split on CRLF, drop the trailing empty line and
      // the header row — what's left is the data rows.
      const lines = body.slice(1).split("\r\n");
      expect(lines[0]).toBe(CSV_HEADER);
      const dataRows = lines.slice(1).filter((l) => l.length > 0);

      for (const seed of seeds) {
        // Locate this seed's row by its unique recipient suffix.
        // The csvCell guard prepends a `'` to the recipient, but the
        // unique uuid+`@example.com` portion stays intact.
        const suffix = seed.recipient.slice(1); // drop the dangerous prefix
        const row = dataRows.find((l) => l.includes(suffix));
        expect(row, `expected a CSV row for ${seed.recipient}`).toBeDefined();
        // The recipient is the second column. The cell is unquoted
        // (no commas / quotes / newlines), so it appears as
        // `,'<prefix><suffix>,` between the transport and status
        // columns. Pinning to that exact framing catches a regression
        // where the `'` prefix is dropped *or* leaks into the wrong
        // column.
        const expectedCell = `,'${seed.prefix}${suffix},`;
        expect(
          row,
          `recipient cell for ${seed.recipient} must start with a single quote`,
        ).toContain(expectedCell);
      }
    } finally {
      for (const seed of seeds) {
        await deleteSeededInvitation(seed.invitationId);
      }
    }
  });

  test("empty result set still returns the header row + trailing CRLF", async ({
    request,
  }) => {
    // A window we never seed into — guarantees an empty result set
    // even if the workspace accumulates other rows in real time.
    const res = await request.get(
      `/api/auth/email-deliveries?format=csv` +
        `&from=${EMPTY_WINDOW.from}&to=${EMPTY_WINDOW.to}`,
      { headers: headers() },
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^text\/csv/);
    const body = (await res.body()).toString("utf8");

    // Spreadsheet apps (and naive CSV parsers) choke on a zero-byte
    // body — they expect at least the header row. The route guarantees
    // BOM + header + trailing CRLF even with zero data rows.
    expect(body).toBe(`\uFEFF${CSV_HEADER}\r\n`);
  });
});
