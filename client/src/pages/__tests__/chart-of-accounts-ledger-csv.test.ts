import { describe, expect, test } from "vitest"

import {
  buildLedgerCsv,
  buildLedgerCsvFilename,
  type LedgerCsvLabels,
  type LedgerCsvPosting,
  type LedgerCsvSubtotals,
} from "@/pages/chart-of-accounts-ledger-csv"

/**
 * Pins the contract for the account-ledger drawer's "Download CSV" export
 * (task #259). The on-screen drawer can't be exercised in a fast unit
 * test (it depends on the auth/session stack and the journal-entries
 * query), so this file covers the format invariants that finance users
 * actually rely on:
 *
 *   1. Numeric cells are bare numbers — no currency symbol, no thousands
 *      separators — so Excel/Sheets parse them as numbers, not text.
 *   2. The visible postings are written in the exact order they were
 *      handed in (newest-first matches what the drawer renders).
 *   3. The opening / closing subtotal rows trail the data block, with
 *      the same column placements as the on-screen <tfoot>.
 *   4. CSV mechanics (BOM, CRLF, RFC-4180 quoting of commas / quotes /
 *      newlines) are correct so the file opens cleanly in Excel +
 *      Google Sheets, including with Arabic memos.
 *   5. The download filename includes the account code and a sortable
 *      timestamp so saved exports stay distinguishable.
 */

const LABELS: LedgerCsvLabels = {
  date: "Date",
  memo: "Memo",
  debit: "Debit",
  credit: "Credit",
  balance: "Balance",
  je: "Entry",
  opening: "Opening balance",
  closing: "Closing balance",
}

const SUBTOTALS: LedgerCsvSubtotals = {
  openingBalance: 1000,
  closingBalance: 1525.5,
  totalDebit: 700.5,
  totalCredit: 175,
}

const POSTINGS: LedgerCsvPosting[] = [
  {
    jeId: 12,
    reference: "JE-12",
    entryDate: "2026-03-15T00:00:00.000Z",
    description: "Office rent",
    lineMemo: "March rent",
    debit: 500.5,
    credit: 0,
    balance: 1525.5,
  },
  {
    jeId: 11,
    reference: "JE-11",
    entryDate: "2026-03-10T00:00:00.000Z",
    description: "Refund",
    lineMemo: null,
    debit: 0,
    credit: 175,
    balance: 1025,
  },
  {
    jeId: 10,
    reference: "JE-10",
    entryDate: "2026-03-01T00:00:00.000Z",
    description: null,
    lineMemo: null,
    debit: 200,
    credit: 0,
    balance: 1200,
  },
]

function splitRows(csv: string): string[] {
  // Strip BOM and split on the CRLF line terminator we emit.
  return csv.replace(/^\uFEFF/, "").split("\r\n")
}

describe("buildLedgerCsv", () => {
  test("starts with a UTF-8 BOM so Excel reads UTF-8 (Arabic stays clean)", () => {
    const csv = buildLedgerCsv(POSTINGS, SUBTOTALS, LABELS)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  test("uses CRLF line terminators per RFC 4180", () => {
    const csv = buildLedgerCsv(POSTINGS, SUBTOTALS, LABELS)
    // Every line break in the file is the \r\n pair — there should be
    // no bare \n that isn't preceded by an \r.
    const body = csv.slice(1)
    expect(/(?<!\r)\n/.test(body)).toBe(false)
    expect(body.includes("\r\n")).toBe(true)
  })

  test("first row is the column header in the documented order", () => {
    const rows = splitRows(buildLedgerCsv(POSTINGS, SUBTOTALS, LABELS))
    expect(rows[0]).toBe("Date,Memo,Debit,Credit,Balance,Entry")
  })

  test("postings are written in the order received (newest-first input is preserved)", () => {
    const rows = splitRows(buildLedgerCsv(POSTINGS, SUBTOTALS, LABELS))
    // Three data rows between the header and the two subtotal rows.
    expect(rows.length).toBe(1 + POSTINGS.length + 2)
    expect(rows[1].startsWith("2026-03-15,")).toBe(true)
    expect(rows[2].startsWith("2026-03-10,")).toBe(true)
    expect(rows[3].startsWith("2026-03-01,")).toBe(true)
  })

  test("numeric cells are bare numbers — no currency symbol, no thousands separator", () => {
    const rows = splitRows(buildLedgerCsv(POSTINGS, SUBTOTALS, LABELS))
    // Sample a row that has both a non-trivial debit and a balance over
    // a thousand — the most likely place a thousands-separator regression
    // would hide.
    expect(rows[1]).toBe("2026-03-15,March rent,500.5,,1525.5,JE-12")
    // Closing row carries the period totals + closing balance.
    expect(rows.at(-1)).toBe("Closing balance,,700.5,175,1525.5,")
  })

  test("blank debit/credit cells stay blank instead of '0' so the column matches the on-screen view", () => {
    const rows = splitRows(buildLedgerCsv(POSTINGS, SUBTOTALS, LABELS))
    // Credit-only row: debit cell is empty, credit is 175.
    expect(rows[2]).toBe("2026-03-10,Refund,,175,1025,JE-11")
  })

  test("falls back to the JE description, then to a synthesized reference when the line has neither", () => {
    const rows = splitRows(buildLedgerCsv(POSTINGS, SUBTOTALS, LABELS))
    // Third posting has no lineMemo and no description — memo column
    // must be empty, not the literal "null" or "undefined".
    const cells = rows[3].split(",")
    expect(cells[1]).toBe("")
    // And a posting with no reference would be labeled "JE #<id>".
    const refless = buildLedgerCsv(
      [{ ...POSTINGS[0], reference: "" }],
      SUBTOTALS,
      LABELS,
    )
    const reflessRows = splitRows(refless)
    expect(reflessRows[1].endsWith(",JE #12")).toBe(true)
  })

  test("opening row leaves debit/credit blank; closing row carries period totals", () => {
    const rows = splitRows(buildLedgerCsv(POSTINGS, SUBTOTALS, LABELS))
    expect(rows.at(-2)).toBe("Opening balance,,,,1000,")
    expect(rows.at(-1)).toBe("Closing balance,,700.5,175,1525.5,")
  })

  test("memos containing commas, quotes or newlines are RFC-4180-quoted", () => {
    const trickyPostings: LedgerCsvPosting[] = [
      {
        ...POSTINGS[0],
        lineMemo: 'Invoice #44, "rush job"\nPaid in full',
        description: null,
      },
    ]
    const rows = splitRows(
      buildLedgerCsv(trickyPostings, SUBTOTALS, LABELS),
    )
    // Embedded quotes are doubled, the entire field is wrapped in
    // quotes, and the embedded newline survives intact inside that
    // quoted field.
    expect(rows[1]).toContain(
      '"Invoice #44, ""rush job""\nPaid in full"',
    )
  })

  test("supports an empty postings list (header + opening/closing only)", () => {
    // The drawer disables the export button when there are no postings,
    // but the builder itself must not blow up if called with []; better
    // than throwing on an edge case the UI is expected to gate.
    const rows = splitRows(buildLedgerCsv([], SUBTOTALS, LABELS))
    expect(rows.length).toBe(3)
    expect(rows[0]).toBe("Date,Memo,Debit,Credit,Balance,Entry")
    expect(rows[1]).toBe("Opening balance,,,,1000,")
    expect(rows[2]).toBe("Closing balance,,700.5,175,1525.5,")
  })

  test("Arabic labels survive untouched (no quoting needed; BOM keeps Excel happy)", () => {
    const arLabels: LedgerCsvLabels = {
      date: "التاريخ",
      memo: "البيان",
      debit: "مدين",
      credit: "دائن",
      balance: "الرصيد",
      je: "القيد",
      opening: "الرصيد الافتتاحي",
      closing: "الرصيد الختامي",
    }
    const rows = splitRows(buildLedgerCsv(POSTINGS, SUBTOTALS, arLabels))
    expect(rows[0]).toBe("التاريخ,البيان,مدين,دائن,الرصيد,القيد")
    expect(rows.at(-2)?.startsWith("الرصيد الافتتاحي,")).toBe(true)
    expect(rows.at(-1)?.startsWith("الرصيد الختامي,")).toBe(true)
  })
})

describe("buildLedgerCsvFilename", () => {
  test("uses the documented {prefix}-{code}-{yyyyMMdd-HHmmss}.csv shape", () => {
    const name = buildLedgerCsvFilename(
      "ledger",
      "1100",
      new Date("2026-04-26T14:05:09.000Z"),
    )
    // Built with date-fns format() on the local time, but the
    // filename layout itself (prefix, account code, dash-separated
    // 8+6-digit timestamp, .csv extension) must be deterministic.
    expect(name).toMatch(/^ledger-1100-\d{8}-\d{6}\.csv$/)
  })

  test("embeds the account code so saved exports stay distinguishable", () => {
    const a = buildLedgerCsvFilename("ledger", "1100", new Date(0))
    const b = buildLedgerCsvFilename("ledger", "5200", new Date(0))
    expect(a).not.toBe(b)
    expect(a).toContain("-1100-")
    expect(b).toContain("-5200-")
  })

  test("respects the localized prefix (English vs Arabic exports keep distinct names)", () => {
    const en = buildLedgerCsvFilename("ledger", "1100", new Date(0))
    const ar = buildLedgerCsvFilename("حركة-حساب", "1100", new Date(0))
    expect(en.startsWith("ledger-")).toBe(true)
    expect(ar.startsWith("حركة-حساب-")).toBe(true)
  })

  test("two exports a second apart get distinguishable filenames", () => {
    const t1 = new Date("2026-04-26T14:05:09.000Z")
    const t2 = new Date("2026-04-26T14:05:10.000Z")
    expect(buildLedgerCsvFilename("ledger", "1100", t1)).not.toBe(
      buildLedgerCsvFilename("ledger", "1100", t2),
    )
  })
})
