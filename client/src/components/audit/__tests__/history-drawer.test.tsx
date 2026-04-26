import { act, render, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { HistoryTimeline } from "@/components/audit/history-drawer";
import { LocaleProvider } from "@/contexts/locale-context";

/**
 * Component-level regression net for task #252.
 *
 * The `HistoryTimeline` period dropdown is meant to push its preset
 * (`Last 7 days` / 30 / 90) down to the audit endpoint via `?from=&to=`
 * so very large per-entity histories don't get fully fetched and
 * discarded by an in-memory filter on the client. The matching server-
 * side contract (storage.getAuditLog filters when bounds are passed,
 * is a no-op when omitted) is pinned by
 * `tests/e2e/audit-period-bounds.spec.ts`. This unit test pins the
 * client-side half: switching the dropdown must trigger a refetch
 * whose URL carries `from=` (and `to=`).
 *
 * A future refactor of `HistoryTimeline` that quietly drops the query
 * string — or that promotes the preset to a "client-side filter only"
 * shortcut — would silently regress to fetching the full history. The
 * UI would still appear correct because the in-memory filter would
 * narrow the rendered rows, but the wire payload would blow up for
 * entities with thousands of audit rows. This spec is what makes that
 * regression fail loudly in the unit suite.
 *
 * The radix `Select` primitive is replaced with a thin shim so the test
 * does not depend on radix's pointer-event / portal interactions in
 * jsdom (and so the project doesn't need an additional `@testing-
 * library/user-event` install). The shim still routes value through
 * the real `onValueChange` callback that `HistoryTimeline` passes in,
 * which is the only contract that matters for this test.
 */

// Capture the latest `onValueChange` the component handed down to the
// Select primitive. The shim below stores it here so the test body can
// invoke it directly to simulate the user picking a preset, sidestepping
// radix's portal / pointer-event behaviour in jsdom.
const selectState: {
  onValueChange: ((value: string) => void) | null;
  currentValue: string | null;
} = { onValueChange: null, currentValue: null };

vi.mock("@/components/ui/select", () => {
  const SelectShim = ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => {
    selectState.onValueChange = onValueChange;
    selectState.currentValue = value;
    return (
      <div data-testid="mock-select-root" data-value={value}>
        {children}
      </div>
    );
  };
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    Select: SelectShim,
    SelectTrigger: Passthrough,
    SelectContent: Passthrough,
    SelectValue: () => null,
    SelectItem: ({
      value,
      children,
    }: {
      value: string;
      children?: React.ReactNode;
    }) => <div data-mock-option={value}>{children}</div>,
  };
});

// Track every URL `apiRequest` was called with so the test can assert
// (a) the initial fetch carries no `from` / `to` query string and
// (b) the post-preset fetch carries both.
const apiRequestUrls: string[] = [];
let auditResponse: unknown[] = [];

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(async (_method: string, url: string) => {
    apiRequestUrls.push(url);
    return new Response(JSON.stringify(auditResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
}));

function makeWrapper() {
  // Per-test client so cached queries from one test don't leak into the
  // next one and silently mask a regression.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <LocaleProvider defaultLocale="en">{children}</LocaleProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  apiRequestUrls.length = 0;
  selectState.onValueChange = null;
  selectState.currentValue = null;
  // The component reads `localStorage[history.periodFilter.<entityType>]`
  // to rehydrate the user's last picked preset. Wipe it so each test
  // starts in the canonical "All time" state regardless of order.
  window.localStorage.clear();
  // Audit response shape: enough fields for the timeline's render +
  // counts, with timestamps that fall inside any preset window we'd
  // exercise so the in-memory filter doesn't accidentally hide them.
  auditResponse = [
    {
      id: 1,
      entityType: "transaction",
      entityId: 42,
      action: "create",
      actor: "tester",
      source: "user",
      changes: [],
      occurredAt: new Date().toISOString(),
    },
  ];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HistoryTimeline period dropdown contract", () => {
  test("initial fetch omits from/to; switching to 'Last 7 days' refetches with from= and to=", async () => {
    const Wrapper = makeWrapper();
    render(
      <HistoryTimeline entityType="transaction" entityId={42} />,
      { wrapper: Wrapper },
    );

    // (1) The first request must hit the bare endpoint — confirms we
    // really start in the "All time" preset and that the URL builder
    // does not bake bounds in by accident when the preset is "all".
    await waitFor(() => {
      expect(
        apiRequestUrls.length,
        `expected at least one apiRequest call, got ${apiRequestUrls.length}`,
      ).toBeGreaterThanOrEqual(1);
    });
    expect(apiRequestUrls[0]).toBe("/api/audit/transaction/42");
    expect(apiRequestUrls[0]).not.toContain("from=");
    expect(apiRequestUrls[0]).not.toContain("to=");

    // The Select shim should have captured the component's
    // `onValueChange` by the time the filter row renders. If this is
    // null the component never reached the filter render path, which
    // itself is a regression worth failing loudly on.
    await waitFor(() => {
      expect(
        selectState.onValueChange,
        "expected HistoryTimeline to render the period <Select> after the " +
          "first audit fetch resolves",
      ).not.toBeNull();
    });

    const initialCalls = apiRequestUrls.length;

    // (2) Simulate the user picking "Last 7 days" by invoking the
    // captured onValueChange. This is the *exact* callback Radix would
    // call on a real click, so the test path is faithful to the
    // production interaction without depending on radix portal
    // behaviour in jsdom.
    act(() => {
      selectState.onValueChange!("7d");
    });

    // The new preset must trigger a refetch whose URL carries `from=`.
    // We assert against the most recent request rather than the count
    // so the test is robust to any incidental re-renders.
    await waitFor(() => {
      expect(
        apiRequestUrls.length,
        `expected a refetch after switching to '7d', call count is still ${apiRequestUrls.length}`,
      ).toBeGreaterThan(initialCalls);
    });
    const refetched = apiRequestUrls[apiRequestUrls.length - 1];
    expect(refetched).toContain("/api/audit/transaction/42");
    expect(refetched, `'Last 7 days' must put 'from=' on the wire`).toContain(
      "from=",
    );
    expect(refetched, `'Last 7 days' must put 'to=' on the wire`).toContain(
      "to=",
    );

    // The bounds should be ISO timestamps and the `from` should sit
    // ~7 days before `to` (within a small slack window for the few
    // milliseconds that may have elapsed inside the test). This
    // catches a regression where the dropdown serialises the preset
    // string itself (eg `from=7d`) instead of an actual timestamp.
    const url = new URL(refetched, "http://localhost");
    const fromIso = url.searchParams.get("from");
    const toIso = url.searchParams.get("to");
    expect(fromIso).toBeTruthy();
    expect(toIso).toBeTruthy();
    const fromMs = Date.parse(fromIso!);
    const toMs = Date.parse(toIso!);
    expect(Number.isFinite(fromMs), `from is not a parseable date: ${fromIso}`).toBe(true);
    expect(Number.isFinite(toMs), `to is not a parseable date: ${toIso}`).toBe(true);
    const spanDays = (toMs - fromMs) / (24 * 60 * 60 * 1000);
    // 7-day preset should produce a window of ~7 days. Allow a tiny
    // slack on either side because `startOfDay` / `endOfDay` round
    // the bounds out and the helper subtracts whole calendar days.
    expect(
      spanDays >= 6.5 && spanDays <= 8.5,
      `'7d' preset span was ${spanDays.toFixed(3)} days, expected ~7`,
    ).toBe(true);
  });

  test("switching back to 'All time' refetches without from/to (no-op contract)", async () => {
    const Wrapper = makeWrapper();
    // Pre-seed localStorage so the component starts on a bounded
    // preset — that way "switching back to all" actually changes the
    // URL and we can assert the bounds disappear.
    window.localStorage.setItem("history.periodFilter.transaction", "30d");

    render(
      <HistoryTimeline entityType="transaction" entityId={99} />,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(apiRequestUrls.length).toBeGreaterThanOrEqual(1);
    });
    // First fetch must already be bounded because the persisted preset
    // is "30d". This guards the rehydration path in addition to the
    // explicit switch below.
    expect(apiRequestUrls[0]).toContain("/api/audit/transaction/99");
    expect(apiRequestUrls[0]).toContain("from=");

    await waitFor(() => {
      expect(selectState.onValueChange).not.toBeNull();
    });

    const beforeCalls = apiRequestUrls.length;
    act(() => {
      selectState.onValueChange!("all");
    });

    await waitFor(() => {
      expect(apiRequestUrls.length).toBeGreaterThan(beforeCalls);
    });
    const refetched = apiRequestUrls[apiRequestUrls.length - 1];
    expect(refetched).toBe("/api/audit/transaction/99");
    expect(refetched).not.toContain("from=");
    expect(refetched).not.toContain("to=");
  });
});
