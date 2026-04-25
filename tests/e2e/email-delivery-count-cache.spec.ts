import { test, expect, type APIRequestContext } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Integration coverage for the 5-second in-memory cache wrapping
 * `countEmailDeliveriesForCompany` (server/auth/storage.ts) — the
 * helper that backs `GET /api/auth/email-deliveries/count`. Task #116
 * added the cache so the row-count chip on
 * /app/settings/email-delivery stays snappy on long histories, but
 * left the contract untested:
 *
 *   (a) Freshness — the cached value must expire and get re-read
 *       within the documented TTL (5_000ms) so a newly arrived event
 *       shows up on the chip within a few seconds. A revert that
 *       widened the TTL (or worse, made it permanent) would only
 *       surface as a stale chip in production.
 *
 *   (b) Per-filter independence — the cache key must include every
 *       filter (status, email, from, to). A regression that dropped
 *       any of those from the key would let one filter combo serve a
 *       stale count to a sibling combo (e.g. the unfiltered total
 *       leaking into a recipient-scoped probe).
 *
 * The spec piggybacks on the dedicated workspace + dedicated owner
 * provisioned by `email-delivery-count-cache.setup.ts`. A workspace
 * dedicated to this spec is essential because the count helper unions
 * both invitation and password-reset email events for the workspace
 * and the assertions are exact: any sibling spec that mutates either
 * event table for the same workspace would race us when Playwright
 * runs spec projects in parallel. (The original draft of this spec
 * shared the workspace from `email-delivery-alerts.setup.ts`, but
 * `email-delivery-alerts.spec.ts` also wipes/seeds those tables for
 * the same workspace, so the projects could race once the shared
 * setup finished.)
 *
 * The cache lives in-process on the dev-server, so this spec can't
 * call `clearEmailDeliveryCountCache` directly (different process) —
 * instead we exercise the contract through HTTP behaviour: filter
 * combos that should differ DO differ, and the freshness path
 * validates by waiting out the TTL window.
 */

const OWNER_STORAGE = ".playwright/edcc-owner.json";
const FIXTURE_PATH = ".playwright/email-delivery-count-cache-fixture.json";
const TTL_MS = 5_000;

interface SharedFixture {
  companyId: number;
  ownerUserId: string;
}

function readSharedFixture(): SharedFixture {
  const fixturePath = path.resolve(FIXTURE_PATH);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(
      `Missing ${fixturePath}. Run the email-delivery-count-cache-setup ` +
        `project first (it persists the dedicated company id + owner user ` +
        `id this spec relies on).`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Partial<
    SharedFixture
  >;
  if (!raw.companyId || !raw.ownerUserId) {
    throw new Error(
      `${FIXTURE_PATH} missing companyId or ownerUserId`,
    );
  }
  return { companyId: raw.companyId, ownerUserId: raw.ownerUserId };
}

function requiredDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set for the email-delivery-count-cache spec.",
    );
  }
  return url;
}

/**
 * Clear every password-reset email event for the dedicated owner so the
 * count starts from a known floor on every test. Mirrors the wipe in
 * `email-delivery-alerts.spec.ts` — only the dedicated owner contributes
 * to this workspace's roll-up, so this single DELETE is sufficient.
 *
 * Also removes any invitation events that might have leaked in (defensive
 * — no sibling spec writes to this workspace's invitations, but the
 * count query unions both tables so we keep the floor honest).
 */
async function resetEvents(): Promise<void> {
  const { companyId, ownerUserId } = await getShared();
  const client = new pg.Client({ connectionString: requiredDbUrl() });
  await client.connect();
  try {
    await client.query(
      `DELETE FROM password_reset_email_events WHERE user_id = $1`,
      [ownerUserId],
    );
    await client.query(
      `DELETE FROM invitation_email_events
       WHERE invitation_id IN (SELECT id FROM invitations WHERE company_id = $1)`,
      [companyId],
    );
  } finally {
    await client.end();
  }
}

/**
 * Seed N password-reset events of the given `type` for the dedicated
 * owner. The count CTE joins password_reset_email_events to
 * memberships on user_id = company_id, and the dedicated owner is the
 * only member of this workspace (the setup defensively prunes sibling
 * memberships) so each row reliably contributes to this workspace's
 * count.
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
      const off = i * 3;
      values.push(`($${off + 1}, $${off + 2}, $${off + 3})`);
      params.push(crypto.randomUUID(), ownerUserId, type);
    }
    await client.query(
      `INSERT INTO password_reset_email_events (token_id, user_id, type)
       VALUES ${values.join(",")}`,
      params,
    );
  } finally {
    await client.end();
  }
}

let cachedShared: SharedFixture | null = null;
async function getShared(): Promise<SharedFixture> {
  if (cachedShared) return cachedShared;
  cachedShared = readSharedFixture();
  return cachedShared;
}

/** Pin the call to the dedicated workspace via x-company-id (matches the
 *  pinning style in `email-delivery-alerts.spec.ts`). */
async function getCount(
  request: APIRequestContext,
  query: Record<string, string> = {},
): Promise<number> {
  const { companyId } = await getShared();
  const qs = new URLSearchParams(query).toString();
  const url =
    "/api/auth/email-deliveries/count" + (qs ? `?${qs}` : "");
  const res = await request.get(url, {
    headers: { "x-company-id": String(companyId) },
  });
  expect(
    res.status(),
    `GET ${url} should return 200, got ${res.status()}: ${await res.text()}`,
  ).toBe(200);
  const body = (await res.json()) as { count: number; cap: number };
  expect(typeof body.count).toBe("number");
  return body.count;
}

test.describe("email-delivery count cache @count-cache", () => {
  test.use({ storageState: OWNER_STORAGE });

  test.beforeEach(async () => {
    await resetEvents();
    // The count cache lives in-process on the dev-server with a 5s TTL,
    // so a cached value from a prior test in this file (or, in
    // principle, any sibling spec — but none exists today) could
    // satisfy the first probe of the next test before the wipe is
    // reflected. Wait one TTL + a small jitter buffer so every test
    // starts from a guaranteed-cold cache for *every* filter key.
    await new Promise((r) => setTimeout(r, TTL_MS + 500));
  });

  test("freshness: a new event is reflected within the TTL window", async ({
    request,
  }) => {
    // Prime the cache with the empty-floor value. The first call is a
    // miss; the second-and-onward inside TTL would be served from
    // cache.
    const initial = await getCount(request);
    expect(initial).toBe(0);

    // Insert an event AFTER the cache was warmed. If the TTL contract
    // holds (cache expires at ~5s), the count must catch up to 1
    // before TTL + a generous margin elapses. Without the TTL we'd
    // see 0 forever from this process's perspective.
    await seedEvents("bounced", 1);

    // Poll just past the documented TTL with a small jitter buffer so
    // we don't flake on a slow scheduler. We deliberately do NOT call
    // a different filter combo to bypass the cache — the whole point
    // of this assertion is that the SAME cache key freshens itself.
    const deadline = Date.now() + TTL_MS + 4_000;
    let observed = initial;
    while (Date.now() < deadline) {
      observed = await getCount(request);
      if (observed === 1) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(
      observed,
      `count should reflect the new event within the TTL window ` +
        `(${TTL_MS}ms + jitter); last observed value was ${observed}`,
    ).toBe(1);
  });

  test("per-filter independence: every filter combo returns its own count", async ({
    request,
  }) => {
    // Seed two distinct status buckets with deliberately different
    // counts so a filter that gets dropped from the cache key would
    // surface as a wrong-shaped answer (e.g. `status=bounced` echoing
    // the unfiltered total of 6 instead of 2).
    await seedEvents("bounced", 2);
    await seedEvents("sent", 4);

    // Issue the unfiltered probe FIRST so its value (6) is the one
    // most likely to leak into a sibling combo if the cache key were
    // missing the status filter. The order matters: caching the wrong
    // shape upstream is the failure mode we're trying to catch.
    const unfiltered = await getCount(request);
    expect(unfiltered, "unfiltered count should see all 6 events").toBe(6);

    const bounced = await getCount(request, { status: "bounced" });
    expect(
      bounced,
      "status=bounced must not return the unfiltered cached value (6)",
    ).toBe(2);

    const sent = await getCount(request, { status: "sent" });
    expect(
      sent,
      "status=sent must not return any sibling combo's cached value",
    ).toBe(4);

    // Recipient-scoped probe — proves the email filter is part of the
    // cache key. A bogus recipient must return 0 even though the same
    // workspace's unfiltered count is 6.
    const noMatch = await getCount(request, {
      email: "no-such-recipient@nowhere.invalid",
    });
    expect(
      noMatch,
      "email filter must not be ignored — bogus recipient should return 0",
    ).toBe(0);

    // ...and a recipient that DOES match (substring of the dedicated
    // owner's email — `e2e-edcc-owner@example.test`) must see all 6,
    // not the bogus combo's 0. This proves the cache key keys on the
    // FILTER VALUE, not just on the presence of an email filter.
    const matched = await getCount(request, { email: "edcc-owner" });
    expect(
      matched,
      "matching email filter must not echo the bogus filter's cached 0",
    ).toBe(6);

    // Repeating an earlier probe is a sanity check that the cache is
    // actually serving (and not, for example, returning something
    // unrelated). The value must be consistent and equal to what we
    // saw the first time around.
    const bouncedAgain = await getCount(request, { status: "bounced" });
    expect(
      bouncedAgain,
      "repeated identical probe should return the same per-filter count",
    ).toBe(2);

    // Date-window filter — proves `from` is part of the cache key.
    // A `from` set well in the future yields 0 (no events that recent),
    // which must NOT echo any of the earlier filter combos' counts.
    const futureFrom = await getCount(request, { from: "2999-01-01" });
    expect(
      futureFrom,
      "future `from` filter must return 0, not echo a sibling combo's cached count",
    ).toBe(0);

    // ...and the symmetric `to` probe — a `to` set well in the past
    // also returns 0 and must NOT echo a sibling combo's cached count.
    // Together with the `from` probe this locks down both halves of
    // the date-window cache-key contract.
    const ancientTo = await getCount(request, { to: "1970-01-01" });
    expect(
      ancientTo,
      "ancient `to` filter must return 0, not echo a sibling combo's cached count",
    ).toBe(0);
  });
});
