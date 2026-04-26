import { describe, it, expect } from "vitest";
import { extractedDocumentSchema } from "../schema";

/**
 * Schema-widening regression test for task #345.
 *
 * Smart Inbox now supports OCR/extraction in Arabic, English, German, and
 * French. Previously the `language` field on `extractedDocumentSchema`
 * accepted only `"ar" | "en"`. These tests pin the new accepted values and
 * the rejection of out-of-set codes so a future refactor doesn't silently
 * narrow the union back down (which would cause valid German/French
 * extractions to fail Zod parse on the server).
 */
describe("extractedDocumentSchema.language", () => {
  // Mirror the real shape in shared/schema.ts. Most fields default, so a
  // mostly-empty fixture exercises the language enum without coupling these
  // tests to unrelated extraction-field changes.
  const baseDoc = {
    vendor: "Acme",
    documentDate: "2026-04-25",
    currency: "USD",
    total: 100,
    confidence: 0.9,
  };

  for (const lang of ["ar", "en", "de", "fr", "mixed"] as const) {
    it(`accepts language="${lang}"`, () => {
      const parsed = extractedDocumentSchema.parse({
        ...baseDoc,
        language: lang,
      });
      expect(parsed.language).toBe(lang);
    });
  }

  it("defaults to en when language is omitted", () => {
    const parsed = extractedDocumentSchema.parse(baseDoc);
    expect(parsed.language).toBe("en");
  });

  it("rejects unsupported language codes (e.g. legacy 'unsupported' sentinel)", () => {
    // The server is responsible for converting the model's `unsupported`
    // sentinel into a thrown DocumentExtractionError BEFORE the Zod parse
    // — if it ever leaks through, the schema must reject it so we don't
    // accidentally persist a junk value.
    const result = extractedDocumentSchema.safeParse({
      ...baseDoc,
      language: "unsupported",
    });
    expect(result.success).toBe(false);
  });

  it("rejects arbitrary ISO codes (e.g. 'es', 'zh')", () => {
    for (const lang of ["es", "zh", "it", "pt"]) {
      const result = extractedDocumentSchema.safeParse({
        ...baseDoc,
        language: lang,
      });
      expect(result.success).toBe(false);
    }
  });
});
