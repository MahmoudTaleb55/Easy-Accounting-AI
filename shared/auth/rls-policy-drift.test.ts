import { describe, expect, test } from "vitest";

import {
  CANONICAL_POLICY_EXPR,
  POLICY_EXPR_QUERY,
  findPolicyDrifts,
  policyDriftSignature,
  type PolicyExprRow,
} from "./rls-policy-drift";

/**
 * Pure-logic coverage for the canonical-expression detector that the
 * production drift sweep (`server/auth/rls-policy-drift-alerts.ts`) and
 * the test-DB coverage spec
 * (`tests/e2e/database-rls-policy-coverage.spec.ts`) both rely on.
 *
 * Pinned here so a future tweak to the detector — different normalised
 * form, a typo in the canonical expression, a regression that drops the
 * WITH CHECK arm — surfaces in the unit suite *before* it ever reaches
 * the live database checks.
 */

const canonical = (table: string): PolicyExprRow => ({
  table_name: table,
  qual: CANONICAL_POLICY_EXPR,
  with_check: CANONICAL_POLICY_EXPR,
});

describe("findPolicyDrifts", () => {
  test("returns no drifts when every policy matches the canonical form", () => {
    const drifts = findPolicyDrifts([
      canonical("accounts"),
      canonical("journal_entries"),
      canonical("audit_log"),
    ]);
    expect(drifts).toEqual([]);
  });

  test("flags a USING (true) tamper as a USING-clause problem", () => {
    const drifts = findPolicyDrifts([
      canonical("audit_log"),
      { table_name: "accounts", qual: "true", with_check: CANONICAL_POLICY_EXPR },
    ]);
    expect(drifts).toHaveLength(1);
    expect(drifts[0].table).toBe("accounts");
    expect(drifts[0].problems.some((p) => p.startsWith("USING expression"))).toBe(
      true,
    );
    expect(
      drifts[0].problems.some((p) => p.startsWith("WITH CHECK expression")),
    ).toBe(false);
  });

  test("flags a WITH CHECK (true) tamper as a WITH-CHECK-clause problem", () => {
    const drifts = findPolicyDrifts([
      { table_name: "accounts", qual: CANONICAL_POLICY_EXPR, with_check: "true" },
    ]);
    expect(drifts).toHaveLength(1);
    expect(drifts[0].problems.some((p) => p.startsWith("WITH CHECK expression"))).toBe(
      true,
    );
    expect(drifts[0].problems.some((p) => p.startsWith("USING expression"))).toBe(
      false,
    );
  });

  test("flags a fully permissive (true/true) tamper on both clauses", () => {
    const drifts = findPolicyDrifts([
      { table_name: "transactions", qual: "true", with_check: "true" },
    ]);
    expect(drifts).toHaveLength(1);
    expect(drifts[0].problems).toHaveLength(2);
  });

  test("flags a NULL clause (policy with no body) on both arms", () => {
    const drifts = findPolicyDrifts([
      { table_name: "documents", qual: null, with_check: null },
    ]);
    expect(drifts).toHaveLength(1);
    expect(drifts[0].problems).toHaveLength(2);
  });

  test("collects every offender in a single pass", () => {
    const drifts = findPolicyDrifts([
      canonical("accounts"),
      { table_name: "journal_entries", qual: "true", with_check: CANONICAL_POLICY_EXPR },
      canonical("audit_log"),
      { table_name: "transactions", qual: CANONICAL_POLICY_EXPR, with_check: "true" },
    ]);
    expect(drifts.map((d) => d.table)).toEqual(["journal_entries", "transactions"]);
  });

  test("returns an empty array on an empty input set", () => {
    expect(findPolicyDrifts([])).toEqual([]);
  });
});

describe("policyDriftSignature", () => {
  test("differs when the same table drifts to a different shape", () => {
    const a = policyDriftSignature({
      table_name: "accounts",
      qual: "true",
      with_check: CANONICAL_POLICY_EXPR,
    });
    const b = policyDriftSignature({
      table_name: "accounts",
      qual: "true",
      with_check: "true",
    });
    expect(a).not.toBe(b);
  });

  test("matches when the drift shape is identical across sweeps", () => {
    const row: PolicyExprRow = {
      table_name: "audit_log",
      qual: "true",
      with_check: "true",
    };
    expect(policyDriftSignature(row)).toBe(policyDriftSignature({ ...row }));
  });

  test("includes the table name so two tables drifting to the same body are distinct", () => {
    const a = policyDriftSignature({
      table_name: "accounts",
      qual: "true",
      with_check: "true",
    });
    const b = policyDriftSignature({
      table_name: "transactions",
      qual: "true",
      with_check: "true",
    });
    expect(a).not.toBe(b);
  });
});

describe("POLICY_EXPR_QUERY", () => {
  test("scopes to public.workspace_isolation policies and returns parsed bodies", () => {
    expect(POLICY_EXPR_QUERY).toMatch(/pg_policy/);
    expect(POLICY_EXPR_QUERY).toMatch(/pg_get_expr\(p\.polqual,\s*p\.polrelid\)/);
    expect(POLICY_EXPR_QUERY).toMatch(/pg_get_expr\(p\.polwithcheck,\s*p\.polrelid\)/);
    expect(POLICY_EXPR_QUERY).toMatch(/ns\.nspname\s*=\s*'public'/);
    expect(POLICY_EXPR_QUERY).toMatch(/p\.polname\s*=\s*'workspace_isolation'/);
  });
});
