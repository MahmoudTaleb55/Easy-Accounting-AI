import { describe, expect, test } from "vitest"

import { pickPeriodKeyForDate, type PeriodKey } from "../period-context"

/**
 * Unit coverage for the period-context "pick the smallest preset that
 * contains this date" helper.
 *
 * `setPeriodToInclude` (used by the chart-of-accounts ledger drawer's
 * "jump to nearest posting" affordance) delegates the entire decision
 * of *which* preset to switch to to this helper. A regression here
 * would silently put users into the wrong window — e.g. land them in
 * "ytd" when "month" would also have surfaced the posting, or worse,
 * pick a window that doesn't actually contain the date at all.
 *
 * The helper is anchored on a configurable `now` so we can test
 * relative-to-today windows (today/week/30d/month/quarter/ytd) at
 * known boundaries without depending on the clock.
 */

describe("pickPeriodKeyForDate", () => {
  // Wednesday 15 April 2026, mid-day UTC. Picking a mid-month, mid-week
  // anchor lets us reason about all six preset windows in one spot:
  //   • today    = Apr 15 00:00 → 23:59
  //   • week     = Sat Apr 11 → Fri Apr 17 (weekStartsOn: 6)
  //   • 30d      = Mar 17 → Apr 15 (30 days, end-inclusive)
  //   • month    = Apr 1 → Apr 30
  //   • quarter  = Apr 1 → Jun 30 (Q2)
  //   • ytd      = Jan 1 → Apr 15
  const NOW = new Date("2026-04-15T12:00:00Z")

  test("a date inside today returns 'today' — the tightest window wins", () => {
    expect(pickPeriodKeyForDate(new Date("2026-04-15T08:00:00Z"), NOW)).toBe(
      "today" satisfies PeriodKey,
    )
  })

  test("a date earlier in the same week falls through to 'week'", () => {
    // Apr 13 is in this week (Sat 11 → Fri 17) but not today, so 'today'
    // misses and 'week' matches first.
    expect(pickPeriodKeyForDate(new Date("2026-04-13T12:00:00Z"), NOW)).toBe(
      "week" satisfies PeriodKey,
    )
  })

  test("a date 20 days earlier falls past week into the rolling 30-day window", () => {
    // Mar 26 — outside today/week, but inside last 30 days. Order
    // matters here: the helper checks 30d before month/quarter/ytd, so
    // this exercises the smallest-first contract.
    expect(pickPeriodKeyForDate(new Date("2026-03-26T12:00:00Z"), NOW)).toBe(
      "30d" satisfies PeriodKey,
    )
  })

  test("a date earlier in the same month but outside the rolling 30 days picks 'month'", () => {
    // Anchor at end-of-month so the 30d window (May 2 → May 31) leaves
    // May 1 just outside it, while month (May 1 → May 31) still
    // contains it. Today/week (Sat May 30 → Fri Jun 5) also miss, so
    // 'month' is the first preset to claim May 1.
    const anchor = new Date("2026-05-31T12:00:00Z")
    expect(pickPeriodKeyForDate(new Date("2026-05-01T12:00:00Z"), anchor)).toBe(
      "month" satisfies PeriodKey,
    )
  })

  test("a date earlier in the same quarter but outside the month picks 'quarter'", () => {
    // Apr 15 anchor → quarter = Apr–Jun. Pick a date in June (later in
    // quarter) but still after today: the helper only walks presets
    // that contain the date, and quarter does, while month (Apr) does
    // not. Wait — for past presets only? Let's pick a past date inside
    // quarter but outside month: anchor May 20 → month = May, quarter
    // = Apr–Jun. Apr 5 is inside quarter, outside month, outside 30d
    // (30d = Apr 21 → May 20).
    const mayAnchor = new Date("2026-05-20T12:00:00Z")
    expect(pickPeriodKeyForDate(new Date("2026-04-05T12:00:00Z"), mayAnchor)).toBe(
      "quarter" satisfies PeriodKey,
    )
  })

  test("a date earlier in the year but outside the quarter falls through to 'ytd'", () => {
    // Apr 15 anchor → ytd = Jan 1 → Apr 15. Jan 10 is in YTD but not
    // in any tighter window (today/week/30d/month/quarter all start
    // in March or April). This exercises the tail of the preset list.
    expect(pickPeriodKeyForDate(new Date("2026-01-10T12:00:00Z"), NOW)).toBe(
      "ytd" satisfies PeriodKey,
    )
  })

  test("a date in a different calendar year returns null — caller should fall back to a custom range", () => {
    // No preset window can contain a date in 2024 from a 2026 anchor,
    // so the helper returns null. The PeriodProvider uses this signal
    // to set a custom calendar-month range covering the target date
    // (see `setPeriodToInclude` in period-context.tsx).
    expect(pickPeriodKeyForDate(new Date("2024-07-04T12:00:00Z"), NOW)).toBeNull()
  })

  test("a far-future date also returns null — postings can be dated forward (e.g. recurring/scheduled)", () => {
    // Symmetric coverage of the future side: a posting dated next year
    // can't fit any "now"-anchored window, so the helper bails to the
    // custom-range fallback. Without this, the empty-state jump button
    // would silently pick 'ytd' and still show "no postings".
    expect(pickPeriodKeyForDate(new Date("2027-08-15T12:00:00Z"), NOW)).toBeNull()
  })

  test("a date exactly at the start of the today window is included (boundary check)", () => {
    // The helper uses ms-inclusive comparisons on both ends. A posting
    // logged at midnight on the anchor day must register as "inside
    // today" — otherwise the very first posting of the morning would
    // fail to claim the tightest window.
    expect(pickPeriodKeyForDate(new Date("2026-04-15T00:00:00Z"), NOW)).toBe(
      "today" satisfies PeriodKey,
    )
  })
})
