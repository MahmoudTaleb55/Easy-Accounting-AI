import { test, expect, type APIRequestContext } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * End-to-end coverage for the unified email-delivery list query
 * (`GET /api/auth/email-deliveries`). Exists to lock in the rewrite
 * that deferred the recipient join until *after* DISTINCT ON collapse:
 *
 *  - Recipient and role on the response must keep matching the
 *    invitation row / users row, even though the inner CTE no longer
 *    joins them. A regression that wires the post-collapse JOIN
 *    incorrectly (e.g. through password_reset_tokens, which can be
 *    pruned independently of its event log) would silently blank the
 *    recipient column on the Recent sends table.
 *
 *  - The list and count endpoints must agree on row counts when given
 *    the same filters. Both surfaces consume the same
 *    `parseEmailDeliveryFilters` helper now, but the two SQL queries
 *    are separate and could drift if either is edited in isolation.
 *
 *  - The status / recipient / date filters must continue to apply
 *    correctly. The list query now filters status + recipient
 *    *post-collapse* (recipient is constant per dedup_key), and a
 *    refactor that loses or reorders one of them would slip past unit
 *    coverage.
 *
 * Reuses the dedicated workspace + owner storage state provisioned by
 * `email-delivery-alerts.setup.ts` so every seeded row is anchored to
 * a workspace no other spec touches; that makes the count + list
 * assertions deterministic when Playwright runs spec projects in
 * parallel.
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

function requiredDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("DATABASE_URL must be set for the email-delivery-list-parity spec.");
  return url;
}

interface SeedHandle {
  invitationId: string;
  inviteeEmail: string;
  inviteeRole: string;
  invitationMessageIds: string[];
  passwordResetMessageIds: string[];
}

/**
 * Wipe and seed event rows for the dedicated workspace so every test
 * starts from a known-empty floor. Mirrors the wipe pattern the
 * alert-evaluator spec uses, restricted to event tables this spec
 * cares about.
 */
async function resetAndSeed(
  client: pg.Client,
  companyId: number,
  ownerUserId: string,
): Promise<SeedHandle> {
  // Tear down any rows from prior runs of *this* spec — keyed on the
  // dedicated workspace + owner so we don't disturb sibling specs.
  await client.query(
    `DELETE FROM invitation_email_events
     WHERE invitation_id IN (SELECT id FROM invitations WHERE company_id = $1)`,
    [companyId],
  );
  await client.query(`DELETE FROM invitations WHERE company_id = $1`, [
    companyId,
  ]);
  await client.query(
    `DELETE FROM password_reset_email_events WHERE user_id = $1`,
    [ownerUserId],
  );

  // (a) One invitation, one role — recipient + role on the API response
  //     should exactly mirror these.
  const invitationId = crypto.randomUUID();
  const inviteeEmail = `e2e-edl-invitee-${Date.now()}@example.test`;
  const inviteeRole = "accountant";
  await client.query(
    `INSERT INTO invitations
       (id, company_id, invited_by_user_id, email, role, token, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW() + INTERVAL '7 days')`,
    [
      invitationId,
      companyId,
      ownerUserId,
      inviteeEmail,
      inviteeRole,
      crypto.randomBytes(24).toString("hex"),
    ],
  );

  // (b) Two invitation send attempts (distinct message ids), each with
  //     a couple of follow-up webhooks so the DISTINCT ON collapse has
  //     real work to do. The most recent event per attempt should
  //     drive the row's latestStatus.
  const invitationMessageIds = [
    `msg-inv-${crypto.randomUUID()}`,
    `msg-inv-${crypto.randomUUID()}`,
  ];
  // Attempt 1: sent → delivered (latest = delivered)
  await insertInvitationEvent(client, invitationId, invitationMessageIds[0], "sent", null, -120);
  await insertInvitationEvent(client, invitationId, invitationMessageIds[0], "delivered", null, -60);
  // Attempt 2 (resend): sent → bounced (latest = bounced)
  await insertInvitationEvent(client, invitationId, invitationMessageIds[1], "sent", null, -45);
  await insertInvitationEvent(
    client,
    invitationId,
    invitationMessageIds[1],
    "bounced",
    "mailbox not found",
    -15,
  );

  // (c) One password-reset send attempt for the dedicated owner. The
  //     event carries user_id directly; the rewritten list query must
  //     still resolve the recipient via users.user_id (NOT via
  //     password_reset_tokens, which we deliberately do *not* insert
  //     here so the regression where the join goes through tokens
  //     would surface as an empty recipient).
  const passwordResetMessageIds = [`msg-prt-${crypto.randomUUID()}`];
  await insertPasswordResetEvent(
    client,
    ownerUserId,
    passwordResetMessageIds[0],
    "sent",
    null,
    -90,
  );
  await insertPasswordResetEvent(
    client,
    ownerUserId,
    passwordResetMessageIds[0],
    "delivered",
    null,
    -30,
  );

  return {
    invitationId,
    inviteeEmail,
    inviteeRole,
    invitationMessageIds,
    passwordResetMessageIds,
  };
}

async function insertInvitationEvent(
  client: pg.Client,
  invitationId: string,
  messageId: string,
  type: string,
  error: string | null,
  secondsAgo: number,
): Promise<void> {
  await client.query(
    `INSERT INTO invitation_email_events
       (id, invitation_id, message_id, type, error, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' seconds')::interval)`,
    [crypto.randomUUID(), invitationId, messageId, type, error, secondsAgo],
  );
}

async function insertPasswordResetEvent(
  client: pg.Client,
  userId: string,
  messageId: string,
  type: string,
  error: string | null,
  secondsAgo: number,
): Promise<void> {
  // token_id is NOT NULL on the schema; we use a synthetic uuid so the
  // event row is satisfied without inserting a corresponding
  // password_reset_tokens row. The rewritten list query must NOT depend
  // on a tokens row existing — it should resolve the recipient via the
  // event's own user_id.
  await client.query(
    `INSERT INTO password_reset_email_events
       (id, token_id, user_id, message_id, type, error, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 || ' seconds')::interval)`,
    [
      crypto.randomUUID(),
      crypto.randomUUID(),
      userId,
      messageId,
      type,
      error,
      secondsAgo,
    ],
  );
}

interface DeliveryRow {
  transport: "invitation" | "password_reset";
  key: string;
  messageId: string | null;
  parentId: string;
  recipient: string;
  role: string | null;
  latestStatus: string;
  latestError: string | null;
  latestAt: string | null;
  firstAt: string | null;
}

async function fetchList(
  request: APIRequestContext,
  companyId: number,
  qs = "",
): Promise<DeliveryRow[]> {
  const url = `/api/auth/email-deliveries${qs ? `?${qs}` : ""}`;
  const res = await request.get(url, {
    headers: { "x-company-id": String(companyId) },
  });
  expect(res.status(), `GET ${url} should be 200`).toBe(200);
  return (await res.json()) as DeliveryRow[];
}

async function fetchCount(
  request: APIRequestContext,
  companyId: number,
  qs = "",
): Promise<number> {
  const url = `/api/auth/email-deliveries/count${qs ? `?${qs}` : ""}`;
  const res = await request.get(url, {
    headers: { "x-company-id": String(companyId) },
  });
  expect(res.status(), `GET ${url} should be 200`).toBe(200);
  const body = (await res.json()) as { count: number };
  return body.count;
}

test.describe("email-delivery list parity @list-parity", () => {
  test.use({ storageState: OWNER_STORAGE });

  let companyId: number;
  let ownerUserId: string;
  let seed: SeedHandle;

  test.beforeAll(async () => {
    const fixture = readSharedFixture();
    companyId = fixture.companyId;
    ownerUserId = fixture.ownerUserId;
    const client = new pg.Client({ connectionString: requiredDbUrl() });
    await client.connect();
    try {
      seed = await resetAndSeed(client, companyId, ownerUserId);
    } finally {
      await client.end();
    }
  });

  test("list returns one row per send attempt with recipient + role joined post-collapse", async ({
    request,
  }) => {
    const rows = await fetchList(request, companyId);

    // Restrict to the rows this spec seeded — sibling specs may drop
    // additional events into this workspace's invitation log even
    // though it's "dedicated", and we want to assert specifically on
    // the rows we own.
    const ours = rows.filter(
      (r) =>
        seed.invitationMessageIds.includes(r.messageId ?? "") ||
        seed.passwordResetMessageIds.includes(r.messageId ?? ""),
    );

    expect(ours).toHaveLength(
      seed.invitationMessageIds.length + seed.passwordResetMessageIds.length,
    );

    // Invitation rows: recipient + role come from the invitations
    // table via the *deferred* JOIN. A regression that loses this
    // join would surface as an empty recipient or null role.
    const invRows = ours.filter((r) => r.transport === "invitation");
    expect(invRows).toHaveLength(seed.invitationMessageIds.length);
    for (const r of invRows) {
      expect(r.recipient).toBe(seed.inviteeEmail);
      expect(r.role).toBe(seed.inviteeRole);
      expect(r.parentId).toBe(seed.invitationId);
    }
    // The latest event per attempt drives latestStatus — verify the
    // DISTINCT ON collapse picked the most recent webhook, not the
    // initial send.
    const byMsg = new Map(invRows.map((r) => [r.messageId, r]));
    expect(byMsg.get(seed.invitationMessageIds[0])?.latestStatus).toBe(
      "delivered",
    );
    expect(byMsg.get(seed.invitationMessageIds[1])?.latestStatus).toBe(
      "bounced",
    );
    expect(byMsg.get(seed.invitationMessageIds[1])?.latestError).toBe(
      "mailbox not found",
    );

    // Password-reset row: recipient must resolve via the event's own
    // user_id (NOT via password_reset_tokens, which we never inserted).
    // This is the canonical test for the deferred-join regression
    // described in the spec header.
    const prtRows = ours.filter((r) => r.transport === "password_reset");
    expect(prtRows).toHaveLength(seed.passwordResetMessageIds.length);
    for (const r of prtRows) {
      // The dedicated owner's email is whatever the alerts setup
      // assigned (e2e-edap-owner@example.test). Recipient must NOT
      // be empty — that would mean the JOIN was wired through
      // password_reset_tokens (which we deliberately did not seed).
      expect(r.recipient).not.toBe("");
      expect(r.recipient).toMatch(/^e2e-edap-owner@/);
      expect(r.role).toBeNull();
      // latest collapsed correctly (sent → delivered)
      expect(r.latestStatus).toBe("delivered");
    }
  });

  test("list and count agree on row counts under the same filters", async ({
    request,
  }) => {
    // Probe a handful of filter combos. Each pair (list result length
    // vs. count) must match — they share `parseEmailDeliveryFilters`
    // now but issue distinct SQL, so this is the regression net for
    // accidental drift.
    const probes: Array<{ label: string; qs: string }> = [
      { label: "no filters", qs: "" },
      { label: "status=bounced", qs: "status=bounced" },
      { label: "status=delivered", qs: "status=delivered" },
      // Recipient substring: matches the seeded invitee but not the
      // dedicated owner. The "edl-invitee" prefix is unique to seeds
      // produced by *this* spec.
      { label: "email substring matches invitee", qs: "email=edl-invitee" },
      // Wide date window — every seeded event is within the last few
      // minutes, so the result is identical to the no-filter probe.
      {
        label: "wide date window",
        qs: `from=${new Date(Date.now() - 24 * 3600 * 1000)
          .toISOString()
          .slice(0, 10)}&to=${new Date(Date.now() + 24 * 3600 * 1000)
          .toISOString()
          .slice(0, 10)}`,
      },
    ];

    for (const probe of probes) {
      const list = await fetchList(request, companyId, probe.qs);
      const count = await fetchCount(request, companyId, probe.qs);
      expect(
        list.length,
        `list length should match count for ${probe.label}`,
      ).toBe(count);
    }
  });

  test("status and recipient filters narrow the list correctly", async ({
    request,
  }) => {
    // status=bounced should surface exactly the second invitation
    // attempt (no other seeded row has this status).
    const bounced = await fetchList(request, companyId, "status=bounced");
    const ours = bounced.filter(
      (r) =>
        seed.invitationMessageIds.includes(r.messageId ?? "") ||
        seed.passwordResetMessageIds.includes(r.messageId ?? ""),
    );
    expect(ours).toHaveLength(1);
    expect(ours[0].messageId).toBe(seed.invitationMessageIds[1]);
    expect(ours[0].latestStatus).toBe("bounced");
    expect(ours[0].recipient).toBe(seed.inviteeEmail);

    // Recipient filter scoped to the invitee's domain — must include
    // every invitation attempt (both share the same recipient) and
    // exclude the password-reset row (different domain).
    const byInvitee = await fetchList(
      request,
      companyId,
      "email=edl-invitee",
    );
    const ourMatches = byInvitee.filter(
      (r) =>
        seed.invitationMessageIds.includes(r.messageId ?? "") ||
        seed.passwordResetMessageIds.includes(r.messageId ?? ""),
    );
    expect(ourMatches).toHaveLength(seed.invitationMessageIds.length);
    expect(ourMatches.every((r) => r.transport === "invitation")).toBe(true);
  });
});
