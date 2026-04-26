import { describe, it, expect } from "vitest";
import {
  PDF_LOCALES,
  isLocale,
  dirFor,
  t,
  invoiceStatus,
  paymentMethod,
  accountType,
  pickName,
  formatLocaleDate,
  type Locale,
} from "../pdf-strings";

/**
 * Exhaustive coverage tests for the PDF i18n tables. The whole point of
 * threading a locale through the PDF pipeline is that no string ever falls
 * back to "key" or "undefined" in the rendered output — these tests
 * enforce that invariant per locale.
 */

const ALL_LOCALES: Locale[] = ["ar", "en", "de", "fr"];

describe("pdf-strings: locale list", () => {
  it("exposes exactly the four supported locales", () => {
    expect([...PDF_LOCALES].sort()).toEqual([...ALL_LOCALES].sort());
  });

  it("isLocale narrows valid values and rejects others", () => {
    for (const l of ALL_LOCALES) expect(isLocale(l)).toBe(true);
    for (const bad of ["", "es", "AR", "english", null, undefined, 1, {}]) {
      expect(isLocale(bad)).toBe(false);
    }
  });

  it("dirFor returns rtl only for ar", () => {
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
    expect(dirFor("de")).toBe("ltr");
    expect(dirFor("fr")).toBe("ltr");
  });
});

describe("pdf-strings: label coverage", () => {
  // Keys we expect every PDF generator to use. Adding a new label means
  // adding it here AND in PDF_STRINGS — the test enforces the two stay
  // in sync.
  const REQUIRED_KEYS = [
    "invoice.title",
    "invoice.billTo",
    "invoice.customerCode",
    "invoice.number",
    "invoice.date",
    "invoice.due",
    "invoice.status",
    "invoice.payment",
    "invoice.col.description",
    "invoice.col.qty",
    "invoice.col.price",
    "invoice.col.vat",
    "invoice.col.total",
    "invoice.subtotal",
    "invoice.vatAmount",
    "invoice.total",
    "invoice.notes",
    "invoice.linkedJE",
    "report.asOf",
    "report.currency",
    "report.code",
    "report.account",
    "report.type",
    "report.debit",
    "report.credit",
    "report.total",
    "report.tb.title",
    "report.pl.title",
    "report.pl.revenue",
    "report.pl.expenses",
    "report.pl.totalRevenue",
    "report.pl.totalExpenses",
    "report.pl.netIncome",
    "report.bs.title",
    "report.bs.assets",
    "report.bs.liabilities",
    "report.bs.equity",
    "report.bs.totalAssets",
    "report.bs.totalLiab",
    "report.bs.totalEquity",
    "report.bs.netIncomePeriod",
    "report.bs.balanced",
    "report.bs.imbalance",
    "report.bs.diff",
  ] as const;

  it("every required key resolves to a non-empty string in every locale", () => {
    for (const key of REQUIRED_KEYS) {
      for (const locale of ALL_LOCALES) {
        const value = t(locale, key as any);
        expect(typeof value, `${key}/${locale}`).toBe("string");
        expect(value.length, `${key}/${locale} empty`).toBeGreaterThan(0);
        // Make sure no row leaked the placeholder "undefined" or
        // accidentally returned the key itself.
        expect(value, `${key}/${locale} returned the key`).not.toBe(key);
        expect(value.toLowerCase(), `${key}/${locale} undefined`).not.toBe("undefined");
      }
    }
  });

  it("invoice statuses translate in every locale", () => {
    for (const s of ["draft", "posted", "cancelled"]) {
      for (const locale of ALL_LOCALES) {
        const out = invoiceStatus(locale, s);
        expect(out).toBeTruthy();
        // The English fallback for known keys is the localized word; the
        // input key itself should never be returned for known statuses.
        if (locale !== "en") expect(out).not.toBe(s);
      }
    }
  });

  it("payment methods translate in every locale", () => {
    for (const m of ["cash", "credit", "bank"]) {
      for (const locale of ALL_LOCALES) {
        const out = paymentMethod(locale, m);
        expect(out).toBeTruthy();
        if (locale !== "en") expect(out).not.toBe(m);
      }
    }
  });

  it("account types translate in every locale", () => {
    for (const ty of ["asset", "liability", "equity", "revenue", "expense"]) {
      for (const locale of ALL_LOCALES) {
        const out = accountType(locale, ty);
        expect(out).toBeTruthy();
        if (locale !== "en") expect(out).not.toBe(ty);
      }
    }
  });

  it("unknown enum values fall back to the raw input rather than an empty string", () => {
    expect(invoiceStatus("ar", "weird-state")).toBe("weird-state");
    expect(paymentMethod("fr", "wire")).toBe("wire");
    expect(accountType("de", "alien")).toBe("alien");
  });
});

describe("pdf-strings: pickName", () => {
  it("prefers Arabic for ar, English for the rest, and falls back to the other side when missing", () => {
    expect(pickName("ar", "النقد", "Cash")).toBe("النقد");
    expect(pickName("en", "النقد", "Cash")).toBe("Cash");
    expect(pickName("de", "النقد", "Cash")).toBe("Cash");
    expect(pickName("fr", "النقد", "Cash")).toBe("Cash");

    // Missing English ⇒ fallback to Arabic so the cell isn't blank.
    expect(pickName("en", "النقد", undefined)).toBe("النقد");
    expect(pickName("fr", "النقد", null)).toBe("النقد");
    // Missing Arabic ⇒ ar still falls through to English.
    expect(pickName("ar", null, "Cash")).toBe("Cash");
    // Both missing ⇒ empty string, never undefined.
    expect(pickName("en", null, null)).toBe("");
  });
});

describe("pdf-strings: formatLocaleDate", () => {
  const sample = new Date("2026-04-26T12:00:00Z");

  it("returns a non-empty culturally-formatted string per locale", () => {
    for (const locale of ALL_LOCALES) {
      const out = formatLocaleDate(locale, sample);
      expect(out).toBeTruthy();
      // Smoke check: every formatter at least includes the year.
      expect(out).toMatch(/2026|٢٠٢٦/);
    }
  });

  it("falls back to the raw input for unparsable dates", () => {
    expect(formatLocaleDate("en", "not-a-date")).toBe("not-a-date");
  });
});
