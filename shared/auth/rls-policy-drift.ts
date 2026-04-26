/**
 * Single source of truth for the canonical `workspace_isolation` policy
 * expression and the helper that compares a live policy's USING /
 * WITH CHECK clauses against it.
 *
 * Used by two consumers that must agree on the same canonical text:
 *
 *   - `tests/e2e/database-rls-policy-coverage.spec.ts` — CI-time guard
 *     that runs against the test/dev DB pointed to by `DATABASE_URL`.
 *   - `server/auth/rls-policy-drift-alerts.ts` — runtime sweep that
 *     runs against the *production* DB on a periodic schedule, so a
 *     hand-edited `ALTER POLICY workspace_isolation … USING (true)` in
 *     prod is caught even though the spec never runs there.
 *
 * Keep the canonical expression here in lockstep with the policy DDL in
 * `migrations/0008_workspace_rls.sql` (and the audit_log addendum in
 * `migrations/0016_audit_log_company_id.sql`). If those migrations ever
 * rewrite the policy body, *this* string must move with them — they are
 * deliberately coupled.
 *
 * The pure logic (no `pg.Pool`, no Drizzle) lives in `shared/` so the
 * vitest unit suite can cover the detector without touching a database
 * and the runtime sweep can import it without dragging the test toolkit
 * into the server bundle.
 */

// The canonical text Postgres stores for the `workspace_isolation`
// policy. `pg_get_expr(polqual, polrelid)` round-trips the parsed
// expression, so the form Postgres returns *is* its own canonicalisation:
// a leading outer `(...)`, the OR's right-hand `=` comparison wrapped in
// its own `(...)`. Both USING and WITH CHECK clauses are written
// identically.
export const CANONICAL_POLICY_EXPR =
  "(rls_is_bypassed() OR (company_id = current_company_id()))";

// Read every `workspace_isolation` policy's parsed expression text
// directly from `pg_policy` via `pg_get_expr`. Going through `pg_policy`
// + `pg_get_expr` (rather than the `pg_policies` view's `qual` /
// `with_check` columns) keeps us on the same canonicalisation pass that
// produced `CANONICAL_POLICY_EXPR` above, so a string comparison is
// meaningful without normalising whitespace or parens by hand.
export const POLICY_EXPR_QUERY = `
  SELECT cls.relname                                AS table_name,
         pg_get_expr(p.polqual,      p.polrelid)    AS qual,
         pg_get_expr(p.polwithcheck, p.polrelid)    AS with_check
    FROM pg_policy   p
    JOIN pg_class    cls ON cls.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
   WHERE ns.nspname = 'public'
     AND p.polname  = 'workspace_isolation'
   ORDER BY cls.relname
`;

export interface PolicyExprRow {
  table_name: string;
  qual: string | null;
  with_check: string | null;
}

export interface PolicyDrift {
  table: string;
  problems: string[];
}

/**
 * Compare each `workspace_isolation` policy's USING / WITH CHECK
 * against the canonical expression. Returns one entry per offending
 * table (so callers can emit "one row per offending table" alerts), and
 * an empty array when every policy matches.
 *
 * Pure: no I/O, no `pg.Pool`. Run the canonical query
 * (`POLICY_EXPR_QUERY`) against whichever Postgres connection the
 * caller cares about — test DB (the CI spec) or prod DB (the runtime
 * sweep) — and pass the rows in.
 */
export function findPolicyDrifts(rows: PolicyExprRow[]): PolicyDrift[] {
  const drifts: PolicyDrift[] = [];
  for (const r of rows) {
    const problems: string[] = [];
    if (r.qual !== CANONICAL_POLICY_EXPR) {
      problems.push(
        `USING expression is ${JSON.stringify(r.qual)} ` +
          `but should be ${JSON.stringify(CANONICAL_POLICY_EXPR)}`,
      );
    }
    if (r.with_check !== CANONICAL_POLICY_EXPR) {
      problems.push(
        `WITH CHECK expression is ${JSON.stringify(r.with_check)} ` +
          `but should be ${JSON.stringify(CANONICAL_POLICY_EXPR)}`,
      );
    }
    if (problems.length > 0) {
      drifts.push({ table: r.table_name, problems });
    }
  }
  return drifts;
}

/**
 * Stable string signature for a single drift: `<table>|<qual>|<with_check>`.
 *
 * The runtime sweep uses this to dedupe across consecutive sweeps so a
 * standing drift doesn't re-page on every tick — the alert fires once
 * when the drift first appears (and again if its shape changes) and
 * goes quiet after that until the policy is fixed and the signature
 * disappears from the next sweep's drift set.
 */
export function policyDriftSignature(row: PolicyExprRow): string {
  return `${row.table_name}|${row.qual ?? ""}|${row.with_check ?? ""}`;
}
