import { useEffect, useState } from "react";

/**
 * Returns a copy of `value` that only updates `delayMs` milliseconds
 * after the latest change settles. Each new `value` cancels the
 * pending update, so a burst of rapid updates produces exactly one
 * downstream change once the burst pauses.
 *
 * Designed for cases where downstream consumers (e.g. a TanStack
 * Query `queryKey`) trigger an expensive side effect on every change.
 * Wiring the consumer to the *debounced* value caps how often the
 * side effect fires while letting the source stay live (so the input
 * itself remains responsive).
 *
 * Hydration: the first returned value is the initial `value`
 * synchronously — no leading delay. This matters when the source
 * comes from `sessionStorage`/URL state and the first render must
 * already reflect the restored value (otherwise the consumer would
 * briefly run with the default before the debounce settles).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
