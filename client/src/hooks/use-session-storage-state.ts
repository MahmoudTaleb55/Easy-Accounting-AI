import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";

/**
 * `useState` that transparently round-trips through `sessionStorage` so a
 * control's value survives page reloads within the same browser tab.
 *
 * The `validate` predicate guards against stale or hand-edited storage
 * values — anything that doesn't pass falls back to `defaultValue` so we
 * never feed a foreign string into a typed setter (e.g. a status filter
 * the UI no longer offers).
 */
export function useSessionStorageState<T>(
  key: string,
  defaultValue: T,
  validate: (value: unknown) => value is T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(key);
    } catch {
      return defaultValue;
    }
    if (raw === null) return defaultValue;
    // Try the canonical JSON shape first.
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (validate(parsed)) return parsed;
    } catch {
      // Not valid JSON — likely a legacy entry written as a raw string
      // by an earlier version of this page. Fall through and try the
      // raw value before giving up.
    }
    // Legacy fallback: older callers persisted bare strings (e.g.
    // `setItem("...trend-window", "7")`), so values like `"7"` would now
    // JSON.parse to the number 7 and fail validation. Retrying with the
    // raw string keeps those previously-saved choices intact.
    if (validate(raw)) return raw;
    return defaultValue;
  });

  // Skip the very first effect run: we either hydrated from storage (in
  // which case writing back is a no-op) or fell back to the default (in
  // which case writing it would clobber a future migration that wants to
  // notice "never been set").
  const initialRender = useRef(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota or privacy-mode errors are non-fatal — the control still
      // works for the rest of the session, it just won't persist.
    }
  }, [key, value]);

  return [value, setValue];
}

export const isString = (value: unknown): value is string =>
  typeof value === "string";
