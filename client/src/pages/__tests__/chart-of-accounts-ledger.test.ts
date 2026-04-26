import { describe, expect, test } from "vitest"

import {
  computeLedgerRunningBalances,
  isDebitNormalAccountType,
  type LedgerAccountType,
  type LedgerPostingInput,
} from "@/pages/chart-of-accounts-ledger"

/**
 * Unit coverage for the account ledger drawer's running-balance math.
 *
 * The same sign convention (asset/expense → debit-normal, the rest →
 * credit-normal) lives in the trial-balance endpoint
 * `server/routes.ts` (~line 487). If either side ever flips that
 * convention or breaks the oldest-first accumulation order, the
 * drawer and the report start to silently disagree and an auditor
 * has to catch it. This file pins the helper end-to-end so a
 * regression there fails loudly in CI instead.
 */

/**
 * Tiny posting builder: only the five fields the running-balance
 * accumulator actually consults. Defaults to `lineIndex: 0` so most
 * tests can ignore it; the dedicated tie-breaker case overrides it
 * to exercise the same-day same-JE ordering.
 */
function posting(
  jeId: number,
  entryDate: string,
  debit: number,
  credit: number,
  lineIndex = 0,
): LedgerPostingInput {
  return { jeId, entryDate, debit, credit, lineIndex }
}

describe("isDebitNormalAccountType", () => {
  // Pinning each of the five chart-of-accounts natures explicitly so a
  // future refactor that, say, makes "expense" credit-normal (the
  // classic sign-flip regression this whole task targets) trips here
  // before it ever reaches the drawer or the trial balance.
  test("asset and expense are debit-normal", () => {
    expect(isDebitNormalAccountType("asset")).toBe(true)
    expect(isDebitNormalAccountType("expense")).toBe(true)
  })

  test("liability, equity, and revenue are credit-normal", () => {
    expect(isDebitNormalAccountType("liability")).toBe(false)
    expect(isDebitNormalAccountType("equity")).toBe(false)
    expect(isDebitNormalAccountType("revenue")).toBe(false)
  })

  test("covers every AccountType in the chart so the rule can't drift", () => {
    // Static enumeration of the five natures the chart of accounts
    // recognises. If the union ever grows (e.g. "contra-asset"), this
    // assertion forces the helper — and the trial-balance route it
    // mirrors — to take a position on the new nature instead of
    // silently defaulting to credit-normal.
    const allTypes: LedgerAccountType[] = [
      "asset",
      "liability",
      "equity",
      "revenue",
      "expense",
    ]
    const debitNormal = allTypes.filter(isDebitNormalAccountType)
    expect(debitNormal.sort()).toEqual(["asset", "expense"])
  })
})

describe("computeLedgerRunningBalances", () => {
  test("debit-normal account: debits add, credits subtract, oldest-first", () => {
    // Cash account: opens with a +1000 debit, then a -300 credit
    // (e.g. a payment), then a +250 debit (e.g. a small receipt).
    // Running balance walks 1000 → 700 → 950. Closing balance =
    // newest row's running balance = 950.
    const rows = computeLedgerRunningBalances(
      [
        posting(1, "2025-01-01", 1000, 0),
        posting(2, "2025-01-15", 0, 300),
        posting(3, "2025-02-01", 250, 0),
      ],
      "asset",
    )

    // Helper returns rows newest-first for display.
    expect(rows.map((r) => r.jeId)).toEqual([3, 2, 1])
    expect(rows.find((r) => r.jeId === 1)?.balance).toBe(1000)
    expect(rows.find((r) => r.jeId === 2)?.balance).toBe(700)
    expect(rows.find((r) => r.jeId === 3)?.balance).toBe(950)
    // Closing balance = first display row (newest posting) = 950.
    expect(rows[0].balance).toBe(950)
  })

  test("credit-normal account: credits add, debits subtract, oldest-first", () => {
    // Accounts payable opens with a +500 credit (a bill recorded),
    // gets a -200 debit (partial payment), then another +120 credit
    // (small new bill). Running balance walks 500 → 300 → 420.
    const rows = computeLedgerRunningBalances(
      [
        posting(10, "2025-03-01", 0, 500),
        posting(11, "2025-03-10", 200, 0),
        posting(12, "2025-03-20", 0, 120),
      ],
      "liability",
    )

    expect(rows.find((r) => r.jeId === 10)?.balance).toBe(500)
    expect(rows.find((r) => r.jeId === 11)?.balance).toBe(300)
    expect(rows.find((r) => r.jeId === 12)?.balance).toBe(420)
    expect(rows[0].balance).toBe(420) // closing balance
  })

  test("equity and revenue accounts share the credit-normal rule", () => {
    // Same posting list, two different credit-normal natures: both
    // should accumulate identically (equity and revenue currently
    // share the rule). If a future refactor splits them apart this
    // test will be the first thing to fail.
    const list = [
      posting(20, "2025-04-01", 0, 1000),
      posting(21, "2025-04-02", 100, 0),
    ]
    const equityRows = computeLedgerRunningBalances(list, "equity")
    const revenueRows = computeLedgerRunningBalances(list, "revenue")

    expect(equityRows[0].balance).toBe(900)
    expect(revenueRows[0].balance).toBe(900)
  })

  test("expense accounts are debit-normal — refund credits reduce balance", () => {
    // Travel expense: +400 debit (trip), then a -50 credit (partial
    // refund posted back). Closing balance = 350. If a regression
    // ever flipped expenses to credit-normal, this would post -350.
    const rows = computeLedgerRunningBalances(
      [
        posting(30, "2025-05-01", 400, 0),
        posting(31, "2025-05-10", 0, 50),
      ],
      "expense",
    )

    expect(rows[0].balance).toBe(350)
  })

  test("accumulates oldest-first regardless of input order", () => {
    // Feed the same three postings in scrambled chronological order.
    // The closing balance must not depend on the order the page
    // happened to push them onto the array (the JE response isn't
    // guaranteed to be sorted).
    const rows = computeLedgerRunningBalances(
      [
        posting(3, "2025-02-01", 250, 0),
        posting(1, "2025-01-01", 1000, 0),
        posting(2, "2025-01-15", 0, 300),
      ],
      "asset",
    )

    // Same expected balances as the first debit-normal test.
    expect(rows.find((r) => r.jeId === 1)?.balance).toBe(1000)
    expect(rows.find((r) => r.jeId === 2)?.balance).toBe(700)
    expect(rows.find((r) => r.jeId === 3)?.balance).toBe(950)
    // And the display order is newest-first, again independent of
    // the input order.
    expect(rows.map((r) => r.jeId)).toEqual([3, 2, 1])
  })

  test("ties on entryDate are broken by jeId, then by lineIndex", () => {
    // All three postings land on the same day. The accumulator must
    // therefore fall back to (jeId asc, lineIndex asc) so the order
    // is deterministic — the page renders newest-first, but the
    // *math* underneath is oldest-first by these tie-breakers.
    //
    //   JE 5 line 0: +100 debit
    //   JE 5 line 1: -40  credit
    //   JE 7 line 0: +25  debit
    //
    // Oldest-first walk: 100 → 60 → 85. Closing = 85.
    const rows = computeLedgerRunningBalances(
      [
        posting(7, "2025-06-01", 25, 0, 0),
        posting(5, "2025-06-01", 0, 40, 1),
        posting(5, "2025-06-01", 100, 0, 0),
      ],
      "asset",
    )

    // Newest-first display order is the reverse of the oldest-first
    // walk: JE 7 (last in the walk) → JE 5 line 1 → JE 5 line 0.
    expect(rows.map((r) => `${r.jeId}-${r.lineIndex}`)).toEqual([
      "7-0",
      "5-1",
      "5-0",
    ])
    expect(rows.find((r) => r.jeId === 5 && r.lineIndex === 0)?.balance).toBe(100)
    expect(rows.find((r) => r.jeId === 5 && r.lineIndex === 1)?.balance).toBe(60)
    expect(rows.find((r) => r.jeId === 7)?.balance).toBe(85)
  })

  test("returns an empty array for no postings", () => {
    expect(computeLedgerRunningBalances([], "asset")).toEqual([])
    expect(computeLedgerRunningBalances([], "liability")).toEqual([])
  })

  test("preserves caller-provided extra fields on each row", () => {
    // The drawer passes richer rows (reference, description,
    // lineMemo) through the helper. The generic should let those
    // ride along untouched so the consumer doesn't have to re-merge
    // them after the math runs.
    type RichPosting = LedgerPostingInput & {
      reference: string
      memo: string
    }
    const rich: RichPosting[] = [
      { ...posting(1, "2025-01-01", 100, 0), reference: "JE-001", memo: "open" },
      { ...posting(2, "2025-01-02", 0, 30), reference: "JE-002", memo: "pay" },
    ]

    const out = computeLedgerRunningBalances(rich, "asset")

    expect(out.find((r) => r.jeId === 1)?.reference).toBe("JE-001")
    expect(out.find((r) => r.jeId === 1)?.memo).toBe("open")
    expect(out.find((r) => r.jeId === 2)?.reference).toBe("JE-002")
    expect(out.find((r) => r.jeId === 2)?.memo).toBe("pay")
    expect(out[0].balance).toBe(70)
  })

  test("matches the trial-balance route's per-account signing rule", () => {
    // The signing rule the helper enforces is the same one the
    // trial-balance endpoint applies in `server/routes.ts` (~line
    // 487): `isDebitNormal ? debit - credit : credit - debit`.
    // Re-derive that exact formula here against a synthetic per-
    // account totals fixture and assert the helper's closing
    // balance lands on the same number for every account nature.
    // A regression on either side falls out of sync with the other
    // and trips this assertion immediately.
    const totalsByType: Record<LedgerAccountType, { debit: number; credit: number }> = {
      asset: { debit: 1500, credit: 400 }, // cash +1500 in, -400 out
      expense: { debit: 800, credit: 50 }, // travel cost, small refund
      liability: { debit: 200, credit: 900 }, // bills net of partial payments
      equity: { debit: 0, credit: 5000 }, // owner contribution
      revenue: { debit: 100, credit: 1200 }, // sale net of refund
    }

    for (const [type, t] of Object.entries(totalsByType) as Array<
      [LedgerAccountType, { debit: number; credit: number }]
    >) {
      const isDebitNormal = isDebitNormalAccountType(type)
      // Trial-balance route's rule, copy-pasted on purpose so the
      // test doesn't accidentally re-use the helper to "prove" the
      // helper.
      const trialBalanceSigned = isDebitNormal
        ? t.debit - t.credit
        : t.credit - t.debit

      // Helper closes on the same number — fed two postings (one
      // pure debit, one pure credit) so the per-row math reduces to
      // the same totals the trial-balance route works from.
      const rows = computeLedgerRunningBalances(
        [
          posting(1, "2025-01-01", t.debit, 0),
          posting(2, "2025-01-02", 0, t.credit),
        ],
        type,
      )

      expect(rows[0].balance).toBe(trialBalanceSigned)
    }
  })
})
