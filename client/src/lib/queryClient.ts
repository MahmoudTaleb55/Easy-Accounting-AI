import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * Error thrown by `apiRequest` / `getQueryFn` when the server responds with
 * a non-2xx status. Carries the numeric `status` plus the parsed JSON `body`
 * (when the response was JSON) so callers can branch on, e.g., `err.status
 * === 409` and render `err.body?.message` without re-doing the fetch dance.
 *
 * The `message` is intentionally kept in the historical `"${status}: ${text}"`
 * shape so older call sites that string-match it (e.g. `auth-utils`'s
 * `isUnauthorizedError`, the auth pages stripping the leading `\d+:\s*`) keep
 * working unchanged.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        // Server didn't reply with JSON — leave `body` undefined and let
        // callers fall back to `message` / `status`.
      }
    }
    throw new ApiError(res.status, `${res.status}: ${text}`, body);
  }
}

/** Inject the active workspace id (chosen by the company switcher) into every
 *  authenticated API request so the backend can scope by membership. */
function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...(extra ?? {}) };
  if (typeof window !== "undefined") {
    const id = window.localStorage.getItem("active_company_id");
    if (id) h["X-Company-Id"] = id;
  }
  return h;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: buildHeaders(data ? { "Content-Type": "application/json" } : undefined),
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers: buildHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Invalidate every cached `/api/accounts/balances` query so the chart of
 * accounts page refetches its trailing balances on the next visit.
 *
 * The balances query is keyed by `["/api/accounts/balances", period]` (one
 * cache entry per period chip), so we pass only the path prefix here —
 * TanStack Query v5's `invalidateQueries` does prefix matching by default,
 * which means every period variant gets invalidated in a single call.
 *
 * Call this from any mutation that changes journal lines (manual JE
 * create/delete, transaction create/delete, AI auto-post, payroll run,
 * fixed-asset events, depreciation post, the admin backfill recovery
 * hatch). Keeping this in one helper prevents the kind of "I added a new
 * mutation but forgot to invalidate balances" drift that lets stale
 * balances linger on /app/accounts after a JE is posted elsewhere.
 */
export function invalidateAccountBalances(): void {
  queryClient.invalidateQueries({ queryKey: ["/api/accounts/balances"] });
}
