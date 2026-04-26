/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Arabic-aware PDF rendering helpers for pdfkit.
 *
 * pdfkit on its own renders Arabic strings as a sequence of disconnected,
 * left-to-right glyphs because Helvetica has no Arabic coverage and the
 * shaping/bidi work is left to the caller. This module fills the two gaps:
 *
 *  1. Embeds Amiri (a free, IFRS-friendly Naskh face that ships with proper
 *     Arabic Presentation Forms-A/B coverage) so every Arabic codepoint we
 *     emit has a real glyph.
 *  2. Reshapes Unicode Arabic (U+0600 block) to its presentation forms based
 *     on each character's joining context and then runs the result through
 *     `bidi-js` to flip it to visual order. After this, pdfkit can draw the
 *     glyphs left-to-right and the user reads them right-to-left correctly.
 *
 * Numbers, currency codes, and Latin text pass through untouched, so the
 * numeric columns in Trial Balance / P&L / Balance Sheet keep aligning the
 * way an accountant expects.
 */
import path from "path";
import { fileURLToPath } from "url";
import bidiFactory from "bidi-js";

const bidi = bidiFactory();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.resolve(__dirname, "..", "assets", "fonts");

export const ARABIC_FONT = {
  regularPath: path.join(FONT_DIR, "Amiri-Regular.ttf"),
  boldPath: path.join(FONT_DIR, "Amiri-Bold.ttf"),
  regularName: "Amiri",
  boldName: "Amiri-Bold",
};

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function containsArabic(s: string): boolean {
  return typeof s === "string" && ARABIC_RE.test(s);
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Joining + presentation-form table                                        */
/*                                                                            */
/*  Each entry: [isolated, initial, medial, final].                          */
/*  Letters with only two forms (U/R class) have initial/medial = isolated.  */
/* ────────────────────────────────────────────────────────────────────────── */

type Forms = readonly [number, number, number, number]; // iso, init, med, fin

const TWO = (iso: number, fin: number): Forms => [iso, iso, iso, fin];
const FOUR = (iso: number, init: number, med: number, fin: number): Forms =>
  [iso, init, med, fin];

const FORMS: Record<number, Forms> = {
  0x0621: [0xFE80, 0xFE80, 0xFE80, 0xFE80], // hamza (non-joining)
  0x0622: TWO(0xFE81, 0xFE82), // alef madda
  0x0623: TWO(0xFE83, 0xFE84), // alef hamza above
  0x0624: TWO(0xFE85, 0xFE86), // waw hamza
  0x0625: TWO(0xFE87, 0xFE88), // alef hamza below
  0x0626: FOUR(0xFE89, 0xFE8B, 0xFE8C, 0xFE8A), // yeh hamza
  0x0627: TWO(0xFE8D, 0xFE8E), // alef
  0x0628: FOUR(0xFE8F, 0xFE91, 0xFE92, 0xFE90), // beh
  0x0629: TWO(0xFE93, 0xFE94), // teh marbuta
  0x062A: FOUR(0xFE95, 0xFE97, 0xFE98, 0xFE96), // teh
  0x062B: FOUR(0xFE99, 0xFE9B, 0xFE9C, 0xFE9A), // theh
  0x062C: FOUR(0xFE9D, 0xFE9F, 0xFEA0, 0xFE9E), // jeem
  0x062D: FOUR(0xFEA1, 0xFEA3, 0xFEA4, 0xFEA2), // hah
  0x062E: FOUR(0xFEA5, 0xFEA7, 0xFEA8, 0xFEA6), // khah
  0x062F: TWO(0xFEA9, 0xFEAA), // dal
  0x0630: TWO(0xFEAB, 0xFEAC), // thal
  0x0631: TWO(0xFEAD, 0xFEAE), // reh
  0x0632: TWO(0xFEAF, 0xFEB0), // zain
  0x0633: FOUR(0xFEB1, 0xFEB3, 0xFEB4, 0xFEB2), // seen
  0x0634: FOUR(0xFEB5, 0xFEB7, 0xFEB8, 0xFEB6), // sheen
  0x0635: FOUR(0xFEB9, 0xFEBB, 0xFEBC, 0xFEBA), // sad
  0x0636: FOUR(0xFEBD, 0xFEBF, 0xFEC0, 0xFEBE), // dad
  0x0637: FOUR(0xFEC1, 0xFEC3, 0xFEC4, 0xFEC2), // tah
  0x0638: FOUR(0xFEC5, 0xFEC7, 0xFEC8, 0xFEC6), // zah
  0x0639: FOUR(0xFEC9, 0xFECB, 0xFECC, 0xFECA), // ain
  0x063A: FOUR(0xFECD, 0xFECF, 0xFED0, 0xFECE), // ghain
  0x0640: [0x0640, 0x0640, 0x0640, 0x0640], // tatweel (joins both ways)
  0x0641: FOUR(0xFED1, 0xFED3, 0xFED4, 0xFED2), // feh
  0x0642: FOUR(0xFED5, 0xFED7, 0xFED8, 0xFED6), // qaf
  0x0643: FOUR(0xFED9, 0xFEDB, 0xFEDC, 0xFEDA), // kaf
  0x0644: FOUR(0xFEDD, 0xFEDF, 0xFEE0, 0xFEDE), // lam
  0x0645: FOUR(0xFEE1, 0xFEE3, 0xFEE4, 0xFEE2), // meem
  0x0646: FOUR(0xFEE5, 0xFEE7, 0xFEE8, 0xFEE6), // noon
  0x0647: FOUR(0xFEE9, 0xFEEB, 0xFEEC, 0xFEEA), // heh
  0x0648: TWO(0xFEED, 0xFEEE), // waw
  0x0649: TWO(0xFEEF, 0xFEF0), // alef maksura
  0x064A: FOUR(0xFEF1, 0xFEF3, 0xFEF4, 0xFEF2), // yeh
  // Common extended letters used in MENA region
  0x0671: TWO(0xFB50, 0xFB51), // alef wasla
  0x067E: FOUR(0xFB56, 0xFB58, 0xFB59, 0xFB57), // peh (Persian/Urdu)
  0x0686: FOUR(0xFB7A, 0xFB7C, 0xFB7D, 0xFB7B), // tcheh
  0x0698: TWO(0xFB8A, 0xFB8B), // jeh
  0x06A9: FOUR(0xFB8E, 0xFB90, 0xFB91, 0xFB8F), // keheh
  0x06AF: FOUR(0xFB92, 0xFB94, 0xFB95, 0xFB93), // gaf
  0x06CC: FOUR(0xFBFC, 0xFBFE, 0xFBFF, 0xFBFD), // farsi yeh
};

/** Joining type per Unicode: D=dual, R=right-only, U=non-joining, T=transparent. */
const JOINING: Record<number, "D" | "R" | "U" | "T"> = {
  0x0621: "U",
  0x0622: "R", 0x0623: "R", 0x0624: "R", 0x0625: "R", 0x0627: "R",
  0x0629: "R", 0x062F: "R", 0x0630: "R", 0x0631: "R", 0x0632: "R",
  0x0648: "R", 0x0649: "R", 0x0671: "R",
};
function joiningOf(cp: number): "D" | "R" | "U" | "T" {
  if (JOINING[cp]) return JOINING[cp];
  if (FORMS[cp]) return "D"; // every other letter we know is dual-joining
  // Diacritics / combining marks are transparent for join purposes.
  if (cp >= 0x064B && cp <= 0x065F) return "T";
  if (cp >= 0x0670 && cp <= 0x0670) return "T";
  if (cp >= 0x06D6 && cp <= 0x06ED) return "T";
  // Lam-alef ligatures we synthesise during pre-substitution behave like
  // alef itself: they accept a join from the right (the letter logically
  // before lam) but not from the left, so they're R-class.
  if (cp >= 0xFEF5 && cp <= 0xFEFC) return "R";
  return "U";
}

/** Lam-Alef ligature substitution. We do this BEFORE shaping so the
 *  resulting ligature participates in joining as a single right-joining
 *  letter — that's what makes "ال" / "لا" render as one glyph instead of
 *  two disconnected halves. The pair is detected on the original Unicode
 *  codepoints (lam = U+0644, alef variants = U+0622/0623/0625/0627) and
 *  collapsed into the corresponding Presentation Forms-B ligature
 *  (U+FEF5..U+FEFC, isolated form). The shaping pass below then promotes
 *  it to its final form (U+FEF6/F8/FA/FC) when preceded by a joining letter. */
function substituteLamAlef(cps: number[]): number[] {
  const ALEF_TO_ISO_LIG: Record<number, number> = {
    0x0622: 0xFEF5, // lam + alef madda      → ﻵ (isolated lam-alef madda)
    0x0623: 0xFEF7, // lam + alef hamza-above → ﻷ
    0x0625: 0xFEF9, // lam + alef hamza-below → ﻹ
    0x0627: 0xFEFB, // lam + plain alef       → ﻻ
  };
  const out: number[] = [];
  for (let i = 0; i < cps.length; i++) {
    const here = cps[i];
    const next = cps[i + 1];
    if (here === 0x0644 && next != null && ALEF_TO_ISO_LIG[next] != null) {
      out.push(ALEF_TO_ISO_LIG[next]);
      i++;
    } else {
      out.push(here);
    }
  }
  return out;
}

/** Map from isolated lam-alef ligature → its final form (the variant used
 *  when the lam is preceded by another joining letter, e.g. the second
 *  "ل" of "العملاء"). */
const LIG_FINAL: Record<number, number> = {
  0xFEF5: 0xFEF6,
  0xFEF7: 0xFEF8,
  0xFEF9: 0xFEFA,
  0xFEFB: 0xFEFC,
};

/** Reshape a logical-order Arabic string into Presentation Forms based on the
 *  joining context of every character. Non-Arabic chars pass through. */
function reshape(s: string): string {
  // First fold lam+alef pairs into single ligature codepoints — they're
  // treated as one R-class letter for the joining algorithm below.
  const cps = substituteLamAlef(Array.from(s, (c) => c.codePointAt(0)!));
  const out: number[] = [];

  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    // Lam-alef ligature handling: choose isolated vs final form based on
    // whether the previous letter joins forward.
    if (cp >= 0xFEF5 && cp <= 0xFEFC && (cp & 1) === 1) {
      // Odd codepoint = isolated form (FEF5/FEF7/FEF9/FEFB). Promote to its
      // even "final" sibling (FEF6/FEF8/FEFA/FEFC) when the previous
      // non-transparent letter is dual-joining.
      let prevJoins = false;
      for (let j = i - 1; j >= 0; j--) {
        const pj = joiningOf(cps[j]);
        if (pj === "T") continue;
        if (pj === "D") prevJoins = true;
        break;
      }
      out.push(prevJoins ? LIG_FINAL[cp] : cp);
      continue;
    }

    const forms = FORMS[cp];
    if (!forms) {
      out.push(cp);
      continue;
    }
    // Find the previous non-transparent char in this run, and ask whether
    // it joins forward (i.e. is dual-joining and not interrupted by a
    // non-joining gap).
    let prevJoins = false;
    for (let j = i - 1; j >= 0; j--) {
      const pj = joiningOf(cps[j]);
      if (pj === "T") continue;
      if (pj === "D") prevJoins = true;
      break;
    }
    let nextLinks = false;
    for (let j = i + 1; j < cps.length; j++) {
      const nj = joiningOf(cps[j]);
      if (nj === "T") continue;
      // The current dual-joining letter can flow into the next letter as
      // long as that letter accepts a join from its right side. Both D
      // (dual-joining) and R (right-joining — i.e. "has a connector on the
      // right side, which is the side facing the previous letter") classes
      // do; U (non-joining) does not. This is the rule that makes the
      // "ن" in "صندوق" come out medial instead of final, even though the
      // following "د" is right-only.
      nextLinks = nj === "D" || nj === "R";
      break;
    }

    const meDual = joiningOf(cp) === "D";
    let formIdx: 0 | 1 | 2 | 3;
    if (meDual && prevJoins && nextLinks)      formIdx = 2; // medial
    else if (meDual && prevJoins && !nextLinks) formIdx = 3; // final
    else if (meDual && !prevJoins && nextLinks) formIdx = 1; // initial
    else if (!meDual && prevJoins)              formIdx = 3; // R-class final
    else                                         formIdx = 0; // isolated

    out.push(forms[formIdx]);
  }

  return String.fromCodePoint(...out);
}

/** Run the Unicode Bidirectional Algorithm and return the string in *visual*
 *  order so a left-to-right PDF renderer (pdfkit) places glyphs correctly
 *  for an Arabic reader. */
function toVisualOrder(s: string): string {
  // bidi-js wants paragraphs and segments. For our short cell strings the
  // simplest path is to ask for the resolved levels then reverse RTL runs.
  const embedding = bidi.getEmbeddingLevels(s, "rtl");
  const reordered = bidi.getReorderedString(s, embedding);
  return reordered;
}

/** Public entry point: convert a logical-order Arabic-or-mixed string into
 *  the form pdfkit needs to render it correctly. */
export function prepareArabicForPdf(s: string): string {
  if (!containsArabic(s)) return s;
  const reshaped = reshape(s);
  return toVisualOrder(reshaped);
}

/** Register Amiri once on a freshly created PDFKit document. Safe to call
 *  even if the doc already has fonts registered with the same alias. */
export function registerArabicFonts(doc: any): void {
  doc.registerFont(ARABIC_FONT.regularName, ARABIC_FONT.regularPath);
  doc.registerFont(ARABIC_FONT.boldName, ARABIC_FONT.boldPath);
}

/** Choose the right font alias for a given (potentially mixed) string. We
 *  use Amiri whenever any Arabic codepoint appears so the font has full
 *  coverage; Latin glyphs in Amiri are perfectly readable too, which keeps
 *  bilingual rows looking consistent. */
export function fontFor(text: string, bold: boolean, fallbackLatin: string): string {
  if (containsArabic(text)) {
    return bold ? ARABIC_FONT.boldName : ARABIC_FONT.regularName;
  }
  return fallbackLatin;
}
