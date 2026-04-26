import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import pg from "pg";
import {
  ensureCompany,
  ensureUser,
  forgeSession,
  requireDbUrl,
} from "./_helpers/forge-session";
import { gotoWithPinnedLocale } from "./_helpers/pin-locale";

/**
 * Regression coverage for the per-entity-type "remembered period" behaviour
 * on `HistoryTimeline` (rendered inside the HR detail dialogs' "Changes"
 * tab — see `client/src/components/audit/history-drawer.tsx`).
 *
 * The drawer persists the selected period preset (`all`, `7d`, `30d`,
 * `90d`, `entity`) under `localStorage["history.periodFilter.<entityType>"]`,
 * keyed per entity type so a user who lives in "Last 30 days" on
 * attendance still sees "All time" the first time they open a leave row.
 * The behaviour is verified end-to-end here so a future refactor of
 * `HistoryTimeline` (e.g. moving the persistence into a shared hook,
 * renaming the storage key namespace, switching the validator) can't
 * silently drop the contract.
 *
 * What this spec walks through:
 *   1. Provision a fresh user + workspace via the shared DB seed
 *      helpers (skips the signup rate limit), then forge a session so
 *      the browser carries `connect.sid` over plain HTTP.
 *   2. Seed an employee + an attendance row + a leave row through the
 *      real `/api/hr/*` routes so each row has at least one audit
 *      event (the period filter UI is gated on `events.length > 0`).
 *   3. Open the attendance detail dialog → Changes tab, switch the
 *      period to "Last 30 days", close + reopen the dialog, assert the
 *      trigger still shows "Last 30 days" (in-session round-trip).
 *   4. Reload the page, reopen the attendance dialog, assert the
 *      trigger AND the localStorage key both still hold "Last 30 days"
 *      (cross-reload round-trip).
 *   5. Open the leave detail dialog and assert it independently
 *      defaults to "All time" (proves the per-entity-type keying), then
 *      switch it to "Last 7 days" and assert the attendance key is
 *      unchanged (cross-entity-type isolation).
 *   6. Poke a known-bad value into the attendance storage key and
 *      assert the page falls back to "All time" on the next open
 *      (mirrors the validator-rejects-stale-storage check in
 *      `email-delivery-filters-persist.spec.ts`).
 */

const TEST_EMAIL = "e2e-hr-history-period@example.test";
const TEST_PASSWORD = "playwright-hr-history-period-pw-2026";
const TEST_FIRST = "HR";
const TEST_LAST = "HistoryPeriod";
const STORAGE_PATH = path.resolve(
  ".playwright/hr-history-period-state.json",
);

const ATTENDANCE_KEY = "history.periodFilter.attendance";
const LEAVE_KEY = "history.periodFilter.leave";

// English period labels match `HistoryTimeline`'s `labels` map for
// `locale === "en"`. The spec navigates with `?lang=en` (via
// `gotoWithPinnedLocale`) so these strings are stable regardless of the
// seeded user's `preferred_locale`.
const LABEL_ALL = "All time";
const LABEL_30D = "Last 30 days";
const LABEL_7D = "Last 7 days";

interface SeededIds {
  companyId: number;
  attendanceId: number;
  leaveId: number;
  attendanceDate: string;
}

/**
 * Retry a request when it surfaces the dev server's workspace-isolation
 * throw guard. The guard (see `warnUnscopedDbAccess` in `server/db.ts`)
 * is opt-in via `WORKSPACE_ISOLATION_GUARD=throw` — wired into the e2e
 * webServer config. It throws ONCE per call site for the lifetime of the
 * process (the dedup `Set` is checked + populated before the throw), so
 * a follow-up request to the same call site always succeeds. A handful
 * of legitimate pre-membership / cross-tenant lookups (the auth user
 * lookup, the membership resolver) aren't yet wrapped in
 * `withUnscopedDb`, which means a fresh dev server can throw on the
 * very first call. This helper turns that "first request loses" wart
 * into a cooperative warm-up so the spec can survive a cold boot
 * without depending on any other test having warmed the server first.
 */
async function postWithIsolationWarmup(
  page: Page,
  url: string,
  init: { headers: Record<string, string>; data: unknown },
): Promise<{ status: number; bodyText: string }> {
  const MAX_ATTEMPTS = 4;
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await page.request.post(url, init);
    lastStatus = res.status();
    lastBody = await res.text();
    if (lastStatus < 500) return { status: lastStatus, bodyText: lastBody };
    // Only retry on the workspace-isolation guard's distinctive marker —
    // any other 500 is a real failure we want to surface immediately.
    if (!lastBody.includes("workspace-isolation")) {
      return { status: lastStatus, bodyText: lastBody };
    }
  }
  return { status: lastStatus, bodyText: lastBody };
}

async function seedAndLogin(page: Page): Promise<SeededIds> {
  const dbUrl = requireDbUrl("the hr-history-period-persist spec");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let userId: string;
  let companyId: number;
  try {
    // Pin `preferred_locale='en'` so the timeline labels render in
    // English even before the URL `?lang=en` override kicks in. The
    // override is the load-bearing pin (LocaleSync would otherwise
    // reconcile against the server preference moments after first
    // paint), but matching the seeded value to the URL pin keeps the
    // spec deterministic on a fresh DB and on re-runs alike.
    userId = await ensureUser(client, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: TEST_FIRST,
      lastName: TEST_LAST,
      preferredLocale: "en",
    });
    companyId = await ensureCompany(client, {
      userId,
      role: "owner",
      companyName: "HR History Period Test Co",
    });
  } finally {
    await client.end();
  }

  // `forgeSession` plants the cookie then immediately verifies
  // `/api/auth/user` returns 200. On a freshly-booted dev server the
  // workspace-isolation throw guard (`WORKSPACE_ISOLATION_GUARD=throw`)
  // can throw once on the very first authenticated hit because
  // `AuthStorage.getUser` isn't wrapped in `withUnscopedDb`. Subsequent
  // calls succeed (the dedup `Set` already holds the call site), so a
  // small retry around the helper turns a cold-boot flake into a
  // deterministic warm-up. See the comment on
  // `postWithIsolationWarmup` for the broader pattern.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await forgeSession({
        page,
        dbUrl,
        userId,
        email: TEST_EMAIL,
        firstName: TEST_FIRST,
        lastName: TEST_LAST,
        storagePath: STORAGE_PATH,
        afterCookiesPlanted: async (p) => {
          // Pin the active workspace so every authenticated request — and
          // every browser-side mutation — carries the right `X-Company-Id`.
          // Without this the very first authenticated render falls back to
          // the user's first membership, which on a re-run can be a
          // different (older) workspace than the one we just provisioned.
          await p.addInitScript((cid) => {
            window.localStorage.setItem("active_company_id", String(cid));
          }, companyId);
        },
      });
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("workspace-isolation") && !msg.includes("Failed to fetch user")) {
        throw err;
      }
    }
  }
  if (lastErr) throw lastErr;

  // Use today's date for the attendance row so it lands in the
  // attendance tab's current-month query window (the tab defaults to
  // `new Date().toISOString().slice(0, 10).slice(0, 7)` — see
  // `AttendanceTab` in `client/src/pages/hr.tsx`).
  const today = new Date().toISOString().slice(0, 10);

  // ---- Seed via the real /api/hr/* routes ----
  // Each POST writes an audit row inside the same transaction (see
  // `upsertAttendance` / `createLeave` in `server/storage.ts`), which
  // is what gives the timeline at least one event so the period
  // filter UI mounts at all.
  const seedHeaders = {
    "content-type": "application/json",
    "x-company-id": String(companyId),
  } as const;

  const empRes = await postWithIsolationWarmup(page, "/api/hr/employees", {
    headers: seedHeaders,
    data: {
      fullName: "History Period Tester",
      jobTitle: "Engineer",
      hireDate: "2024-01-01",
      baseSalary: 5000,
      allowances: 0,
      isNational: true,
      isActive: true,
    },
  });
  if (empRes.status !== 201) {
    throw new Error(
      `POST /api/hr/employees expected 201 but got ${empRes.status}: ${empRes.bodyText}`,
    );
  }
  const employee = JSON.parse(empRes.bodyText) as { id: number };

  const attRes = await postWithIsolationWarmup(page, "/api/hr/attendance", {
    headers: seedHeaders,
    data: {
      employeeId: employee.id,
      date: today,
      status: "present",
      overtimeHours: 0,
    },
  });
  if (attRes.status !== 201) {
    throw new Error(
      `POST /api/hr/attendance expected 201 but got ${attRes.status}: ${attRes.bodyText}`,
    );
  }
  const attendance = JSON.parse(attRes.bodyText) as { id: number };

  const leaveRes = await postWithIsolationWarmup(page, "/api/hr/leaves", {
    headers: seedHeaders,
    data: {
      employeeId: employee.id,
      startDate: today,
      endDate: today,
      days: 1,
      type: "annual",
      status: "approved",
    },
  });
  if (leaveRes.status !== 201) {
    throw new Error(
      `POST /api/hr/leaves expected 201 but got ${leaveRes.status}: ${leaveRes.bodyText}`,
    );
  }
  const leave = JSON.parse(leaveRes.bodyText) as { id: number };

  return {
    companyId,
    attendanceId: attendance.id,
    leaveId: leave.id,
    attendanceDate: today,
  };
}

async function readStorage(page: Page, key: string): Promise<string | null> {
  return await page.evaluate((k) => window.localStorage.getItem(k), key);
}

async function writeStorage(page: Page, key: string, raw: string): Promise<void> {
  await page.evaluate(
    ({ k, v }) => window.localStorage.setItem(k, v),
    { k: key, v: raw },
  );
}

async function openAttendanceChangesTab(
  page: Page,
  attendanceId: number,
): Promise<void> {
  // Make sure we're on the Attendance tab — clicking the tab is
  // idempotent so re-opening after a reload (which lands on
  // Employees) just works without us having to track state.
  await page.getByTestId("tab-attendance").click();
  const row = page.getByTestId(`link-att-${attendanceId}`);
  await expect(
    row,
    "the seeded attendance row should appear in the current-month list",
  ).toBeVisible({ timeout: 15_000 });
  await row.click();
  const dialog = page.getByTestId("dialog-attendance-detail");
  await expect(dialog).toBeVisible();
  await page.getByTestId("tab-attendance-changes").click();
  // The filter row only mounts once at least one audit event has been
  // fetched — wait on the row itself so the period dropdown is
  // guaranteed to be there before we touch it.
  await expect(
    page.getByTestId("history-filters"),
    "history filters should mount once audit events load",
  ).toBeVisible({ timeout: 15_000 });
}

async function openLeaveChangesTab(page: Page, leaveId: number): Promise<void> {
  await page.getByTestId("tab-leaves").click();
  const row = page.getByTestId(`link-leave-${leaveId}`);
  await expect(row, "the seeded leave row should appear in the list").toBeVisible({
    timeout: 15_000,
  });
  await row.click();
  await expect(page.getByTestId("dialog-leave-detail")).toBeVisible();
  await page.getByTestId("tab-leave-changes").click();
  await expect(page.getByTestId("history-filters")).toBeVisible({
    timeout: 15_000,
  });
}

async function closeOpenDialog(page: Page): Promise<void> {
  // Pressing Escape closes the Radix Dialog and unmounts the
  // HistoryTimeline, which is what we need so the next open is a
  // fresh mount (i.e. the rehydrate-from-localStorage path is the
  // one under test).
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("dialog-attendance-detail")).toHaveCount(0);
  await expect(page.getByTestId("dialog-leave-detail")).toHaveCount(0);
}

async function selectPeriod(page: Page, optionTestId: string): Promise<void> {
  await page.getByTestId("select-history-filter-period").click();
  await page.getByTestId(optionTestId).click();
}

test.describe("HR Changes-tab period filter remembers per entity type @history-period", () => {
  test.use({
    // Desktop viewport so both the Attendance/Leaves tabs and the
    // detail dialog (sm:max-w-2xl) render without mobile collapsing.
    viewport: { width: 1280, height: 800 },
  });

  test("per-entity-type period preset persists across reopens, reloads, and is isolated between attendance and leave", async ({
    page,
  }) => {
    const seeded = await seedAndLogin(page);

    await gotoWithPinnedLocale(page, "/app/hr");
    await expect(page.getByTestId("hr-page")).toBeVisible({ timeout: 15_000 });

    // -----------------------------------------------------------------
    // 1. Attendance: switch to "Last 30 days" and prove the choice
    //    survives close + reopen of the dialog (in-session round-trip).
    // -----------------------------------------------------------------
    await openAttendanceChangesTab(page, seeded.attendanceId);

    // Default before any interaction: the timeline lazy-init reads
    // localStorage; no key has been written yet so we land on "All time".
    await expect(
      page.getByTestId("select-history-filter-period"),
      "period dropdown defaults to All time before any interaction",
    ).toContainText(LABEL_ALL);

    await selectPeriod(page, "option-history-period-30d");
    await expect(
      page.getByTestId("select-history-filter-period"),
      "the dropdown should update its trigger label after selection",
    ).toContainText(LABEL_30D);

    // The setter writes the bare preset string (NOT JSON-stringified)
    // — see `writePersistedPeriod` in `history-drawer.tsx`. Polling
    // here turns a flaky write into a sharper failure than the
    // post-reopen assertion alone would give.
    await expect
      .poll(async () => readStorage(page, ATTENDANCE_KEY))
      .toBe("30d");

    // Close + reopen — the next mount must rehydrate from storage.
    await closeOpenDialog(page);
    await openAttendanceChangesTab(page, seeded.attendanceId);
    await expect(
      page.getByTestId("select-history-filter-period"),
      "reopening the attendance dialog should restore Last 30 days from localStorage",
    ).toContainText(LABEL_30D);

    // -----------------------------------------------------------------
    // 2. Reload the whole page and prove the choice still rehydrates
    //    (cross-reload round-trip). Asserting both the visible label
    //    AND the storage key matches the contract the task spec
    //    asks us to lock in.
    // -----------------------------------------------------------------
    await closeOpenDialog(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("hr-page")).toBeVisible({ timeout: 15_000 });

    // The storage key must survive the reload itself (localStorage is
    // persistent across navigations, so this is mostly a tripwire on
    // the seed phase — but it pinpoints a regression in which the
    // page somehow clears the key on mount).
    expect(
      await readStorage(page, ATTENDANCE_KEY),
      "the attendance period key should survive a hard reload",
    ).toBe("30d");

    await openAttendanceChangesTab(page, seeded.attendanceId);
    await expect(
      page.getByTestId("select-history-filter-period"),
      "attendance period should rehydrate to Last 30 days after a full page reload",
    ).toContainText(LABEL_30D);

    // -----------------------------------------------------------------
    // 3. Leave dialog defaults to "All time" independently of the
    //    attendance choice (proves the per-entity-type keying), then
    //    switching the leave preset must NOT clobber the attendance
    //    storage key.
    // -----------------------------------------------------------------
    await closeOpenDialog(page);
    await openLeaveChangesTab(page, seeded.leaveId);
    await expect(
      page.getByTestId("select-history-filter-period"),
      "the leave dialog should independently default to All time even though attendance was set to Last 30 days",
    ).toContainText(LABEL_ALL);
    expect(
      await readStorage(page, LEAVE_KEY),
      "the leave storage key should not exist yet — opening the dialog must not write a value before the user picks one",
    ).toBeNull();

    await selectPeriod(page, "option-history-period-7d");
    await expect(
      page.getByTestId("select-history-filter-period"),
      "the leave dropdown should update to Last 7 days",
    ).toContainText(LABEL_7D);
    await expect.poll(async () => readStorage(page, LEAVE_KEY)).toBe("7d");

    // The attendance key is the one this case really protects — a
    // shared-storage-key regression would clobber it here.
    expect(
      await readStorage(page, ATTENDANCE_KEY),
      "changing the leave period must NOT clobber the attendance period (the keys are scoped per entity type)",
    ).toBe("30d");

    // -----------------------------------------------------------------
    // 4. Validator-rejects-stale-storage path. Poke a value the
    //    PERIOD_PRESETS allow-list will reject into the attendance
    //    key and reload — the next open of the attendance dialog
    //    must fall back to "All time" rather than leak the bad value
    //    into the dropdown trigger.
    //
    //    This mirrors the validator-rejects-stale-storage assertion
    //    in `email-delivery-filters-persist.spec.ts`. It exercises
    //    the explicit allow-list check in `readPersistedPeriod`
    //    (see `history-drawer.tsx`); the catch arm of the same
    //    helper handles `localStorage.getItem` itself throwing, so
    //    a bad-string entry covers the validator branch end-to-end.
    // -----------------------------------------------------------------
    await closeOpenDialog(page);
    await writeStorage(page, ATTENDANCE_KEY, "totally-bogus-preset");
    expect(
      await readStorage(page, ATTENDANCE_KEY),
      "sanity check: the bad value really did land in storage before reload",
    ).toBe("totally-bogus-preset");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("hr-page")).toBeVisible({ timeout: 15_000 });

    await openAttendanceChangesTab(page, seeded.attendanceId);
    await expect(
      page.getByTestId("select-history-filter-period"),
      "a stored value outside the PERIOD_PRESETS allow-list must NOT leak into the dropdown — the helper should fall back to All time",
    ).toContainText(LABEL_ALL);
  });
});
