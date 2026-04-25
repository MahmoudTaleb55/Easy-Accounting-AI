import type { Account } from "@shared/schema"

/**
 * One row of the `/api/accounts/balances` response — only the fields the
 * rollup actually consumes are required, so a leaner shape (e.g. a
 * future paginated payload) still works without churning this helper.
 *
 * Carries `debit` and `credit` alongside `balance` so the chart-of-
 * accounts trailing-balance hover/popover (task #224) can show the
 * period's gross movement on each side, not just the net.
 */
export interface AccountBalanceRow {
  accountId: number
  debit: number
  credit: number
  balance: number
}

/**
 * Per-account view of the active period's activity. Leaves carry their
 * own posted figures; header rows carry the rolled-up sum across their
 * subtree. Each side (debit / credit / net balance) is summed
 * independently so a parent's gross movement never has to be re-derived
 * from a (potentially small) net.
 */
export interface BalanceBreakdown {
  debit: number
  credit: number
  balance: number
}

/**
 * Roll up the per-postable-account balances returned by
 * `/api/accounts/balances` onto every header row in the chart of
 * accounts. The endpoint only emits one row per posting account
 * (header rows never receive a JE), so the chart-of-accounts page
 * needs to compute each header's displayed total as the sum of every
 * descendant leaf in its subtree.
 *
 * Lives in its own module so the unit suite can exercise the rollup
 * (workspace-scoped, period-scoped, debit-vs-credit-normal sign rules
 * are covered server-side by `tests/e2e/account-balances-rollup.spec.ts`)
 * without spinning up the full COA page + its query/context plumbing.
 *
 * Contract:
 *   - Returns a Map keyed by `Account.id`, valued by a
 *     `{ debit, credit, balance }` breakdown so the trailing-balance
 *     tooltip/popover can show all three figures (task #224).
 *   - Leaf accounts get whatever figures the server reported (or zeros
 *     if they have no postings yet — matching the trial balance view,
 *     so a leaf is never silently absent from the map).
 *   - Header accounts get the sum of every descendant leaf's posted
 *     debit, credit, and balance. Headers themselves never carry posted
 *     figures, so the `direct` term is zeros for them in practice — but
 *     we still add it so a future seed mistake (a header row that
 *     somehow accrues postings) is surfaced rather than silently
 *     dropped.
 *   - Accounts whose `parentId` points at a row not present in the
 *     `accounts` array are treated as roots: this matches what the page
 *     already does and keeps the rollup defensive against a partially
 *     loaded chart.
 */
export function computeBalanceByAccountId(
  accounts: readonly Account[] | null | undefined,
  balanceRows: readonly AccountBalanceRow[] | null | undefined,
): Map<number, BalanceBreakdown> {
  const map = new Map<number, BalanceBreakdown>()
  if (!accounts || !balanceRows) return map

  const byId = new Map<number, Account>(accounts.map((a) => [a.id, a]))
  const childrenByParent = new Map<number, Account[]>()
  for (const a of accounts) {
    if (a.parentId == null) continue
    const arr = childrenByParent.get(a.parentId) ?? []
    arr.push(a)
    childrenByParent.set(a.parentId, arr)
  }
  const leafBreakdown = new Map<number, BalanceBreakdown>(
    balanceRows.map((r) => [
      r.accountId,
      { debit: r.debit, credit: r.credit, balance: r.balance },
    ]),
  )
  function compute(a: Account): BalanceBreakdown {
    const direct = leafBreakdown.get(a.id) ?? { debit: 0, credit: 0, balance: 0 }
    const kids = childrenByParent.get(a.id) ?? []
    const sum: BalanceBreakdown = { ...direct }
    for (const k of kids) {
      const c = compute(k)
      sum.debit += c.debit
      sum.credit += c.credit
      sum.balance += c.balance
    }
    map.set(a.id, sum)
    return sum
  }
  for (const a of accounts) {
    if (a.parentId == null || !byId.has(a.parentId)) compute(a)
  }
  return map
}
