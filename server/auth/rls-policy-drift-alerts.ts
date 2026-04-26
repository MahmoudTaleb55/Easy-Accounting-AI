/**
 * Task #238 — production-side runtime sweep that catches a tampered
 * `workspace_isolation` policy in the live database, not just in the
 * test/dev DB the e2e suite runs against.
 *
 * Why this exists
 * ===============
 * `tests/e2e/database-rls-policy-coverage.spec.ts` already pins the
 * canonical USING / WITH CHECK expression of every `workspace_isolation`
 * policy and fails CI loudly the moment one drifts. But that spec only
 * runs against the database `DATABASE_URL` points to in CI/dev — a
 * permissive policy installed by hand against the *live* DB
 * (e.g. `ALTER POLICY workspace_isolation ON accounts USING (true)`)
 * would never be caught because the spec never runs there.
 *
 * This module closes that loop. It runs the same `findPolicyDrifts`
 * detector — pulled out of the spec into `shared/auth/rls-policy-drift.ts`
 * so both callers agree on the canonical text — against the *live* pool
 * on a periodic schedule, and emits an alert per offending table to
 * every workspace owner. Wired into the same in-process interval
 * pattern as `runEmailDeliveryAlertSweep`, so it shares the cron
 * lifecycle and the audited bypass discipline (see
 * `docs/design/workspace-isolation-defense-in-depth.md`).
 *
 * Suppression
 * ===========
 * In-memory dedupe by drift signature (`<table>|<qual>|<with_check>`):
 *   - First sweep that sees a given drift fires the alert and only
 *     records the signature in the dedupe set if at least one operator
 *     email actually went out (i.e. recipient lookup succeeded *and*
 *     `sendAlert` reported `ok` for at least one address).
 *   - Subsequent sweeps that see the *same* drift sit silent — the
 *     operator already has the email; we don't need to re-page them
 *     every 30 minutes while they're working the incident.
 *   - When the policy is fixed the signature drops out of the next
 *     sweep's drift set, so a *future* drift to a different shape
 *     re-fires.
 *   - If the very first send fails (transient SMTP outage, recipient
 *     lookup raised, the auth DB was momentarily unreachable, the
 *     instance has zero workspace owners, etc.) the signature is *not*
 *     added — so the next sweep retries from scratch instead of
 *     permanently muting a real production drift.
 *
 * Bypass
 * ======
 * The sweep walks `pg_policy` (a system catalog, not a workspace-scoped
 * table) and `memberships` (intentionally excluded from RLS), so
 * neither read is policy-gated. We still wrap the work in
 * `withRlsBypass("cron:rls-policy-drift-sweep", …)` because:
 *
 *   - The audit list in
 *     `docs/design/workspace-isolation-defense-in-depth.md` is the
 *     single grep-able catalogue of every code path that runs against
 *     `db` outside `withCompanyScope`. Wrapping the sweep keeps the
 *     audit list complete and the lint at
 *     `tests/e2e/db-isolation-allowlist.spec.ts` happy.
 *   - The `reason` string doubles as a log-search anchor when an
 *     operator investigates an unexpected DB query in production.
 */

import { sql } from "drizzle-orm";

import {
  CANONICAL_POLICY_EXPR,
  POLICY_EXPR_QUERY,
  findPolicyDrifts,
  policyDriftSignature,
  type PolicyExprRow,
  type PolicyDrift,
} from "@shared/auth/rls-policy-drift";

import { db, withRlsBypass } from "../db";
import { authBizStorage } from "./storage";
import { sendRlsPolicyDriftAlertEmail } from "./email";

/**
 * Outcome of a single sweep — what the cron would log on completion
 * and what the test harness asserts on against a controlled DB state.
 */
export type RlsPolicyDriftSweepOutcome = {
  /** Number of `workspace_isolation` policies inspected. */
  inspected: number;
  /** Every drift the detector flagged on this sweep. */
  drifts: PolicyDrift[];
  /** Drifts that were *new* this sweep (i.e. fired an alert). */
  fired: PolicyDrift[];
  /**
   * Drifts the detector flagged but the in-memory dedupe suppressed
   * because an identical signature was already alerted on a previous
   * sweep. Surfaces in the outcome so the test harness can prove the
   * suppression actually fired.
   */
  suppressed: PolicyDrift[];
  /** How many alert emails landed (sum across all fired offenders). */
  emailsSent: number;
};

/**
 * Drift signatures that have already fired an alert in this process.
 * Cleared between sweeps only for signatures that have *gone away*, so
 * a standing drift stays muted until it's actually fixed (and a fresh
 * future drift to a different shape re-fires).
 *
 * Module-scoped because the sweep is process-singleton (a single
 * `setInterval` per Node instance) and the dedupe budget is "this
 * process". A new container restart is the right moment to re-page —
 * an operator may have cycled the deploy *because* of the alert, and
 * a one-shot fresh page on the new instance confirms the drift is
 * still present (or, if it isn't, no email at all).
 */
const alertedSignatures: Set<string> = new Set();

/**
 * Test-only escape hatch: clear the in-memory dedupe set so a unit /
 * e2e test can drive the "fires once, suppresses on the next sweep,
 * re-fires after the policy is fixed" assertion deterministically.
 */
export function __resetRlsPolicyDriftAlertedSignaturesForTesting(): void {
  alertedSignatures.clear();
}

function buildRlsAlertLink(): string | undefined {
  const base = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  return base ? `${base}/app/settings/email-delivery` : undefined;
}

/**
 * Narrow the polymorphic shape `db.execute` may return — depending on
 * the driver, it is either a plain array of row objects or a
 * `{ rows: [...] }` wrapper around one. The detector only needs the
 * three string columns of `PolicyExprRow`, so a structural check is
 * sufficient — and explicit, rather than an `any` cast.
 */
function isRowsWrapper(value: unknown): value is { rows: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { rows?: unknown }).rows)
  );
}

function normalizePolicyExprRows(value: unknown): PolicyExprRow[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : isRowsWrapper(value)
      ? value.rows
      : [];
  const out: PolicyExprRow[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const rec = r as Record<string, unknown>;
    const table = rec.table_name;
    if (typeof table !== "string") continue;
    out.push({
      table_name: table,
      qual: typeof rec.qual === "string" ? rec.qual : null,
      with_check: typeof rec.with_check === "string" ? rec.with_check : null,
    });
  }
  return out;
}

/**
 * Read every `workspace_isolation` policy's parsed USING / WITH CHECK
 * text from the live `pg_policy` catalog and return the rows
 * `findPolicyDrifts` consumes. Pulled out so the test harness can
 * stub it independently of the alert side-channel.
 */
async function readLivePolicyRows(): Promise<PolicyExprRow[]> {
  const result: unknown = await db.execute(sql.raw(POLICY_EXPR_QUERY));
  return normalizePolicyExprRows(result);
}

/**
 * De-duplicated owner-email recipient list across every workspace.
 * Lower-cased + trimmed so the same address listed under two
 * workspaces only receives one alert email per offender.
 */
async function listAllWorkspaceOwnerEmails(): Promise<string[]> {
  const companyIds = await authBizStorage.listCompanyIdsWithMemberships();
  const seen = new Set<string>();
  for (const id of companyIds) {
    const owners = await authBizStorage.listOwnerEmailsForCompany(id);
    for (const e of owners) {
      const norm = e.trim().toLowerCase();
      if (norm && norm.includes("@")) seen.add(norm);
    }
  }
  return [...seen];
}

/**
 * One full pass: read live policies, run `findPolicyDrifts`, alert on
 * the new offenders, and drop signatures whose drift has been fixed.
 *
 * Pure-IO at the seams — every external interaction (live policy read,
 * recipient lookup, email send) is overridable from the test harness
 * via the `opts` hooks so the unit suite can drive this without a
 * Postgres connection or an SMTP provider. In production every
 * override is omitted and the defaults kick in.
 */
export async function evaluateRlsPolicyDrift(
  opts: {
    readPolicyRows?: () => Promise<PolicyExprRow[]>;
    listRecipients?: () => Promise<string[]>;
    sendAlert?: typeof sendRlsPolicyDriftAlertEmail;
    alertLink?: string;
  } = {},
): Promise<RlsPolicyDriftSweepOutcome> {
  const readPolicyRows = opts.readPolicyRows ?? readLivePolicyRows;
  const listRecipients = opts.listRecipients ?? listAllWorkspaceOwnerEmails;
  const sendAlert = opts.sendAlert ?? sendRlsPolicyDriftAlertEmail;
  const link = opts.alertLink ?? buildRlsAlertLink();

  const rows = await readPolicyRows();
  const drifts = findPolicyDrifts(rows);

  // Build the live-row index once so each fired alert can attach the
  // exact `qual` / `with_check` text the operator will need to review.
  const rowByTable = new Map<string, PolicyExprRow>(
    rows.map((r) => [r.table_name, r]),
  );

  // Drop any previously-alerted signature that no longer appears in
  // this sweep's drift set. That's how a *future* drift to the same
  // shape re-fires after the policy has been fixed and tampered with
  // again — without this prune step, the in-memory set would silently
  // mute the second drift forever.
  const liveSignatures = new Set<string>(
    drifts
      .map((d) => rowByTable.get(d.table))
      .filter((r): r is PolicyExprRow => !!r)
      .map(policyDriftSignature),
  );
  for (const sig of [...alertedSignatures]) {
    if (!liveSignatures.has(sig)) alertedSignatures.delete(sig);
  }

  const fired: PolicyDrift[] = [];
  const suppressed: PolicyDrift[] = [];
  let emailsSent = 0;

  // Resolve recipients lazily — only if there's at least one new drift
  // to alert on, so a healthy production never pays for the membership
  // / owner-email scan on every sweep.
  let recipients: string[] | null = null;

  for (const drift of drifts) {
    const row = rowByTable.get(drift.table);
    if (!row) {
      // Defensive: every drift was constructed from a row, so this
      // should never happen — but if it does, treat as a fresh fire
      // with empty live text so the operator at least learns the
      // table name.
      fired.push(drift);
      continue;
    }
    const sig = policyDriftSignature(row);
    if (alertedSignatures.has(sig)) {
      suppressed.push(drift);
      continue;
    }

    // Loud-by-default log so an operator with only stdout / stderr
    // visibility (no email side-channel configured) still sees the
    // drift. Mirrors the `[email-delivery-alert]` prefix scheme the
    // sibling sweep uses.
    console.error(
      `[rls-policy-drift] workspace_isolation policy on "${drift.table}" ` +
        `does not match canonical expression. Problems:\n` +
        drift.problems.map((p) => `  • ${p}`).join("\n"),
    );

    // Resolve recipients lazily on the first fired drift in this sweep.
    // A failure here is NOT acknowledged: leaving `recipients` at `null`
    // for this sweep would re-trigger the (failing) call for every
    // subsequent drift, so we cache the empty list — but we deliberately
    // do *not* mark any signature as alerted on this sweep, so the next
    // sweep retries from scratch. (See the "Suppression" header above:
    // a transient SMTP / auth-DB outage must not permanently mute a
    // real production drift.)
    let recipientsErrored = false;
    if (recipients === null) {
      try {
        recipients = await listRecipients();
      } catch (err) {
        console.error(
          "[rls-policy-drift] failed to list recipients for alert email:",
          err,
        );
        recipients = [];
        recipientsErrored = true;
      }
    }

    let sendOk = false;
    if (!recipientsErrored && recipients.length > 0) {
      try {
        const results = await sendAlert({
          to: recipients,
          table: drift.table,
          problems: drift.problems,
          qual: row.qual,
          withCheck: row.with_check,
          canonicalExpression: CANONICAL_POLICY_EXPR,
          link,
        });
        const okCount = results.filter((r) => r.ok).length;
        emailsSent += okCount;
        sendOk = okCount > 0;
      } catch (err) {
        console.error(
          `[rls-policy-drift] alert email send failed for "${drift.table}":`,
          err,
        );
      }
    }

    fired.push(drift);
    // Only acknowledge the drift in the dedupe set if at least one
    // operator email actually went out — otherwise the next sweep will
    // re-attempt the alert. Two intentional consequences:
    //   (a) Transient SMTP / recipient-lookup failure does not silently
    //       suppress a real, ongoing production drift.
    //   (b) When `recipients.length === 0` (no workspace owners on the
    //       instance), every sweep will keep logging the
    //       `[rls-policy-drift]` console.error above — that's the
    //       intended fallback channel for an instance with no email
    //       side-channel configured.
    if (sendOk) {
      alertedSignatures.add(sig);
    }
  }

  return {
    inspected: rows.length,
    drifts,
    fired,
    suppressed,
    emailsSent,
  };
}

/**
 * Wrap `evaluateRlsPolicyDrift` in the audited bypass scope. Exported
 * for the cron entrypoint and for the dev-only "evaluate now" route
 * that the sibling email-delivery sweep also exposes (for parity with
 * the existing operator workflow).
 */
export async function runRlsPolicyDriftSweep(
  opts: Parameters<typeof evaluateRlsPolicyDrift>[0] = {},
): Promise<RlsPolicyDriftSweepOutcome> {
  return withRlsBypass("cron:rls-policy-drift-sweep", () =>
    evaluateRlsPolicyDrift(opts),
  );
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the periodic policy-drift sweep. Defaults to every 30 minutes;
 * override via `RLS_POLICY_DRIFT_SWEEP_MINUTES`. The first run is
 * deferred briefly so app boot isn't blocked by a system-catalog
 * query on a slow DB.
 *
 * Idempotent: a second call while the timer is already armed is a
 * no-op (mirrors `startEmailDeliveryAlertJob`).
 */
export function startRlsPolicyDriftJob(): void {
  if (timer) return;
  const minutes = Math.max(
    1,
    Number(process.env.RLS_POLICY_DRIFT_SWEEP_MINUTES) || 30,
  );
  const intervalMs = minutes * 60 * 1000;
  setTimeout(() => {
    runRlsPolicyDriftSweep().catch((err) =>
      console.error("[rls-policy-drift] initial sweep failed:", err),
    );
    timer = setInterval(() => {
      runRlsPolicyDriftSweep().catch((err) =>
        console.error("[rls-policy-drift] sweep failed:", err),
      );
    }, intervalMs);
  }, 30 * 1000);
}

export function stopRlsPolicyDriftJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
