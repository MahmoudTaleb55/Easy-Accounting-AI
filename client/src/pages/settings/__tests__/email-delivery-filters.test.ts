import { describe, expect, test } from "vitest";

import {
  isRangePreset,
  isStatusFilterValue,
  isStoredDateString,
  isTrendWindow,
  STATUS_FILTERS,
  TREND_WINDOWS,
  VALID_RANGE_PRESETS,
  VALID_STATUS_FILTER_VALUES,
} from "@/pages/settings/email-delivery-filters";

/**
 * Targeted unit coverage for the per-filter validator predicates that
 * back `useSessionStorageState` on the email-delivery settings page.
 *
 * The shared `useSessionStorageState` helper has its own spec at
 * `client/src/hooks/__tests__/use-session-storage-state.test.tsx`, but
 * each caller still passes its own validator inline. Those validators
 * are what decide whether a stale or hand-edited storage entry rehydrates
 * or falls back to the default — and they were previously only exercised
 * by `tests/e2e/email-delivery-filters-persist.spec.ts`, which only pokes
 * one bad value into one key. A future status-enum change or trend-window
 * option drop could regress one validator without the e2e flagging it.
 *
 * The tests below assert each predicate accepts every currently-offered
 * value and rejects representative stale / hand-edited inputs (retired
 * status, calendar-impossible date, unsupported trend-window, etc.) so a
 * regression fails fast in the unit suite.
 */

describe("isTrendWindow", () => {
  test("accepts every option the toggle currently offers", () => {
    for (const w of TREND_WINDOWS) {
      expect(isTrendWindow(w)).toBe(true);
    }
  });

  test("rejects retired or unsupported window keys", () => {
    // Representative stale values: a window we never offered ("3"), an
    // older one we removed ("90"), and a numeric form that bypasses the
    // string compare.
    expect(isTrendWindow("3")).toBe(false);
    expect(isTrendWindow("90")).toBe(false);
    expect(isTrendWindow(7)).toBe(false);
  });

  test("rejects non-string and empty-shaped inputs", () => {
    expect(isTrendWindow("")).toBe(false);
    expect(isTrendWindow(null)).toBe(false);
    expect(isTrendWindow(undefined)).toBe(false);
    expect(isTrendWindow({})).toBe(false);
    expect(isTrendWindow([])).toBe(false);
    expect(isTrendWindow(true)).toBe(false);
  });
});

describe("isStatusFilterValue", () => {
  test("accepts the catch-all sentinel and every offered status", () => {
    expect(isStatusFilterValue("all")).toBe(true);
    for (const s of STATUS_FILTERS) {
      expect(isStatusFilterValue(s)).toBe(true);
    }
  });

  test("VALID_STATUS_FILTER_VALUES stays in sync with STATUS_FILTERS", () => {
    // Locks the relationship between the dropdown options and the
    // validator's allow-list. If a new status is added to one but
    // forgotten in the other, hydration silently drops or accepts the
    // wrong values.
    expect(VALID_STATUS_FILTER_VALUES.size).toBe(STATUS_FILTERS.length + 1);
    expect(VALID_STATUS_FILTER_VALUES.has("all")).toBe(true);
    for (const s of STATUS_FILTERS) {
      expect(VALID_STATUS_FILTER_VALUES.has(s)).toBe(true);
    }
  });

  test("rejects retired statuses and provider-only values not exposed in the filter", () => {
    // `queued` is a real `DeliveryStatus` but is never offered as a
    // selectable filter, so it must not rehydrate from a hand-edited
    // storage entry as if it were. `pending` / `unsubscribed` are
    // representative names a future refactor or a malicious paste could
    // try.
    expect(isStatusFilterValue("queued")).toBe(false);
    expect(isStatusFilterValue("pending")).toBe(false);
    expect(isStatusFilterValue("unsubscribed")).toBe(false);
    expect(isStatusFilterValue("retired-status")).toBe(false);
  });

  test("rejects case-mismatched and trimmed variants", () => {
    // The validator is case-sensitive on purpose — the filter UI emits
    // lowercase tokens and the API matches lowercase — so a stray
    // upper-case value or a leading space must be rejected rather than
    // silently coerced.
    expect(isStatusFilterValue("ALL")).toBe(false);
    expect(isStatusFilterValue("Sent")).toBe(false);
    expect(isStatusFilterValue(" sent")).toBe(false);
    expect(isStatusFilterValue("sent ")).toBe(false);
  });

  test("rejects non-string inputs", () => {
    expect(isStatusFilterValue(null)).toBe(false);
    expect(isStatusFilterValue(undefined)).toBe(false);
    expect(isStatusFilterValue(0)).toBe(false);
    expect(isStatusFilterValue(["sent"])).toBe(false);
    expect(isStatusFilterValue({ value: "sent" })).toBe(false);
  });
});

describe("isRangePreset", () => {
  test("accepts every preset the dropdown currently offers", () => {
    for (const p of ["all", "7d", "30d", "90d", "custom"] as const) {
      expect(isRangePreset(p)).toBe(true);
    }
  });

  test("VALID_RANGE_PRESETS exposes exactly the offered presets", () => {
    expect(Array.from(VALID_RANGE_PRESETS).sort()).toEqual(
      ["7d", "30d", "90d", "all", "custom"].sort(),
    );
  });

  test("rejects retired or unsupported preset keys", () => {
    // `1d` was never offered, `60d` would be a sibling that doesn't
    // exist yet, and `last7` is an older naming convention from before
    // the unification on the `Nd` shape.
    expect(isRangePreset("1d")).toBe(false);
    expect(isRangePreset("60d")).toBe(false);
    expect(isRangePreset("last7")).toBe(false);
    expect(isRangePreset("")).toBe(false);
    expect(isRangePreset("ALL")).toBe(false);
  });

  test("rejects non-string inputs", () => {
    expect(isRangePreset(null)).toBe(false);
    expect(isRangePreset(undefined)).toBe(false);
    expect(isRangePreset(7)).toBe(false);
    expect(isRangePreset({ preset: "7d" })).toBe(false);
  });
});

describe("isStoredDateString", () => {
  test("accepts the empty string (custom inputs unset)", () => {
    expect(isStoredDateString("")).toBe(true);
  });

  test("accepts well-formed YYYY-MM-DD calendar dates", () => {
    expect(isStoredDateString("2024-01-01")).toBe(true);
    expect(isStoredDateString("2026-04-26")).toBe(true);
    // Leap-year boundary that the Date round-trip correctly admits.
    expect(isStoredDateString("2024-02-29")).toBe(true);
    // Year boundaries — last day of December and first day of January.
    expect(isStoredDateString("2025-12-31")).toBe(true);
    expect(isStoredDateString("2025-01-01")).toBe(true);
  });

  test("rejects calendar-impossible dates that JS would silently roll over", () => {
    // The JS Date constructor would happily interpret these as later
    // dates by overflowing months/days. The round-trip check is what
    // makes the validator reject them — a regex alone would let these
    // through and then mutate into an unintended date downstream.
    expect(isStoredDateString("2026-02-31")).toBe(false);
    expect(isStoredDateString("2025-02-29")).toBe(false); // not a leap year
    expect(isStoredDateString("2026-04-31")).toBe(false);
    expect(isStoredDateString("2026-13-01")).toBe(false);
    expect(isStoredDateString("2026-00-15")).toBe(false);
    expect(isStoredDateString("2026-01-00")).toBe(false);
    expect(isStoredDateString("2026-01-32")).toBe(false);
    expect(isStoredDateString("2026-99-99")).toBe(false);
  });

  test("rejects strings whose shape does not match YYYY-MM-DD exactly", () => {
    // Hand-edited inputs that look date-ish but don't match the shape
    // `<input type="date">` round-trips to.
    expect(isStoredDateString("2026-1-1")).toBe(false);
    expect(isStoredDateString("26-01-01")).toBe(false);
    expect(isStoredDateString("2026/01/01")).toBe(false);
    expect(isStoredDateString("2026-01-01T00:00:00Z")).toBe(false);
    expect(isStoredDateString("01-01-2026")).toBe(false);
    expect(isStoredDateString(" 2026-01-01")).toBe(false);
    expect(isStoredDateString("2026-01-01 ")).toBe(false);
    expect(isStoredDateString("garbage")).toBe(false);
  });

  test("rejects non-string inputs", () => {
    expect(isStoredDateString(null)).toBe(false);
    expect(isStoredDateString(undefined)).toBe(false);
    expect(isStoredDateString(20260101)).toBe(false);
    expect(isStoredDateString(new Date("2026-01-01"))).toBe(false);
    expect(isStoredDateString(["2026-01-01"])).toBe(false);
  });
});
