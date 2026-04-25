import { describe, expect, test } from "vitest"

import type { Account } from "@shared/schema"
import {
  computeBalanceByAccountId,
  type AccountBalanceRow,
} from "@/pages/chart-of-accounts-rollup"

/**
 * Unit coverage for the chart-of-accounts header-row balance rollup.
 *
 * The full server-side balance computation (workspace scoping, period
 * scoping, debit-vs-credit-normal sign conventions) is exercised end-
 * to-end against the live API in
 * `tests/e2e/account-balances-rollup.spec.ts`. This file pins the
 * client-side rollup contract: every header row's displayed balance
 * must equal the sum of every descendant leaf's balance, no matter how
 * deep the hierarchy goes. A regression here (e.g. a future refactor
 * that only sums direct children, or stops descending past header
 * rows) would silently mislead owners about how much sits in each
 * bucket.
 */

/**
 * Build an `Account` row with the few fields the rollup actually
 * consults — `id`, `parentId`, and `isHeader` — and reasonable
 * defaults for every other column the schema requires. Casting the
 * result to `Account` keeps the test inputs concise without losing
 * type safety at the helper boundary.
 */
function account(
  id: number,
  parentId: number | null,
  opts: { code?: string; isHeader?: boolean } = {},
): Account {
  return {
    id,
    companyId: 1,
    code: opts.code ?? `ACC-${id}`,
    nameAr: `حساب ${id}`,
    nameEn: `Account ${id}`,
    type: "asset",
    subtype: "current_asset",
    parentId,
    isHeader: opts.isHeader ?? false,
    isActive: true,
    createdAt: new Date(),
  } as Account
}

describe("computeBalanceByAccountId", () => {
  test("returns an empty map when accounts or balance rows are missing", () => {
    expect(computeBalanceByAccountId(undefined, undefined).size).toBe(0)
    expect(computeBalanceByAccountId(null, [{ accountId: 1, balance: 5 }]).size).toBe(0)
    expect(computeBalanceByAccountId([account(1, null)], null).size).toBe(0)
  })

  test("leaf accounts surface their own posted balance, and 0 when unposted", () => {
    const accounts: Account[] = [
      account(10, null, { code: "1110" }),
      account(11, null, { code: "1120" }),
    ]
    const balances: AccountBalanceRow[] = [{ accountId: 10, balance: 250.5 }]

    const result = computeBalanceByAccountId(accounts, balances)

    expect(result.get(10)).toBe(250.5)
    // Unposted leaves still appear in the map with a zero balance so the
    // page never silently blanks a row that exists in the chart but
    // hasn't been posted to yet.
    expect(result.get(11)).toBe(0)
  })

  test("a 2-level deep header sums every descendant leaf — the core rollup contract", () => {
    // Tree (mirrors the seeded IFRS chart's shape, e.g. 1000 → 1100 →
    // {1110, 1120}, with two siblings under 1100):
    //
    //   1000 (Assets — header)
    //     └─ 1100 (Current assets — header)
    //          ├─ 1110 (Cash — leaf, balance 100)
    //          └─ 1120 (Accounts receivable — leaf, balance 250)
    //
    // The server only emits posted-account rows (1110, 1120). The page
    // is responsible for rolling those onto 1100 (=350) and onto 1000
    // (=350). A regression that only summed the direct children of a
    // header would still produce 350 for 1100 here, but 0 for 1000 —
    // which is exactly what this assertion catches.
    const accounts: Account[] = [
      account(1, null, { code: "1000", isHeader: true }),
      account(2, 1, { code: "1100", isHeader: true }),
      account(3, 2, { code: "1110" }),
      account(4, 2, { code: "1120" }),
    ]
    const balances: AccountBalanceRow[] = [
      { accountId: 3, balance: 100 },
      { accountId: 4, balance: 250 },
    ]

    const result = computeBalanceByAccountId(accounts, balances)

    // Direct leaves carry their own balance.
    expect(result.get(3)).toBe(100)
    expect(result.get(4)).toBe(250)
    // Mid-level header sums its direct leaf children.
    expect(result.get(2)).toBe(350)
    // Root header sums every descendant leaf — *not* just its direct
    // children (which are themselves headers with no posted balance).
    expect(result.get(1)).toBe(350)
  })

  test("rollup descends through multiple header layers and across sibling subtrees", () => {
    // Root with two header subtrees, each with its own leaf children,
    // exercises both the deeper recursion path and the sibling-summing
    // path in the same fixture:
    //
    //   1 (root header)
    //     ├─ 2 (header)
    //     │    ├─ 3 (leaf, 10)
    //     │    └─ 4 (header)
    //     │         └─ 5 (leaf, 20)
    //     └─ 6 (header)
    //          └─ 7 (leaf, 70)
    const accounts: Account[] = [
      account(1, null, { isHeader: true }),
      account(2, 1, { isHeader: true }),
      account(3, 2),
      account(4, 2, { isHeader: true }),
      account(5, 4),
      account(6, 1, { isHeader: true }),
      account(7, 6),
    ]
    const balances: AccountBalanceRow[] = [
      { accountId: 3, balance: 10 },
      { accountId: 5, balance: 20 },
      { accountId: 7, balance: 70 },
    ]

    const result = computeBalanceByAccountId(accounts, balances)

    expect(result.get(4)).toBe(20) // header above a single leaf
    expect(result.get(2)).toBe(30) // header summing leaf + nested header subtree
    expect(result.get(6)).toBe(70) // sibling subtree
    expect(result.get(1)).toBe(100) // root summing both subtrees
  })

  test("preserves balance signs so debit-normal vs credit-normal headers roll up correctly", () => {
    // The server already applies the debit-normal vs credit-normal
    // convention before returning balances (see `getAccountBalances` +
    // the route handler in `server/routes.ts`), so a credit-normal
    // leaf can legitimately arrive with a positive *or* negative
    // balance. The rollup must add them as signed numbers — turning
    // either into an absolute value before summing would silently
    // misreport headers that mix surplus and deficit children.
    const accounts: Account[] = [
      account(100, null, { isHeader: true }),
      account(101, 100), // posted leaf, +500
      account(102, 100), // posted leaf, -200 (e.g. an overdrawn liability)
    ]
    const balances: AccountBalanceRow[] = [
      { accountId: 101, balance: 500 },
      { accountId: 102, balance: -200 },
    ]

    const result = computeBalanceByAccountId(accounts, balances)

    expect(result.get(101)).toBe(500)
    expect(result.get(102)).toBe(-200)
    expect(result.get(100)).toBe(300)
  })

  test("treats accounts with an unknown parentId as roots so partial loads stay defensive", () => {
    // Mirrors the page's existing defensive behaviour: if `parentId`
    // points at a row that isn't in the loaded accounts list (e.g.
    // pagination, soft-deleted parent), the orphan is rolled up as
    // its own root rather than silently dropped from the map.
    const accounts: Account[] = [account(42, 999 /* parent not in list */)]
    const balances: AccountBalanceRow[] = [{ accountId: 42, balance: 17 }]

    const result = computeBalanceByAccountId(accounts, balances)

    expect(result.get(42)).toBe(17)
  })
})
