// @vitest-environment node
//
// pdfkit relies on `Buffer instanceof Uint8Array` being true (so its
// FontFactory can hand the buffer to fontkit). Under the project-wide
// `jsdom` test environment, jsdom's globals create Buffer in a different
// realm and that `instanceof` check returns false — pdfkit then throws
// "Not a supported font format or standard PDF font." for every Arabic-
// titled report. The pinned `node` environment above avoids that quirk
// and lets these tests exercise the real font pipeline. Production code
// is unaffected (Express runs under plain Node).

import { describe, it, expect } from "vitest";
import {
  generateTrialBalancePdf,
  generateProfitLossPdf,
  generateBalanceSheetPdf,
} from "../assistant-files";
import type { Account } from "@shared/schema";
import type { JournalEntryWithLines } from "../../storage";
import type { Locale } from "../../i18n/pdf-strings";

/**
 * Locale-aware end-to-end smoke tests for the three report PDF generators
 * (Trial Balance, Profit & Loss, Balance Sheet).
 *
 * The route the AI assistant uses is `generate_report` in
 * `server/services/assistant-tools.ts`, which simply forwards
 * `ctx.locale` into these three functions. Asserting the rendered binary
 * carries the localized title in its `/Info` Title metadata is therefore
 * equivalent to asserting the chat-level locale plumbing works — and it
 * exercises the exact same code path with no need to spin up the full
 * AI tool harness.
 *
 * pdfkit serializes the `/Info` Title two ways:
 *   - Pure ASCII → parenthesised literal, e.g. `(Trial Balance)`.
 *   - Anything else (Arabic, German diacritics, French accents) →
 *     parenthesised UTF-16BE bytes with a leading FEFF BOM, with any
 *     `(`, `)`, `\` byte backslash-escaped per PDF 1.7 §7.3.4.2.
 *
 * The `bodyContainsTitle` helper matches whichever form is appropriate.
 * Same logic as `tests/e2e/sales-invoice-pdf-locale.spec.ts`, kept
 * inline here so this file has zero playwright dependency and can run
 * inside the regular vitest suite.
 */

function utf16BeBytesAsLatin1(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xffff) {
      out += String.fromCharCode((cp >> 8) & 0xff, cp & 0xff);
    } else {
      const v = cp - 0x10000;
      const hi = 0xd800 + (v >> 10);
      const lo = 0xdc00 + (v & 0x3ff);
      out += String.fromCharCode(
        (hi >> 8) & 0xff, hi & 0xff,
        (lo >> 8) & 0xff, lo & 0xff,
      );
    }
  }
  return out;
}

function escapePdfLiteralBytes(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += "\\";
    out += raw[i];
  }
  return out;
}

function bodyContainsTitle(buf: Buffer, expectedTitle: string): boolean {
  const ascii = buf.toString("latin1");
  // Require the closing `)` so a *prefix* title (e.g. "Bilan") doesn't
  // false-match a longer title that starts with the same letters
  // (e.g. "Bilanz" → `(Bilanz)` would otherwise also include `(Bilan`).
  if (ascii.includes(`(${expectedTitle})`)) return true;
  const rawBytes = "\xFE\xFF" + utf16BeBytesAsLatin1(expectedTitle);
  const escaped = escapePdfLiteralBytes(rawBytes);
  return ascii.includes(`(${escaped})`);
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Minimal in-memory fixtures                                                */
/* ────────────────────────────────────────────────────────────────────────── */

// Six accounts spanning every type the three reports walk through:
//   asset / liability / equity / revenue / expense.
const FIXTURE_ACCOUNTS: Account[] = [
  { id: 1, companyId: 1, code: "1110", nameAr: "النقد بالصندوق", nameEn: "Cash on Hand", type: "asset",     subtype: "current_asset",     parentId: null, isHeader: false, isActive: true, createdAt: new Date() },
  { id: 2, companyId: 1, code: "1210", nameAr: "العملاء",         nameEn: "Receivables",  type: "asset",     subtype: "current_asset",     parentId: null, isHeader: false, isActive: true, createdAt: new Date() },
  { id: 3, companyId: 1, code: "2110", nameAr: "الموردون",        nameEn: "Suppliers",    type: "liability", subtype: "current_liability", parentId: null, isHeader: false, isActive: true, createdAt: new Date() },
  { id: 4, companyId: 1, code: "3100", nameAr: "رأس المال",       nameEn: "Capital",      type: "equity",    subtype: "capital",           parentId: null, isHeader: false, isActive: true, createdAt: new Date() },
  { id: 5, companyId: 1, code: "4100", nameAr: "إيرادات المبيعات", nameEn: "Sales Revenue", type: "revenue",   subtype: "operating_revenue", parentId: null, isHeader: false, isActive: true, createdAt: new Date() },
  { id: 6, companyId: 1, code: "5100", nameAr: "تكلفة البضاعة",   nameEn: "COGS",         type: "expense",   subtype: "cogs",              parentId: null, isHeader: false, isActive: true, createdAt: new Date() },
];

// One balanced JE: Dr Cash 1000 / Cr Sales 1000 (also matches a non-zero
// expense row so P&L has both sides). All amounts are stored as numeric
// strings — that's what drizzle's pg numeric type returns.
const FIXTURE_JE: JournalEntryWithLines[] = [
  {
    id: 100, companyId: 1, reference: "JE-0001",
    entryDate: new Date("2026-04-26T12:00:00Z"),
    description: "test", source: "manual", sourceTransactionId: null,
    createdAt: new Date(),
    lines: [
      { id: 1000, companyId: 1, journalEntryId: 100, accountId: 1, debit: "1000.00", credit: "0",       description: null }, // Dr Cash
      { id: 1001, companyId: 1, journalEntryId: 100, accountId: 5, debit: "0",       credit: "1000.00", description: null }, // Cr Sales
      { id: 1002, companyId: 1, journalEntryId: 100, accountId: 6, debit: "300.00",  credit: "0",       description: null }, // Dr COGS
      { id: 1003, companyId: 1, journalEntryId: 100, accountId: 2, debit: "0",       credit: "300.00",  description: null }, // Cr Receivables (just to balance)
    ],
  },
];

// Title each generator should bake into `/Info` Title for each locale.
// Mirrors PDF_STRINGS["report.tb.title" / "report.pl.title" / "report.bs.title"].
const TITLES = {
  tb: { ar: "ميزان المراجعة",                  en: "Trial Balance",            de: "Rohbilanz",                          fr: "Balance générale" },
  pl: { ar: "قائمة الأرباح والخسائر",          en: "Profit & Loss Statement",  de: "Gewinn- und Verlustrechnung",        fr: "Compte de résultat" },
  bs: { ar: "قائمة المركز المالي",             en: "Balance Sheet",            de: "Bilanz",                             fr: "Bilan" },
} as const satisfies Record<"tb" | "pl" | "bs", Record<Locale, string>>;

const ALL_LOCALES: Locale[] = ["ar", "en", "de", "fr"];

async function pdfHeaderOk(buf: Buffer): Promise<void> {
  expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  expect(buf.length).toBeGreaterThan(500);
}

describe("generateTrialBalancePdf — locale", () => {
  for (const locale of ALL_LOCALES) {
    it(`bakes the ${locale} title into the PDF metadata`, async () => {
      const buf = await generateTrialBalancePdf(FIXTURE_ACCOUNTS, FIXTURE_JE, "USD", locale);
      await pdfHeaderOk(buf);
      expect(
        bodyContainsTitle(buf, TITLES.tb[locale]),
        `expected "${TITLES.tb[locale]}" in /Info Title for locale=${locale}`,
      ).toBe(true);
      // None of the *other* three locales' titles should leak in. This is
      // the regression we lock in: French users no longer get an Arabic
      // (or English) title by accident.
      for (const other of ALL_LOCALES) {
        if (other === locale) continue;
        expect(
          bodyContainsTitle(buf, TITLES.tb[other]),
          `did not expect "${TITLES.tb[other]}" in locale=${locale} PDF`,
        ).toBe(false);
      }
    });
  }

  it("defaults to Arabic when no locale is supplied", async () => {
    const buf = await generateTrialBalancePdf(FIXTURE_ACCOUNTS, FIXTURE_JE, "USD");
    await pdfHeaderOk(buf);
    expect(bodyContainsTitle(buf, TITLES.tb.ar)).toBe(true);
  });
});

describe("generateProfitLossPdf — locale", () => {
  for (const locale of ALL_LOCALES) {
    it(`bakes the ${locale} title into the PDF metadata`, async () => {
      const buf = await generateProfitLossPdf(FIXTURE_ACCOUNTS, FIXTURE_JE, "USD", locale);
      await pdfHeaderOk(buf);
      expect(
        bodyContainsTitle(buf, TITLES.pl[locale]),
        `expected "${TITLES.pl[locale]}" in /Info Title for locale=${locale}`,
      ).toBe(true);
      for (const other of ALL_LOCALES) {
        if (other === locale) continue;
        expect(
          bodyContainsTitle(buf, TITLES.pl[other]),
          `did not expect "${TITLES.pl[other]}" in locale=${locale} PDF`,
        ).toBe(false);
      }
    });
  }

  it("defaults to Arabic when no locale is supplied", async () => {
    const buf = await generateProfitLossPdf(FIXTURE_ACCOUNTS, FIXTURE_JE, "USD");
    await pdfHeaderOk(buf);
    expect(bodyContainsTitle(buf, TITLES.pl.ar)).toBe(true);
  });
});

describe("generateBalanceSheetPdf — locale", () => {
  for (const locale of ALL_LOCALES) {
    it(`bakes the ${locale} title into the PDF metadata`, async () => {
      const buf = await generateBalanceSheetPdf(FIXTURE_ACCOUNTS, FIXTURE_JE, "USD", locale);
      await pdfHeaderOk(buf);
      expect(
        bodyContainsTitle(buf, TITLES.bs[locale]),
        `expected "${TITLES.bs[locale]}" in /Info Title for locale=${locale}`,
      ).toBe(true);
      for (const other of ALL_LOCALES) {
        if (other === locale) continue;
        expect(
          bodyContainsTitle(buf, TITLES.bs[other]),
          `did not expect "${TITLES.bs[other]}" in locale=${locale} PDF`,
        ).toBe(false);
      }
    });
  }

  it("defaults to Arabic when no locale is supplied", async () => {
    const buf = await generateBalanceSheetPdf(FIXTURE_ACCOUNTS, FIXTURE_JE, "USD");
    await pdfHeaderOk(buf);
    expect(bodyContainsTitle(buf, TITLES.bs.ar)).toBe(true);
  });
});
