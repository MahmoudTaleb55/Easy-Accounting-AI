import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useDebouncedValue } from "@/hooks/use-debounced-value";

/**
 * Targeted unit coverage for `useDebouncedValue`. The hook is the
 * mechanism behind the recipient-filter debounce on
 * /app/settings/email-delivery — both the on-screen list query and
 * the row-count chip near Download CSV consume its return value, so
 * a regression that broke the leading-value or burst-coalescing
 * branches would silently double the request volume on every
 * keystroke. These branch-level tests fail fast (in the unit suite)
 * before the e2e — `email-delivery-count-chip-refresh.spec.ts` —
 * has a chance to wait for the chip to resettle.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebouncedValue", () => {
  test("returns the initial value synchronously on first render", () => {
    // Hydration matters here: the recipient input restores from
    // sessionStorage on first render, and both the list and count
    // queries are wired to the debounced value. If the hook returned
    // the *previous* (or empty) value on first render we'd briefly
    // run an unfiltered fetch before the debounce settled.
    const { result } = renderHook(() => useDebouncedValue("seed", 250));
    expect(result.current).toBe("seed");
  });

  test("does not update before the delay elapses", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 250),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "ab" });
    // 249ms — still under the threshold, must not have updated.
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(result.current).toBe("a");
  });

  test("settles to the latest value once the delay elapses", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 250),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "ab" });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current).toBe("ab");
  });

  test("coalesces a burst of rapid updates into one final settle", () => {
    // The whole point of this hook: typing "abcd" within one window
    // must produce exactly one downstream update (to "abcd"), not
    // four — otherwise the count chip would re-issue four probes in
    // ~50ms even though the user only paused once.
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 250),
      { initialProps: { value: "" } },
    );
    rerender({ value: "a" });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    rerender({ value: "ab" });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    rerender({ value: "abc" });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    rerender({ value: "abcd" });
    // Still inside the 250ms window of the LAST change — must not
    // have updated yet (the earlier intermediate values were canceled).
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(result.current).toBe("");
    // One more tick crosses the threshold and the latest value wins.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("abcd");
  });

  test("clears its pending timer on unmount", () => {
    // Without the cleanup, a stale timer firing after unmount would
    // call setState on an unmounted component (React warning) and,
    // more importantly, leak across navigations between admin pages.
    const clearSpy = vi.spyOn(window, "clearTimeout");
    const { rerender, unmount } = renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 250),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "ab" });
    const before = clearSpy.mock.calls.length;
    unmount();
    expect(clearSpy.mock.calls.length).toBeGreaterThan(before);
  });

  test("respects a changed delay", () => {
    // The debounce window itself can be a prop in some callers
    // (e.g. tests that need a 0ms window). A regression that captured
    // the initial delay in a closure would still wait 250ms here.
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) =>
        useDebouncedValue(value, delay),
      { initialProps: { value: "a", delay: 250 } },
    );
    rerender({ value: "ab", delay: 50 });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toBe("ab");
  });
});
