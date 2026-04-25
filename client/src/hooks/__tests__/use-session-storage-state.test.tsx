import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  isString,
  useSessionStorageState,
} from "@/hooks/use-session-storage-state";

/**
 * Targeted unit coverage for `useSessionStorageState`. The shared helper
 * is exercised end-to-end through `tests/e2e/email-delivery-filters-persist.spec.ts`,
 * but the e2e only happens to hit the canonical-JSON path and one stale-
 * value path. The branches below — legacy raw-string fallback, JSON-parse
 * failures, validator rejection, the deliberate initial-render write skip,
 * and the swallow-quota-error path — are not directly observable through
 * the page, so a future refactor of the helper could regress one of them
 * without the e2e noticing. These tests lock each branch in at the hook
 * boundary so a regression fails fast in the unit suite.
 */

const KEY = "ssg:test-key";

const isAllowedStatus = (value: unknown): value is "open" | "closed" =>
  value === "open" || value === "closed";

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("useSessionStorageState — hydration", () => {
  test("returns the default when sessionStorage has no entry", () => {
    const { result } = renderHook(() =>
      useSessionStorageState<string>(KEY, "fallback", isString),
    );

    expect(result.current[0]).toBe("fallback");
  });

  test("hydrates a canonical JSON-encoded value", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify("hello"));

    const { result } = renderHook(() =>
      useSessionStorageState<string>(KEY, "fallback", isString),
    );

    expect(result.current[0]).toBe("hello");
  });

  test("legacy raw-string fallback: tolerates a bare string that JSON.parses to a non-string", () => {
    // An older caller wrote a bare `"7"` (so `getItem` returns the literal
    // characters `7`). `JSON.parse("7")` succeeds and yields the number 7,
    // which fails the string validator — but the helper retries the raw
    // value, which is the actual string `"7"` and validates successfully.
    window.sessionStorage.setItem(KEY, "7");

    const { result } = renderHook(() =>
      useSessionStorageState<string>(KEY, "default", isString),
    );

    expect(result.current[0]).toBe("7");
  });

  test("JSON.parse failure followed by successful raw-string validation", () => {
    // `getItem` returns the literal characters `hello` (no quotes) — that
    // is not valid JSON, so `JSON.parse` throws. The hook then falls
    // through to the raw-string retry, which validates fine.
    window.sessionStorage.setItem(KEY, "hello");

    const { result } = renderHook(() =>
      useSessionStorageState<string>(KEY, "default", isString),
    );

    expect(result.current[0]).toBe("hello");
  });

  test("validator rejection: parsed JSON value of the wrong shape falls back to default", () => {
    // The stored value is canonical JSON for a string, but it is not
    // one of the statuses the UI now offers. The validator rejects it
    // and the raw-string retry rejects it too, so we fall back to the
    // default instead of leaking a foreign string into a typed setter.
    window.sessionStorage.setItem(KEY, JSON.stringify("retired-status"));

    const { result } = renderHook(() =>
      useSessionStorageState<"open" | "closed">(KEY, "open", isAllowedStatus),
    );

    expect(result.current[0]).toBe("open");
  });

  test("validator rejection: parsed JSON value of the wrong primitive type falls back to default", () => {
    // The stored value is canonical JSON for a *number* (`42`). The
    // string validator rejects the parsed value, and the raw-string
    // retry (`"42"`) is also not in the allowed set, so the helper
    // must fall back rather than coerce the number into the typed
    // setter.
    window.sessionStorage.setItem(KEY, JSON.stringify(42));

    const { result } = renderHook(() =>
      useSessionStorageState<"open" | "closed">(KEY, "open", isAllowedStatus),
    );

    expect(result.current[0]).toBe("open");
  });
});

describe("useSessionStorageState — write behaviour", () => {
  test("initial render does not write back to sessionStorage", () => {
    // Hydrating from empty storage and rendering must not write a value
    // back: a future migration relies on being able to detect "never
    // been set". This guards the `initialRender` ref skip.
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    renderHook(() =>
      useSessionStorageState<string>(KEY, "default", isString),
    );

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  test("subsequent setState writes the value back as canonical JSON", () => {
    const { result } = renderHook(() =>
      useSessionStorageState<string>(KEY, "default", isString),
    );

    act(() => {
      result.current[1]("updated");
    });

    expect(result.current[0]).toBe("updated");
    expect(window.sessionStorage.getItem(KEY)).toBe(JSON.stringify("updated"));
  });

  test("swallows sessionStorage write errors (quota / privacy mode)", () => {
    const { result } = renderHook(() =>
      useSessionStorageState<string>(KEY, "default", isString),
    );

    // Simulate quota-exceeded / privacy-mode failure on the *write*
    // path. The hook must still update React state and must not throw
    // out of the effect — the control should remain usable for the
    // rest of the session, it just won't persist.
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });

    expect(() => {
      act(() => {
        result.current[1]("written-during-quota-error");
      });
    }).not.toThrow();

    expect(setItemSpy).toHaveBeenCalledWith(
      KEY,
      JSON.stringify("written-during-quota-error"),
    );
    expect(result.current[0]).toBe("written-during-quota-error");
  });

  test("swallows sessionStorage read errors during hydration and uses the default", () => {
    // Same privacy-mode / sandboxed-iframe scenario, but on the *read*
    // path. The try/catch around `getItem` must keep the hook usable.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });

    const { result } = renderHook(() =>
      useSessionStorageState<string>(KEY, "fallback", isString),
    );

    expect(result.current[0]).toBe("fallback");
  });
});
