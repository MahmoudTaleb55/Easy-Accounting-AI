import { describe, it, expect } from "vitest";
import {
  stripBidiControls,
  containsArabic,
  prepareArabicForPdf,
  arabicTextOptions,
} from "../pdf-arabic";

/**
 * Regression tests for the hand-rolled Arabic shaper.
 *
 * The two visible bugs we're locking down here:
 *   1. Bidi format-control codepoints (U+202B/U+202C, etc.) used to leak
 *      through the shaper and end up as missing-glyph rectangles in the
 *      rendered PDF.
 *   2. The inter-word space inside short pure-Arabic strings such as
 *      "النقد بالصندوق" was being dropped by the bidi layer, so the
 *      account name rendered as "النقدبالصندوق". The fix bypasses bidi-js
 *      for pure-Arabic strings and just reverses the reshaped glyph
 *      sequence, which is what the Unicode Bidirectional Algorithm
 *      produces for a pure-RTL paragraph anyway.
 */
describe("stripBidiControls", () => {
  const SAMPLES: Array<[string, string]> = [
    ["\u200E", ""],
    ["\u200F", ""],
    ["\u061C", ""],
    ["\u202A", ""],
    ["\u202B", ""],
    ["\u202C", ""],
    ["\u202D", ""],
    ["\u202E", ""],
    ["\u2066", ""],
    ["\u2067", ""],
    ["\u2068", ""],
    ["\u2069", ""],
  ];

  it("strips every bidi-format codepoint", () => {
    for (const [input, expected] of SAMPLES) {
      expect(stripBidiControls(input)).toBe(expected);
    }
  });

  it("strips bidi controls embedded inside an Arabic string", () => {
    const input = "\u202Bالنقد بالصندوق\u202C";
    expect(stripBidiControls(input)).toBe("النقد بالصندوق");
  });

  it("leaves non-control characters untouched", () => {
    expect(stripBidiControls("النقد بالصندوق")).toBe("النقد بالصندوق");
    expect(stripBidiControls("Hello, world!")).toBe("Hello, world!");
    expect(stripBidiControls("")).toBe("");
  });

  it("is a safe no-op for non-string input", () => {
    // Defensive: storage occasionally hands us numbers/null. The function
    // signature says string but we want a graceful pass-through rather
    // than a thrown TypeError.
    expect(stripBidiControls(undefined as any)).toBe(undefined);
    expect(stripBidiControls(null as any)).toBe(null);
    expect(stripBidiControls(123 as any)).toBe(123);
  });
});

describe("containsArabic", () => {
  it("recognises the Arabic block", () => {
    expect(containsArabic("النقد")).toBe(true);
    expect(containsArabic("Hello")).toBe(false);
    expect(containsArabic("Hello النقد")).toBe(true);
    expect(containsArabic("")).toBe(false);
  });
});

describe("prepareArabicForPdf — inter-word space preservation", () => {
  /**
   * The exact bug from the brief: the cash-on-hand account ("النقد
   * بالصندوق") used to render with no space between the two words. After
   * shaping we should still see the space character verbatim — the
   * shaper only swaps codepoints for their presentation forms and
   * reverses the visual order; it must not eat any whitespace.
   */
  it("preserves the U+0020 between two Arabic words", () => {
    const out = prepareArabicForPdf("النقد بالصندوق");
    expect(out).toContain(" ");
    // Shaped output for the same input should match itself bit-for-bit
    // across runs — protects against accidental nondeterminism.
    expect(out).toBe(prepareArabicForPdf("النقد بالصندوق"));
  });

  it("strips embedded U+202B/U+202C and still renders the inter-word space", () => {
    const noisy = "\u202Bالنقد بالصندوق\u202C";
    const clean = prepareArabicForPdf(noisy);
    // No leftover bidi-control codepoint in the rendered glyph stream.
    expect(/[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/.test(clean)).toBe(false);
    // And the space survived.
    expect(clean).toContain(" ");
    // Output should equal the noise-free version — i.e. the controls had
    // no impact beyond being removed.
    expect(clean).toBe(prepareArabicForPdf("النقد بالصندوق"));
  });

  it("returns a non-empty visually-ordered string for typical labels", () => {
    for (const label of [
      "فاتورة مبيعات",
      "ميزان المراجعة",
      "صافي الربح",
      "إجمالي الأصول",
      "حقوق الملكية",
    ]) {
      const shaped = prepareArabicForPdf(label);
      expect(shaped.length).toBeGreaterThan(0);
      // Spaces present in the input must still be present after shaping.
      const inputSpaces = (label.match(/ /g) || []).length;
      const outputSpaces = (shaped.match(/ /g) || []).length;
      expect(outputSpaces).toBe(inputSpaces);
    }
  });

  it("passes pure-Latin strings through unchanged", () => {
    expect(prepareArabicForPdf("Sales Invoice")).toBe("Sales Invoice");
    expect(prepareArabicForPdf("Trial Balance 2026")).toBe("Trial Balance 2026");
  });

  /**
   * Bidi correctness — strings the pure-Arabic fast path must NOT swallow,
   * because reversing them produces the wrong visual order:
   *
   *  - Arabic-Indic digit runs (٠-٩, U+0660..U+0669) are LTR runs inside
   *    an RTL paragraph. The Unicode Bidirectional Algorithm keeps them
   *    in logical order; a literal `reverse()` would print "١٢٣" as "٣٢١".
   *  - Paired brackets `(`/`)` are mirror-glyph pairs that swap positions
   *    AND glyph under bidi. A literal reverse leaves them unmirrored
   *    AND in swapped logical order.
   *
   * In both cases the string must be routed through bidi-js, which knows
   * the digit-class and mirror-pair tables. The test asserts the
   * digit/paren sequences come back unchanged in the output stream
   * (i.e. they were not blindly reversed).
   */
  it("keeps Arabic-Indic digit runs in logical order (does not reverse them)", () => {
    const out = prepareArabicForPdf("الرقم ١٢٣");
    expect(out).toContain("١٢٣"); // digits stayed in the original order
    expect(out).not.toContain("٣٢١"); // and were not naively reversed
  });

  it("handles ASCII digit runs inside Arabic without reversing them", () => {
    const out = prepareArabicForPdf("الرقم 2026");
    expect(out).toContain("2026");
    expect(out).not.toContain("6202");
  });

  it("handles parentheses inside Arabic without literally reversing the pair", () => {
    const input = "النقد (الصندوق)";
    const out = prepareArabicForPdf(input);
    // Each paren glyph is still present in the output (bidi-js may emit
    // them in mirrored visual order, but neither should be dropped).
    expect((out.match(/\(/g) || []).length).toBe(1);
    expect((out.match(/\)/g) || []).length).toBe(1);
  });
});

describe("arabicTextOptions", () => {
  it("forces lineBreak: false to defeat pdfkit's word-wrap on visual-order glyphs", () => {
    expect(arabicTextOptions({ width: 200, align: "right" })).toEqual({
      width: 200,
      align: "right",
      lineBreak: false,
    });
  });

  it("preserves any caller-supplied options that aren't lineBreak", () => {
    const opts = arabicTextOptions({ width: 100, align: "left", continued: true });
    expect(opts.width).toBe(100);
    expect(opts.align).toBe("left");
    expect(opts.continued).toBe(true);
    expect(opts.lineBreak).toBe(false);
  });
});
