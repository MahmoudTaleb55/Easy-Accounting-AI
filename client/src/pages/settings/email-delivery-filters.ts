// Per-filter validator predicates for the email-delivery settings page.
//
// These predicates back the `validate` callbacks passed to
// `useSessionStorageState` on `email-delivery.tsx`. They are the gate
// that decides whether a stale or hand-edited sessionStorage entry
// rehydrates into the page state, or whether the helper falls back to
// the default. Living next to the page and being unit-tested
// branch-by-branch keeps the rehydration story locked in even if the
// status enum, the trend-window options, or the range-preset list
// change in the future.

export type TrendWindow = "1" | "7" | "30";

export const TREND_WINDOWS: TrendWindow[] = ["1", "7", "30"];

export function isTrendWindow(value: unknown): value is TrendWindow {
  return value === "1" || value === "7" || value === "30";
}

export type RangePreset = "all" | "7d" | "30d" | "90d" | "custom";

export const VALID_RANGE_PRESETS = new Set<string>([
  "all",
  "7d",
  "30d",
  "90d",
  "custom",
]);

export function isRangePreset(value: unknown): value is RangePreset {
  return typeof value === "string" && VALID_RANGE_PRESETS.has(value);
}

// Custom-range inputs are stored as YYYY-MM-DD strings (the native shape
// of `<input type="date">`) or as the empty string when unset. Anything
// else — partial input, malformed JSON, an old timestamp from a previous
// schema, or a calendar-impossible value like 2026-02-31 — falls back to
// "" so a stale storage entry can never feed a nonsense value into the
// date picker or the API query.
//
// We validate calendar validity (not just shape) by constructing a UTC
// date from the parts and round-tripping the components back through it.
// JS's `Date` constructor silently rolls overflow over (Feb 31 → Mar 3),
// so the round-trip check is what actually rejects impossible dates —
// a regex alone would let "2026-99-99" or "2026-02-31" leak through and
// then mutate into an unintended date downstream.
export function isStoredDateString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === "") return true;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

// The set of latest-status values the filter dropdown actually offers.
// Kept as a plain string tuple here so the validator module can stand
// alone without pulling in the page's broader `DeliveryStatus` union
// (which also includes provider-only states like `queued` that are
// never selectable in the filter UI).
export const STATUS_FILTERS = [
  "sent",
  "delivered",
  "delivery_delayed",
  "bounced",
  "complained",
  "opened",
  "clicked",
  "send_failed",
  "not_configured",
] as const;

export type StatusFilterValue = "all" | (typeof STATUS_FILTERS)[number];

export const VALID_STATUS_FILTER_VALUES = new Set<string>([
  "all",
  ...STATUS_FILTERS,
]);

export function isStatusFilterValue(value: unknown): value is StatusFilterValue {
  return typeof value === "string" && VALID_STATUS_FILTER_VALUES.has(value);
}
