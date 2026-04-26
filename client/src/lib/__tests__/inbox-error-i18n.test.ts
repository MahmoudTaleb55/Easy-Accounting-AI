import { describe, it, expect } from "vitest";
import {
  isKnownInboxErrorCode,
  resolveInboxError,
} from "../inbox-error-i18n";

/**
 * Coverage for the Smart Inbox error i18n helper introduced in task #345.
 *
 * The helper exists to map the small, closed set of stable server-side
 * error codes (e.g. `unsupported_language`) into friendly localized copy
 * across all four supported UI languages — and to fall back gracefully
 * when the persisted `errorMessage` is free-form text from a generic
 * extraction failure.
 */
describe("isKnownInboxErrorCode", () => {
  it("recognises documented codes", () => {
    expect(isKnownInboxErrorCode("unsupported_language")).toBe(true);
  });

  it("rejects unknown / free-form strings", () => {
    expect(isKnownInboxErrorCode("network timeout")).toBe(false);
    expect(isKnownInboxErrorCode("")).toBe(false);
    expect(isKnownInboxErrorCode("UNSUPPORTED_LANGUAGE")).toBe(false);
  });
});

describe("resolveInboxError", () => {
  const locales = ["ar", "en", "de", "fr"] as const;

  describe("unsupported_language code", () => {
    for (const locale of locales) {
      it(`returns localized copy in ${locale}`, () => {
        const copy = resolveInboxError("unsupported_language", locale);
        // Title/body/hint are all populated and non-trivial.
        expect(copy.title.length).toBeGreaterThan(2);
        expect(copy.body.length).toBeGreaterThan(2);
        expect(copy.hint.length).toBeGreaterThan(2);
        // Crucially, the raw machine code never appears in user-facing copy.
        expect(copy.title).not.toContain("unsupported_language");
        expect(copy.body).not.toContain("unsupported_language");
        expect(copy.hint).not.toContain("unsupported_language");
      });
    }

    it("returns distinct copy per locale (no accidental fallback to English)", () => {
      const ar = resolveInboxError("unsupported_language", "ar");
      const en = resolveInboxError("unsupported_language", "en");
      const de = resolveInboxError("unsupported_language", "de");
      const fr = resolveInboxError("unsupported_language", "fr");
      expect(new Set([ar.title, en.title, de.title, fr.title]).size).toBe(4);
    });
  });

  describe("free-form / unknown error messages", () => {
    it("falls back to a generic localized title and shows raw text in body", () => {
      const copy = resolveInboxError("Network unreachable", "en");
      expect(copy.title).toBe("Couldn't read this document");
      expect(copy.body).toBe("Network unreachable");
      expect(copy.hint.length).toBeGreaterThan(2);
    });

    it("uses the locale's title for null/undefined/empty input", () => {
      for (const value of [null, undefined, "", "   "]) {
        const copy = resolveInboxError(value, "de");
        // Title comes from the localized fallback table.
        expect(copy.title).toMatch(/Dokument/i);
      }
    });

    it("trims whitespace before checking for known codes", () => {
      const copy = resolveInboxError("  unsupported_language  ", "fr");
      // Whitespace-padded code should still resolve to the localized copy,
      // not get treated as free-form text.
      expect(copy.title).toMatch(/non prise en charge/i);
    });
  });
});
