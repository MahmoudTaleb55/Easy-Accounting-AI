import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Sibling regression net to `payroll-journal-link.spec.ts` — that suite
 * locks the "From: …" source-link badge contract for the `payroll_run`
 * branch of `JournalEntrySourceKind` (server/storage.ts →
 * `buildJournalSourceLinkMap`, shared/schema.ts). This spec mirrors the
 * same contract for the four remaining branches the union supports:
 * `depreciation_run`, `impairment`, `revaluation`, and `disposal`.
 *
 * Without this spec a future change to any of those four branches —
 * for example a stale link object the server keeps emitting after the
 * upstream row is deleted, a dangling href, or a kind / surface label
 * drift — would not be caught by any automated test. The payroll spec
 * proves the wiring works for one of five kinds; here we extend the
 * proof to the other four in one pass.
 *
 * For each of the four kinds the spec asserts on three surfaces:
 *   1. The JE row on `/app/journal` (canonical badge test id
 *      `link-je-source-{kind}-{id}` with the right href).
 *   2. The JE detail dialog opened by clicking `link-entry-{jeId}`
 *      (suffixed test id `link-je-source-detail-{kind}-{id}`).
 *   3. The Recent admin activity feed on `/app/settings` (suffixed
 *      test id `link-je-source-admin-activity-{kind}-{id}`).
 *
 * The destructive half then deletes each upstream row and asserts the
 * badge disappears on every surface while the JE itself stays visible
 * — the exact contract the payroll spec already pins for
 * `payroll_run`. The setup project re-seeds the workspace on every spec
 * run so leaving the rows deleted at test exit is safe.
 *
 * Auth + seed live in `depreciation-asset-event-journal-link.setup.ts`.
 */

interface Fixtures {
  companyId: number;
  assetId: number;
  entryDateStr: string;
  depreciationRunId: number;
  impairmentEventId: number;
  revaluationEventId: number;
  disposalEventId: number;
  depreciationJeId: number;
  impairmentJeId: number;
  revaluationJeId: number;
  disposalJeId: number;
}

function loadFixtures(): Fixtures {
  const p = path.resolve(
    ".playwright/depreciation-asset-event-journal-link-fixtures.json",
  );
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw) as Fixtures;
}

/**
 * The four `JournalEntrySourceKind` branches this spec exercises, paired
 * with everything the badge / surface / delete steps need to know about
 * each one. Keeping them in a table lets the positive + destructive
 * assertions drive every kind through the same loop instead of growing
 * four near-identical copies.
 *
 * `expectedHref` mirrors the href shape `buildJournalSourceLinkMap`
 * produces in `server/storage.ts`:
 *   • `depreciation_run` → `/app/fixed-assets#dr-{runId}`
 *   • `impairment | revaluation | disposal` → `/app/fixed-assets#asset-{assetId}`
 *
 * `deleteSql` runs against the same workspace (scoped by both the row
 * id AND `company_id` so the statement is self-defending against a
 * future widening of the seeded workspace). None of the four upstream
 * tables carry an FK from the JE side, so a single DELETE is enough.
 */
type Kind = "depreciation_run" | "impairment" | "revaluation" | "disposal";

interface KindCase {
  kind: Kind;
  /** Human-readable label used in test failure messages. */
  label: string;
  /** id of the upstream row inside the seeded workspace. */
  upstreamId: (fx: Fixtures) => number;
  /** id of the JE the upstream row points at. */
  jeId: (fx: Fixtures) => number;
  /** Expected `href` on the rendered badge. */
  expectedHref: (fx: Fixtures) => string;
  /** SQL that wipes the upstream row (workspace-scoped). */
  deleteSql: { table: string };
}

const KIND_CASES: KindCase[] = [
  {
    kind: "depreciation_run",
    label: "Depreciation run",
    upstreamId: (fx) => fx.depreciationRunId,
    jeId: (fx) => fx.depreciationJeId,
    expectedHref: (fx) => `/app/fixed-assets#dr-${fx.depreciationRunId}`,
    deleteSql: { table: "depreciation_runs" },
  },
  {
    kind: "impairment",
    label: "Impairment event",
    upstreamId: (fx) => fx.impairmentEventId,
    jeId: (fx) => fx.impairmentJeId,
    expectedHref: (fx) => `/app/fixed-assets#asset-${fx.assetId}`,
    deleteSql: { table: "impairment_events" },
  },
  {
    kind: "revaluation",
    label: "Revaluation event",
    upstreamId: (fx) => fx.revaluationEventId,
    jeId: (fx) => fx.revaluationJeId,
    expectedHref: (fx) => `/app/fixed-assets#asset-${fx.assetId}`,
    deleteSql: { table: "revaluation_events" },
  },
  {
    kind: "disposal",
    label: "Disposal event",
    upstreamId: (fx) => fx.disposalEventId,
    jeId: (fx) => fx.disposalJeId,
    expectedHref: (fx) => `/app/fixed-assets#asset-${fx.assetId}`,
    deleteSql: { table: "disposals" },
  },
];

/**
 * Walks the three surfaces (`/app/journal` row, JE detail dialog,
 * `/app/settings` Recent admin activity feed) and asserts the badge for
 * `case` is present with the correct href on every one. Used by the
 * positive test below.
 */
async function assertBadgeOnEverySurface(
  page: Page,
  fx: Fixtures,
  c: KindCase,
): Promise<void> {
  const jeId = c.jeId(fx);
  const upId = c.upstreamId(fx);
  const href = c.expectedHref(fx);

  // (1) /app/journal row badge.
  await page.goto("/app/journal");
  const card = page.locator(`[data-testid="card-entry-${jeId}"]`);
  await expect(
    card,
    `${c.label}: the seeded JE card must render in the journal list`,
  ).toBeVisible();
  const rowBadge = card.locator(
    `[data-testid="link-je-source-${c.kind}-${upId}"]`,
  );
  await expect(
    rowBadge,
    `${c.label}: the JE row must surface the From: ${c.label} back-link`,
  ).toBeVisible();
  await expect(rowBadge).toHaveAttribute("href", href);

  // (2) JE detail dialog badge — the same `JournalEntrySourceLink` is
  // rendered with surface="detail", so the test id is suffixed.
  await card.locator(`[data-testid="link-entry-${jeId}"]`).click();
  const dialog = page.locator('[data-testid="dialog-entry-detail"]');
  await expect(
    dialog,
    `${c.label}: the JE detail dialog must open`,
  ).toBeVisible();
  const dialogBadge = dialog.locator(
    `[data-testid="link-je-source-detail-${c.kind}-${upId}"]`,
  );
  await expect(
    dialogBadge,
    `${c.label}: the JE detail dialog must surface the same back-link badge`,
  ).toBeVisible();
  await expect(dialogBadge).toHaveAttribute("href", href);

  // (3) Recent admin activity feed badge on /app/settings (the same
  // SourceLinkBadge is rendered through SecurityCompliance with
  // surface="admin-activity").
  await page.goto("/app/settings");
  const adminRow = page.locator(`[data-testid="row-admin-activity-${jeId}"]`);
  await expect(
    adminRow,
    `${c.label}: the seeded JE must appear in the Recent admin activity feed`,
  ).toBeVisible();
  const adminBadge = adminRow.locator(
    `[data-testid="link-je-source-admin-activity-${c.kind}-${upId}"]`,
  );
  await expect(
    adminBadge,
    `${c.label}: the admin-activity row must surface the same back-link badge`,
  ).toBeVisible();
  await expect(adminBadge).toHaveAttribute("href", href);
}

/**
 * Mirror of `assertBadgeOnEverySurface` — but asserts the badge is
 * GONE on every surface while the JE itself stays visible. We use
 * `count(0)` (rather than `not.toBeVisible`) so an off-screen but
 * still-mounted badge would also fail the assertion.
 */
async function assertBadgeGoneOnEverySurface(
  page: Page,
  fx: Fixtures,
  c: KindCase,
): Promise<void> {
  const jeId = c.jeId(fx);
  const upId = c.upstreamId(fx);

  // (1) /app/journal row: card stays, badge is gone.
  await page.goto("/app/journal");
  const card = page.locator(`[data-testid="card-entry-${jeId}"]`);
  await expect(
    card,
    `${c.label}: the JE row must remain visible after the upstream row is deleted`,
  ).toBeVisible();
  await expect(
    card.locator(`[data-testid="link-je-source-${c.kind}-${upId}"]`),
    `${c.label}: the JE row badge must disappear once the upstream row is deleted`,
  ).toHaveCount(0);

  // (2) JE detail dialog still opens, but the badge is gone.
  await card.locator(`[data-testid="link-entry-${jeId}"]`).click();
  const dialog = page.locator('[data-testid="dialog-entry-detail"]');
  await expect(
    dialog,
    `${c.label}: the JE detail dialog must still open for the entry whose source row was deleted`,
  ).toBeVisible();
  await expect(
    dialog.locator(
      `[data-testid="link-je-source-detail-${c.kind}-${upId}"]`,
    ),
    `${c.label}: the JE detail dialog must not surface a stale back-link badge`,
  ).toHaveCount(0);

  // (3) Recent admin activity row still shows, but the badge is gone.
  await page.goto("/app/settings");
  const adminRow = page.locator(`[data-testid="row-admin-activity-${jeId}"]`);
  await expect(
    adminRow,
    `${c.label}: the JE must still appear in the Recent admin activity feed after the upstream delete`,
  ).toBeVisible();
  await expect(
    adminRow.locator(
      `[data-testid="link-je-source-admin-activity-${c.kind}-${upId}"]`,
    ),
    `${c.label}: the admin-activity row must not surface a stale back-link badge`,
  ).toHaveCount(0);
}

test.describe("depreciation + asset-event → journal-entry source-link badge", () => {
  /**
   * Positive contract: the badge renders on every JE-bearing surface
   * for every one of the four `JournalEntrySourceKind` branches the
   * payroll spec doesn't already cover. We loop through the seeded
   * kinds rather than growing four near-identical tests so a future
   * sixth kind only needs a new entry in `KIND_CASES`.
   *
   * IMPORTANT: this test runs FIRST. The destructive test below
   * mutates the seeded workspace, so every "badge present" assertion
   * must happen before any upstream row is deleted.
   */
  test("badge appears on JE row + detail dialog + admin-activity feed for every kind", async ({
    page,
  }) => {
    const fx = loadFixtures();
    for (const c of KIND_CASES) {
      await assertBadgeOnEverySurface(page, fx, c);
    }
  });

  /**
   * Other half of the source-link contract: when the upstream record
   * (a `depreciation_runs`, `impairment_events`, `revaluation_events`,
   * or `disposals` row) is deleted, `buildJournalSourceLinkMap` in
   * `server/storage.ts` no longer finds a row for the JE id and
   * returns no entry in the link map. The UI must then hide the
   * badge on every surface (`/app/journal` row + JE detail dialog +
   * Recent admin activity feed) while keeping the JE itself visible.
   * Without a regression test, a future change that starts emitting
   * a stale link object — or a dangling href to e.g.
   * `/app/fixed-assets#dr-<id>` for a run that no longer exists —
   * would silently break the UX.
   *
   * IMPORTANT: this test mutates the seeded workspace. It is
   * intentionally declared LAST so the positive test above (which
   * assumes every upstream row is present) runs first. The setup
   * project re-seeds the workspace on every spec run so leaving the
   * rows deleted at test exit is safe.
   */
  test("badge disappears cleanly on every surface after each upstream row is deleted", async ({
    page,
  }) => {
    const fx = loadFixtures();
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error(
        "DATABASE_URL must be set so this spec can delete the seeded upstream rows.",
      );
    }

    // Sanity check: every badge must still be present before the
    // delete step. If this fails, either a sibling test mutated the
    // seed or the positive half ran in the wrong order — both are
    // bugs the spec wants to catch before drawing conclusions from
    // the post-delete assertions below.
    for (const c of KIND_CASES) {
      await page.goto("/app/journal");
      const card = page.locator(`[data-testid="card-entry-${c.jeId(fx)}"]`);
      await expect(
        card.locator(
          `[data-testid="link-je-source-${c.kind}-${c.upstreamId(fx)}"]`,
        ),
        `${c.label}: the badge must be present on /app/journal before the upstream row is deleted`,
      ).toBeVisible();
    }

    // Delete each upstream row — workspace-scoped so a future
    // widening of the seeded workspace can't accidentally widen the
    // delete. None of the four tables carry FK pointers from the JE
    // side, so a single DELETE is enough; we did not insert any
    // depreciation_postings for the seeded run, so the depreciation
    // delete also has no child rows to cascade.
    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    try {
      for (const c of KIND_CASES) {
        const res = await client.query(
          `DELETE FROM ${c.deleteSql.table} WHERE id = $1 AND company_id = $2`,
          [c.upstreamId(fx), fx.companyId],
        );
        expect(
          res.rowCount,
          `${c.label}: deleting the seeded ${c.deleteSql.table} row must affect exactly one row`,
        ).toBe(1);
      }
    } finally {
      await client.end();
    }

    for (const c of KIND_CASES) {
      await assertBadgeGoneOnEverySurface(page, fx, c);
    }
  });
});
