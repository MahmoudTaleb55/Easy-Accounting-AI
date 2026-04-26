/**
 * Pure running-balance math for the account ledger drawer in
 * `chart-of-accounts.tsx` (`AccountLedgerSheet`). Pulled out of the
 * component so a unit test can pin the sign convention and the
 * oldest-first accumulation order without spinning up the full page,
 * its query plumbing, or its period context.
 *
 * Why this matters: the trial-balance endpoint in
 * `server/routes.ts` (~line 487) signs each account's balance with the
 * exact same rule — asset/expense are debit-normal, the rest are
 * credit-normal. If either side ever flips that convention the drawer
 * and the report will silently disagree until an auditor notices, so
 * keeping the rule in one helper (and locking it in with tests) is
 * worth the extra module.
 */

/** The five account natures the chart of accounts recognises. */
export type LedgerAccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "expense"

/**
 * Minimal shape of a posting the running-balance accumulator needs.
 * Callers can pass a richer object (e.g. with `reference`,
 * `description`, `lineMemo`) — the helper preserves the extra fields
 * via the generic so the consumer doesn't have to re-merge them.
 *
 * `lineIndex` is the position of the line *within its journal entry*
 * and acts as the deterministic tie-breaker when several lines on the
 * same entry post to the same account.
 */
export interface LedgerPostingInput {
  jeId: number
  entryDate: string
  lineIndex: number
  debit: number
  credit: number
}

/** Whether an account's natural balance lives on the debit side. */
export function isDebitNormalAccountType(type: LedgerAccountType): boolean {
  return type === "asset" || type === "expense"
}

/**
 * Accumulate a running balance across `postings` and return them in
 * *display* order (newest first), each row carrying the balance the
 * account stood at immediately after that posting. Closing balance for
 * a window is therefore `result[0]?.balance ?? 0`.
 *
 * Implementation notes the test pins:
 *   1. Sign convention — debit-normal accounts add `debit - credit`,
 *      credit-normal accounts add `credit - debit`. Mirrors the
 *      trial-balance route in `server/routes.ts`.
 *   2. Accumulation is oldest-first so each row sees every prior
 *      posting baked in. Ties on `entryDate` are broken by `jeId`,
 *      then by `lineIndex`, so the order is deterministic when a day
 *      has multiple entries that touch the account.
 *   3. The returned array is sorted newest-first for display; the
 *      already-computed `balance` rides along unchanged.
 */
export function computeLedgerRunningBalances<T extends LedgerPostingInput>(
  postings: readonly T[],
  accountType: LedgerAccountType,
): Array<T & { balance: number }> {
  const debitNormal = isDebitNormalAccountType(accountType)
  const rows: Array<T & { balance: number }> = postings.map((p) => ({
    ...p,
    balance: 0,
  }))
  rows.sort((a, b) =>
    a.entryDate < b.entryDate ? -1 :
    a.entryDate > b.entryDate ? 1 :
    a.jeId !== b.jeId ? a.jeId - b.jeId :
    a.lineIndex - b.lineIndex,
  )
  let running = 0
  for (const r of rows) {
    running += debitNormal ? r.debit - r.credit : r.credit - r.debit
    r.balance = running
  }
  rows.sort((a, b) =>
    a.entryDate < b.entryDate ? 1 :
    a.entryDate > b.entryDate ? -1 :
    a.jeId !== b.jeId ? b.jeId - a.jeId :
    b.lineIndex - a.lineIndex,
  )
  return rows
}
