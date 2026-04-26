import { format } from "date-fns"

/**
 * Pure CSV-builder for the account-ledger drawer's "Download CSV" button.
 *
 * Lives outside `chart-of-accounts.tsx` so the export contract — column
 * order, RFC-4180 quoting, BOM, ISO dates, bare numerics, opening/closing
 * subtotal layout — can be unit-tested without spinning up the full
 * drawer (which depends on the auth/session stack and the journal-entries
 * query).
 *
 * The drawer wires this up by passing in:
 *   - the same period-filtered postings it renders, in the same
 *     newest-first order (so what users get on disk matches what they
 *     see on screen);
 *   - the four pre-computed subtotal numbers (opening balance, closing
 *     balance, period debit total, period credit total);
 *   - localized column / row labels.
 */

/** Column + subtotal-row labels in the active locale. */
export interface LedgerCsvLabels {
  date: string
  memo: string
  debit: string
  credit: string
  balance: string
  je: string
  opening: string
  closing: string
}

/**
 * Minimal posting shape the CSV builder needs. Mirrors `LedgerPosting` in
 * `chart-of-accounts.tsx` but only carries the fields actually written to
 * the file, so a future refactor of the on-screen row type doesn't drag
 * the export with it.
 */
export interface LedgerCsvPosting {
  jeId: number
  reference: string
  entryDate: string
  description: string | null
  lineMemo: string | null
  debit: number
  credit: number
  balance: number
}

/** Pre-computed totals for the trailing opening/closing block. */
export interface LedgerCsvSubtotals {
  openingBalance: number
  closingBalance: number
  totalDebit: number
  totalCredit: number
}

/**
 * RFC-4180 cell quoting: only quote when the value contains a comma,
 * a double-quote, or a newline; embedded quotes are doubled. Keeps
 * "clean" cells (most rows) unquoted so the file is easy to skim
 * if anyone opens it in a text editor.
 */
function csvCell(value: string): string {
  return /[",\n\r]/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value
}

/**
 * Build the CSV body for the visible postings, terminated by the
 * opening/closing subtotal block. The first character is a UTF-8 BOM so
 * Excel for Windows treats Arabic memos as UTF-8 instead of mojibake;
 * lines are joined with CRLF per RFC 4180.
 *
 * Numeric cells are emitted as plain `String(number)` (no currency
 * symbol, no thousands separators) so spreadsheet apps parse them as
 * numbers, not text. Empty debit / credit cells stay empty (rather than
 * "0") so the column visually matches what users see in the drawer.
 */
export function buildLedgerCsv(
  postings: LedgerCsvPosting[],
  subtotals: LedgerCsvSubtotals,
  labels: LedgerCsvLabels,
): string {
  const header = [
    labels.date,
    labels.memo,
    labels.debit,
    labels.credit,
    labels.balance,
    labels.je,
  ]
  const dataRows = postings.map((p) => [
    // ISO date — unambiguous across locales, sorts correctly in Excel.
    format(new Date(p.entryDate), "yyyy-MM-dd"),
    p.lineMemo || p.description || "",
    p.debit > 0 ? String(p.debit) : "",
    p.credit > 0 ? String(p.credit) : "",
    String(p.balance),
    p.reference || `JE #${p.jeId}`,
  ])
  // Subtotal block mirrors the on-screen <tfoot>: opening row leaves
  // debit/credit blank (they don't apply); closing row carries the
  // period totals alongside the closing balance.
  const openingRow = [
    labels.opening,
    "",
    "",
    "",
    String(subtotals.openingBalance),
    "",
  ]
  const closingRow = [
    labels.closing,
    "",
    String(subtotals.totalDebit),
    String(subtotals.totalCredit),
    String(subtotals.closingBalance),
    "",
  ]
  const body = [header, ...dataRows, openingRow, closingRow]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")
  return "\uFEFF" + body
}

/**
 * Build the suggested download filename for an exported ledger:
 *   `{prefix}-{accountCode}-{yyyyMMdd-HHmmss}.csv`
 *
 * The timestamp suffix keeps repeated exports of the same account
 * distinguishable in the user's downloads folder. `now` is taken as a
 * parameter so unit tests stay deterministic.
 */
export function buildLedgerCsvFilename(
  prefix: string,
  accountCode: string,
  now: Date,
): string {
  const stamp = format(now, "yyyyMMdd-HHmmss")
  return `${prefix}-${accountCode}-${stamp}.csv`
}
