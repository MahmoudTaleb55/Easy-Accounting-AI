import type { Account } from "@shared/schema"

/**
 * One row of the `/api/accounts/balances` response — only the fields the
 * rollup actually consumes are required, so a leaner shape (e.g. a
 * future paginated payload) still works without churning this helper.
 */
export interface AccountBalanceRow {
  accountId: number
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
 *   - Returns a Map keyed by `Account.id`.
 *   - Leaf accounts get whatever balance the server reported (or 0 if
 *     they have no postings yet — matching the trial balance view, so
 *     a leaf is never silently absent from the map).
 *   - Header accounts get the sum of every descendant leaf's posted
 *     balance. Headers themselves never carry a posted balance, so the
 *     `direct` term is 0 for them in practice — but we still add it so
 *     a future seed mistake (a header row that somehow accrues a
 *     balance) is surfaced rather than silently dropped.
 *   - Accounts whose `parentId` points at a row not present in the
 *     `accounts` array are treated as roots: this matches what the page
 *     already does and keeps the rollup defensive against a partially
 *     loaded chart.
 */
export function computeBalanceByAccountId(
  accounts: readonly Account[] | null | undefined,
  balanceRows: readonly AccountBalanceRow[] | null | undefined,
): Map<number, number> {
  const map = new Map<number, number>()
  if (!accounts || !balanceRows) return map

  const byId = new Map<number, Account>(accounts.map((a) => [a.id, a]))
  const childrenByParent = new Map<number, Account[]>()
  for (const a of accounts) {
    if (a.parentId == null) continue
    const arr = childrenByParent.get(a.parentId) ?? []
    arr.push(a)
    childrenByParent.set(a.parentId, arr)
  }
  const leafBalance = new Map<number, number>(
    balanceRows.map((r) => [r.accountId, r.balance]),
  )
  function compute(a: Account): number {
    const direct = leafBalance.get(a.id) ?? 0
    const kids = childrenByParent.get(a.id) ?? []
    let sum = direct
    for (const k of kids) sum += compute(k)
    map.set(a.id, sum)
    return sum
  }
  for (const a of accounts) {
    if (a.parentId == null || !byId.has(a.parentId)) compute(a)
  }
  return map
}
