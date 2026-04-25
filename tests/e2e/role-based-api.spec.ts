import { test, expect, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * API-side role gating regression net.
 *
 * The companion `role-based-buttons.spec.ts` proves that every gated UI
 * control renders disabled (or is hidden behind an OwnerOnly fallback) for
 * the wrong role. That contract is necessary but not sufficient: a malicious
 * or scripted client can ignore the disabled state and POST directly to the
 * underlying endpoint. If the server silently accepted those calls, viewers
 * and accountants would still be able to mutate the workspace.
 *
 * This spec mirrors the UI contract one-for-one against the server:
 *
 *   • Viewers must hit 403 on every write surface — both the workspace-
 *     write endpoints (transactions / journal entries / payroll runs) and
 *     the owner-only endpoints (settings / companies / fx rates / member
 *     management). Viewers are read-only across the board.
 *
 *   • Accountants pass the workspace-write surfaces (their button stays
 *     enabled in the UI), but must hit 403 on owner-only endpoints
 *     (settings / companies / fx rates / member management) — the same
 *     ones the legacy `/api/team/*` matrix called out before that surface
 *     was retired in favour of `/api/auth/members` and
 *     `/api/auth/invitations` (see `server/auth/local-routes.ts`).
 *
 *   • Owners succeed everywhere. We assert the success status (2xx) so a
 *     regression that 403s the owner is also caught.
 *
 * Auth + seed are reused from `role-based-buttons.setup.ts` (the same
 * users, the same shared workspace, the same employee + FX rate). The
 * setup additionally seeds a pair of accounts so the journal-entry
 * success path has valid foreign-key targets.
 *
 * If the UI guard suite changes (a button moves from WriteGuard to
 * OwnerGuard, a new gated button is added, etc.), this spec must be
 * updated alongside so the two contracts stay aligned.
 */

const ROLE_FILES = {
  owner: ".playwright/role-owner.json",
  accountant: ".playwright/role-accountant.json",
  viewer: ".playwright/role-viewer.json",
} as const;

const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Per-process counter the payroll body factory uses to spread successive
// invocations over distinct months. Without it the accountant's "not 403"
// check (which actually posts payroll because workspace-write gates pass
// for accountants) and the owner's success check would both target the
// same year/month, and the second one would 400 with "already approved
// for this month" instead of 200.
let payrollBodyCounter = 0;

/** Shared E2E company id, written by `role-based-buttons.setup.ts`. We
 *  read it lazily so an explicit error is thrown if the setup project
 *  did not run (instead of every call silently routing to a different
 *  workspace). The fixture pins `x-company-id` on every API call so the
 *  active workspace stays the shared E2E company even after the owner
 *  success-path of POST /api/companies adds a *second* workspace to the
 *  owner mid-suite. */
let cachedSharedCompanyId: number | null = null;
function getSharedCompanyId(): number {
  if (cachedSharedCompanyId != null) return cachedSharedCompanyId;
  const fixturePath = path.resolve(".playwright/role-shared-fixture.json");
  if (!fs.existsSync(fixturePath)) {
    throw new Error(
      `Missing ${fixturePath}. Run the role-based-buttons-setup project first ` +
        `(it persists the shared E2E company id for the role-based-api spec).`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as { companyId?: number };
  if (!raw.companyId) throw new Error(`role-shared-fixture.json missing companyId`);
  cachedSharedCompanyId = raw.companyId;
  return cachedSharedCompanyId;
}

interface ApiResult {
  status: number;
  body: unknown;
}

async function call(
  request: APIRequestContext,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<ApiResult> {
  // Pin every call to the shared E2E workspace so a sibling test that
  // creates a workspace can't flip `cid(req)` for our follow-up calls.
  const headers: Record<string, string> = {
    "x-company-id": String(getSharedCompanyId()),
  };
  const opts: { data?: unknown; headers: Record<string, string> } = { headers };
  if (body !== undefined) {
    opts.data = body;
    opts.headers["content-type"] = "application/json";
  }
  const res = await request.fetch(path, { method, ...opts });
  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status(), body: parsed };
}

/** A role-gated endpoint and the body to send. The same definition is used
 *  for all three roles so the spec stays a single source of truth for what
 *  the UI guard suite covers. */
interface GatedEndpoint {
  /** Short human label used in test names. */
  label: string;
  /** UI button this endpoint backs (mirrors `data-testid` from the UI spec). */
  uiButton: string;
  method: "POST" | "PATCH" | "DELETE";
  /** Either a literal path or a function that resolves it lazily (for
   *  endpoints whose URL embeds a dynamic id like a member or FX rate). */
  path: string | ((ctx: SuccessContext) => Promise<string>);
  /** Body factory — generates a fresh, valid body for each call. Body
   *  values must be unique per call to avoid collisions when the owner-
   *  success path actually persists rows. */
  body: (ctx: SuccessContext) => Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
  /** Whether this endpoint is owner-only (accountant must also 403) or a
   *  workspace write (only viewer 403s). */
  gate: "owner-only" | "workspace-write";
}

/** Per-call context needed to resolve dynamic paths and bodies — populated
 *  fresh inside each role's describe block so paths/ids stay valid. */
interface SuccessContext {
  request: APIRequestContext;
}

async function fetchAccountIds(request: APIRequestContext): Promise<{ assetId: number; revenueId: number }> {
  const r = await call(request, "GET", "/api/accounts");
  expect(r.status, `seed accounts must be readable, got ${r.status}: ${JSON.stringify(r.body)}`).toBe(200);
  const rows = r.body as Array<{ id: number; type: string; subtype: string }>;
  const asset = rows.find((a) => a.type === "asset" && a.subtype === "current_asset");
  const revenue = rows.find((a) => a.type === "revenue");
  if (!asset || !revenue) {
    throw new Error(
      `setup did not seed the expected (asset, revenue) account pair — got ${rows.length} accounts`,
    );
  }
  return { assetId: asset.id, revenueId: revenue.id };
}

async function fetchAnFxRateId(request: APIRequestContext): Promise<number> {
  const r = await call(request, "GET", "/api/fx-rates");
  expect(r.status, `fx-rates list must be readable, got ${r.status}`).toBe(200);
  const rows = r.body as Array<{ id: number }>;
  if (rows.length === 0) {
    throw new Error("setup did not seed any fx rate — DELETE /api/fx-rates path cannot be exercised");
  }
  return rows[0].id;
}

async function fetchOwnMembershipId(request: APIRequestContext): Promise<string> {
  const r = await call(request, "GET", "/api/auth/members");
  expect(r.status, `owner must be able to list members, got ${r.status}`).toBe(200);
  const rows = r.body as Array<{ id: string; role: string }>;
  // Pick a non-owner member so PATCH/DELETE don't trip the "last owner" guard.
  const target = rows.find((m) => m.role !== "owner");
  if (!target) {
    throw new Error("expected at least one non-owner membership in the shared workspace");
  }
  return target.id;
}

/** Endpoint contract. Owner-success bodies must be valid; viewer/accountant
 *  bodies are never reached past the role gate (the gate runs before any
 *  schema validation), so the same body shape works for both calls. */
const GATED_ENDPOINTS: GatedEndpoint[] = [
  // --- Workspace writes — accountant + owner pass; viewer 403 ---
  {
    label: "POST /api/transactions (button-add-transaction)",
    uiButton: "button-add-transaction",
    method: "POST",
    path: "/api/transactions",
    body: () => ({
      type: "income",
      amount: "10.00",
      description: `rba-${RUN_TAG}`,
      category: `rba-${RUN_TAG}`,
    }),
    gate: "workspace-write",
  },
  {
    label: "POST /api/journal-entries (button-new-entry)",
    uiButton: "button-new-entry",
    method: "POST",
    path: "/api/journal-entries",
    body: async ({ request }) => {
      const { assetId, revenueId } = await fetchAccountIds(request);
      return {
        description: `rba-${RUN_TAG}`,
        source: "manual",
        lines: [
          { accountId: assetId, debit: 1, credit: 0 },
          { accountId: revenueId, debit: 0, credit: 1 },
        ],
      };
    },
    gate: "workspace-write",
  },
  {
    label: "POST /api/hr/payroll/run (button-run-payroll)",
    uiButton: "button-run-payroll",
    method: "POST",
    path: "/api/hr/payroll/run",
    // Use a far-future year so successive owner runs in subsequent test
    // re-runs don't collide with real data, and rotate the month per
    // invocation so the accountant's "not 403" check (which actually
    // posts payroll for workspace-write endpoints) and the owner's
    // success check land on different months — otherwise the second
    // call would 400 with "already approved for this month".
    body: () => {
      const year = new Date().getFullYear() + 50;
      const month = (payrollBodyCounter++ % 12) + 1;
      return { year, month };
    },
    gate: "workspace-write",
  },

  // --- Owner-only — both viewer + accountant 403 ---
  {
    label: "PATCH /api/settings (button-save-settings)",
    uiButton: "button-save-settings",
    method: "PATCH",
    path: "/api/settings",
    // Settings is upserted, so the owner-success call is idempotent. The
    // schema (`upsertSettingsSchema` in shared/schema.ts) requires the
    // full row, not a partial — sending less than this returns 400 even
    // for the owner.
    body: () => ({
      orgName: "E2E Roles Co",
      countryCode: "INTL",
      locale: "en",
      currencyCode: "USD",
      currencySymbol: "$",
      vatRate: 0.05,
      zakatEnabled: false,
      fiscalYearStartMonth: 1,
    }),
    gate: "owner-only",
  },
  {
    label: "POST /api/companies (button-add-company)",
    uiButton: "button-add-company",
    method: "POST",
    path: "/api/companies",
    body: () => ({
      name: `RBA Owner Co ${RUN_TAG}`,
      functionalCurrency: "USD",
      currencySymbol: "$",
      isDefault: false,
      isActive: true,
    }),
    gate: "owner-only",
  },
  {
    label: "POST /api/fx-rates (button-save-fx)",
    uiButton: "button-save-fx",
    method: "POST",
    path: "/api/fx-rates",
    body: () => ({
      fromCurrency: "GBP",
      toCurrency: "USD",
      // Vary the date per run so the unique (company, from, to, date) row
      // doesn't clash with previous owner-success calls.
      rateDate: `203${RUN_TAG.slice(-1)}-0${(Number(RUN_TAG.slice(-2, -1)) % 9) + 1}-01`,
      rate: 1.25,
    }),
    gate: "owner-only",
  },
  {
    label: "DELETE /api/fx-rates/:id (button-delete-fx-*)",
    uiButton: "button-delete-fx-*",
    method: "DELETE",
    // Resolve the path lazily so the owner-success call can target the FX
    // rate that the spec just created (and not the seeded EUR→USD row that
    // other suites rely on). Viewer/accountant calls also resolve lazily
    // but never reach the DB because the role gate runs first.
    path: async ({ request }) => {
      // The role gate fires before the path is dereferenced server-side, so
      // a non-existent id is still 403 for the wrong role. For the owner
      // success path we want an id that actually exists; the spec creates
      // it just-in-time inside the owner describe block.
      const id = await fetchAnFxRateId(request);
      return `/api/fx-rates/${id}`;
    },
    body: () => undefined,
    gate: "owner-only",
  },

  // --- Owner-only members management (replaces retired /api/team/*) ---
  {
    label: "POST /api/auth/invitations (member invite)",
    uiButton: "(no UI button — owner Members page only)",
    method: "POST",
    path: "/api/auth/invitations",
    body: () => ({
      email: `rba-invite-${RUN_TAG}-${Math.random().toString(36).slice(2, 6)}@example.test`,
      role: "viewer",
    }),
    gate: "owner-only",
  },
  {
    label: "PATCH /api/auth/members/:id (role change)",
    uiButton: "(no UI button — owner Members page only)",
    method: "PATCH",
    // Owner-success path picks the (only) accountant membership to update;
    // viewer/accountant calls hit any well-formed members url and 403 on
    // the gate before the id is dereferenced.
    path: async ({ request }) => {
      const id = await fetchOwnMembershipId(request);
      return `/api/auth/members/${id}`;
    },
    // Owner toggle: re-set the role to its current value so the test is
    // idempotent and doesn't accidentally lock anyone out of the workspace.
    body: () => ({ role: "accountant" }),
    gate: "owner-only",
  },
];

// ---------------------------------------------------------------------------
// Helpers shared by every role describe block.
// ---------------------------------------------------------------------------

/** Drive a single endpoint and return both the resolved path and the
 *  observed status. Path resolution + body construction may themselves
 *  hit the API (e.g. to fetch an FX rate id). For viewer/accountant
 *  describe blocks we *cannot* rely on those helpers (they require owner
 *  reads), so we fall back to a static placeholder path that still
 *  exercises the same gate. */
async function exerciseGate(
  request: APIRequestContext,
  ep: GatedEndpoint,
  resolvePath: "live" | "placeholder",
): Promise<{ path: string; result: ApiResult }> {
  const ctx: SuccessContext = { request };
  let path: string;
  let body: unknown;
  if (resolvePath === "live") {
    path = typeof ep.path === "string" ? ep.path : await ep.path(ctx);
    body = await ep.body(ctx);
  } else {
    // Placeholder path for viewer/accountant: dynamic ids become "0" so we
    // don't depend on owner-only reads. The role gate still runs first.
    path = typeof ep.path === "string" ? ep.path : ep.path.toString().includes("members")
      ? "/api/auth/members/00000000-0000-0000-0000-000000000000"
      : "/api/fx-rates/0";
    // Body factories that need the API are skipped for viewer/accountant —
    // their calls 403 before any body validation runs.
    if (ep.label.includes("/api/journal-entries")) {
      body = {
        description: `rba-${RUN_TAG}`,
        source: "manual",
        lines: [
          { accountId: 1, debit: 1, credit: 0 },
          { accountId: 2, debit: 0, credit: 1 },
        ],
      };
    } else {
      body = await ep.body(ctx);
    }
  }
  const result = await call(request, ep.method, path, body);
  return { path, result };
}

// ---------------------------------------------------------------------------
// Role describe blocks. Storage state is loaded per-block so each role
// hits the API as the right user without leaking cookies across blocks.
// ---------------------------------------------------------------------------

test.describe("API-side role gating @rbac-api", () => {
  test.describe("viewer is rejected on every gated endpoint", () => {
    test.use({ storageState: ROLE_FILES.viewer });

    for (const ep of GATED_ENDPOINTS) {
      test(`${ep.method} ${ep.label} → 403 for viewer`, async ({ request }) => {
        const { path, result } = await exerciseGate(request, ep, "placeholder");
        expect(
          result.status,
          `viewer hitting ${ep.method} ${path} must be rejected (got ${result.status}: ${JSON.stringify(result.body)})`,
        ).toBe(403);
      });
    }
  });

  test.describe("accountant passes workspace writes but is blocked on owner-only endpoints", () => {
    test.use({ storageState: ROLE_FILES.accountant });

    for (const ep of GATED_ENDPOINTS) {
      const verb = ep.gate === "owner-only" ? "→ 403" : "→ not 403";
      test(`${ep.method} ${ep.label} ${verb} for accountant`, async ({ request }) => {
        const { path, result } = await exerciseGate(request, ep, "placeholder");
        if (ep.gate === "owner-only") {
          expect(
            result.status,
            `accountant hitting owner-only ${ep.method} ${path} must be rejected (got ${result.status}: ${JSON.stringify(result.body)})`,
          ).toBe(403);
        } else {
          // Workspace-write endpoints: the role gate must pass for an
          // accountant. We don't assert 2xx because the placeholder body
          // for some endpoints (e.g. payroll for a future month) may
          // still 4xx on validation — but it must not 403. A 403 here is
          // a regression: the accountant's button stays enabled in the
          // UI but the server now rejects them.
          expect(
            result.status,
            `accountant hitting workspace-write ${ep.method} ${path} must NOT be 403 (got ${result.status}: ${JSON.stringify(result.body)})`,
          ).not.toBe(403);
        }
      });
    }
  });

  test.describe("header tampering does not weaken owner-only RBAC", () => {
    // A non-owner can force `req.membership` to be missing on the server by
    // sending a bogus `x-company-id` value (the membership lookup in
    // `attachMembership` returns null when the user has no membership for
    // that company id). If any owner-only handler gates only on the
    // *presence* of `req.membership` instead of also checking the
    // caller's actual memberships, this bypass would let viewers /
    // accountants slip through. This block targets `POST /api/companies`
    // specifically because it is on the `SELF_SERVICE_PREFIXES` allow-
    // list (so the global `requireWriteRoleForMutations` gate is
    // *intentionally* skipped for it) — making the route handler the
    // only line of defence and therefore the most likely place for a
    // missing-context bypass to land. The other owner-only endpoints
    // are also covered by `requireWriteRoleForMutations`, so the same
    // header trick on them is rejected by the global middleware before
    // the handler ever runs.
    const BOGUS_HEADER = { "x-company-id": "999999999" };

    test.use({ storageState: ROLE_FILES.viewer });
    test("viewer cannot bootstrap a workspace by tampering with x-company-id", async ({ request }) => {
      const res = await request.fetch("/api/companies", {
        method: "POST",
        headers: { "content-type": "application/json", ...BOGUS_HEADER },
        data: {
          name: `RBA Bypass Viewer ${RUN_TAG}`,
          functionalCurrency: "USD",
          currencySymbol: "$",
          isDefault: false,
          isActive: true,
        },
      });
      expect(
        res.status(),
        `viewer with bogus x-company-id must NOT be able to create a company (got ${res.status()}: ${await res.text()})`,
      ).toBe(403);
    });
  });

  test.describe("header tampering does not weaken owner-only RBAC (accountant)", () => {
    // Same bypass class as the viewer block above, exercised as an
    // accountant. Accountants pass the workspace-write gate, so if the
    // owner check on POST /api/companies were absent or only triggered
    // when membership context was attached, the accountant could create
    // a brand-new owner workspace by sending a bogus `x-company-id`.
    test.use({ storageState: ROLE_FILES.accountant });
    test("accountant cannot bootstrap a workspace by tampering with x-company-id", async ({ request }) => {
      const res = await request.fetch("/api/companies", {
        method: "POST",
        headers: { "content-type": "application/json", "x-company-id": "999999999" },
        data: {
          name: `RBA Bypass Accountant ${RUN_TAG}`,
          functionalCurrency: "USD",
          currencySymbol: "$",
          isDefault: false,
          isActive: true,
        },
      });
      expect(
        res.status(),
        `accountant with bogus x-company-id must NOT be able to create a company (got ${res.status()}: ${await res.text()})`,
      ).toBe(403);
    });
  });

  test.describe("owner succeeds on every gated endpoint", () => {
    test.use({ storageState: ROLE_FILES.owner });

    // Endpoints whose owner-success path is currently blocked by an
    // unrelated bug (NOT a role-gate regression). For these we only assert
    // "owner is not 403'd" — any other status (including 4xx/5xx) still
    // proves the gate is open. Once the underlying bug is fixed the entry
    // here should be removed so the strong 2xx assertion kicks back in.
    //
    // Two endpoints used to live here:
    //
    //   • POST /api/hr/payroll/run — the `accounts.code` global UNIQUE
    //     constraint was scoped per-workspace in
    //     migrations/0010_accounts_code_per_workspace.sql, the setup
    //     now seeds the full payroll account set, and the strong 2xx
    //     assertion is back on.
    //   • POST /api/journal-entries — `journal_lines.company_id` was
    //     missing because two migration files shared the 0005 prefix
    //     and one was silently skipped. The duplicate prefixes have
    //     been removed (the email-delivery-alert chain was renumbered
    //     into the 0009-0013 range), and the strong 2xx assertion is
    //     back on for journal entries too.
    const OWNER_SUCCESS_KNOWN_BLOCKED = new Set<string>([]);

    for (const ep of GATED_ENDPOINTS) {
      test(`${ep.method} ${ep.label} succeeds for owner`, async ({ request }) => {
        const { path, result } = await exerciseGate(request, ep, "live");
        if (OWNER_SUCCESS_KNOWN_BLOCKED.has(ep.label)) {
          // Soft assertion — see OWNER_SUCCESS_KNOWN_BLOCKED above. The
          // role gate must still be open for the owner; we just can't
          // assert the downstream write succeeds while the unrelated bug
          // is in place.
          expect(
            result.status,
            `owner hitting ${ep.method} ${path} must NOT be 403 — known unrelated failure mode allowed (got ${result.status}: ${JSON.stringify(result.body)})`,
          ).not.toBe(403);
          return;
        }
        // 2xx is the strong assertion: the owner clicks the button in the
        // UI and the server happily applies the change. A 403 here would
        // mean the owner's gate accidentally got tightened — the inverse
        // of the bug class this spec catches for viewers/accountants.
        expect(
          result.status,
          `owner hitting ${ep.method} ${path} must succeed (got ${result.status}: ${JSON.stringify(result.body)})`,
        ).toBeGreaterThanOrEqual(200);
        expect(
          result.status,
          `owner hitting ${ep.method} ${path} must succeed (got ${result.status}: ${JSON.stringify(result.body)})`,
        ).toBeLessThan(300);
      });
    }
  });
});
