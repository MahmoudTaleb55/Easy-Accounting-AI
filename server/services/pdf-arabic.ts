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
// Anything that bidi-js considers "strong LTR" — Latin letters, digits in the
// ASCII range, or the basic-multilingual-plane LTR scripts we actually see in
// MENA invoices (mostly Latin product codes and Western digits).
const LATIN_RE = /[A-Za-z0-9]/;

/** Bidi formatting controls that customers' source data sometimes contains
 *  ("RLE/PDF" pairs around legacy account names, etc.). They confuse both
 *  the joining algorithm (treating them as letters) and bidi-js (forcing
 *  weird embedding levels), so we strip them before shaping. */
const BIDI_CONTROL_RE = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g;

export function stripBidiControls(s: string): string {
  return typeof s === "string" ? s.replace(BIDI_CONTROL_RE, "") : s;
}

export function containsArabic(s: string): boolean {
  return typeof s === "string" && ARABIC_RE.test(s);
}

/** True when `s` is "Arabic-only" for shaping purposes — every codepoint is
 *  either Arabic, an Arabic Presentation Form, a combining diacritic, a
 *  space, or a punctuation neutral. This is the safe fast path: such
 *  strings don't need bidi-js (whose neutral-handling has been observed to
 *  collapse the visual position of the inter-word space on short cell
 *  strings — that's the "النقدبالصندوق" bug). For these strings we just
 *  reverse the reshaped character array, which is exactly what the
 *  Unicode Bidirectional Algorithm produces for a pure-RTL paragraph. */
function isPureArabic(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    // Arabic-Indic digits ٠-٩ (U+0660..U+0669) and Eastern Arabic-Indic
    // digits ۰-۹ (U+06F0..U+06F9) are LTR runs inside an RTL paragraph —
    // the Unicode Bidirectional Algorithm keeps them in logical order.
    // A naive `reverse()` would print "١٢٣" as "٣٢١", which is wrong, so
    // we kick the string back to bidi-js.
    if (cp >= 0x0660 && cp <= 0x0669) return false;
    if (cp >= 0x06F0 && cp <= 0x06F9) return false;
    // Arabic block + extended block + presentation forms + diacritics
    // (now that the digit ranges above are excluded).
    if (cp >= 0x0600 && cp <= 0x06FF) continue;
    if (cp >= 0x0750 && cp <= 0x077F) continue;
    if (cp >= 0xFB50 && cp <= 0xFDFF) continue;
    if (cp >= 0xFE70 && cp <= 0xFEFF) continue;
    // Plain ASCII space + the few neutrals that don't get mirrored or
    // re-ordered by the bidi algorithm.
    if (cp === 0x20 || cp === 0x09 || cp === 0xA0) continue;
    if (cp === 0x060C || cp === 0x061B || cp === 0x061F) continue; // ، ؛ ؟
    if (cp === 0x002E || cp === 0x002C || cp === 0x003A) continue; // . , :
    if (cp === 0x002D || cp === 0x005F) continue;                  // - _
    // Paired/mirrored bracket characters (`(` `)` `[` `]` `{` `}` `<` `>`)
    // are mirrored AND swap positions when bidi runs over an RTL string —
    // a literal reverse would print "(نص)" as ")صن(" which is doubly
    // wrong (open/close swapped, glyph not mirrored). Fall through to
    // bidi-js which knows the mirror table.
    return false;
  }
  return true;
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
  if (typeof s !== "string" || s.length === 0) return s;
  // Source data sometimes carries embedded RLE/PDF or LRM/RLM marks (legacy
  // chart-of-accounts imports do this). They must go before shaping so the
  // joining algorithm doesn't see them as letters and the bidi pass doesn't
  // anchor weird embedding levels around them.
  const cleaned = stripBidiControls(s);
  if (!containsArabic(cleaned)) return cleaned;
  const reshaped = reshape(cleaned);
  // Pure-Arabic strings get a simple character reverse — that's exactly the
  // visual order the Unicode Bidirectional Algorithm produces for an all-RTL
  // paragraph, and it sidesteps a bidi-js neutral-handling defect that drops
  // the inter-word space on short cell strings (the "النقد بالصندوق" →
  // "النقدبالصندوق" bug). For mixed Arabic+Latin/digit strings we still
  // need the full bidi algorithm because the LTR runs need their own
  // embedding levels.
  if (isPureArabic(cleaned)) {
    return Array.from(reshaped).reverse().join("");
  }
  return toVisualOrder(reshaped);
}

/** pdfkit text() options that disable word-wrap. We pass these on every
 *  call that draws a *pre-shaped* Arabic string: the shaping pipeline
 *  already produced visual-order glyphs sized for the cell, and pdfkit's
 *  internal word wrapper would otherwise re-tokenise the visual-order
 *  output on whitespace and re-flow it as if it were logical-order LTR
 *  text — that's what eats the inter-word space on cells whose content
 *  is exactly the cell width. Callers that need real wrap (e.g. the
 *  notes paragraph at the bottom of an invoice) have to pre-wrap the
 *  *logical* text into lines and shape each line separately.  */
export function arabicTextOptions<T extends Record<string, unknown>>(opts: T): T & { lineBreak: false } {
  return { ...opts, lineBreak: false as const };
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

/* ────────────────────────────────────────────────────────────────────────── */
/*  Sales Invoice PDF                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

// Helper: format a number with 2dp using "en-US" digits (Arabic accountants
// universally use Western digits in invoice totals; the surrounding labels
// are still rendered in Arabic).
function fmtMoney(v: string | number): string {
  const n = typeof v === "string" ? Number(v) : v;
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtQty(v: string | number): string {
  const n = typeof v === "string" ? Number(v) : v;
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    maximumFractionDigits: 4,
  });
}

// Draw a single cell — same shape/bidi pipeline as the report PDFs but kept
// local to this file so the sales template stays self-contained and we don't
// pull on `assistant-files.ts` (which would create a circular dependency).
function cell(
  doc: any,
  value: string,
  x: number,
  y: number,
  width: number,
  align: "left" | "right" | "center",
  bold: boolean,
): void {
  const isArabic = containsArabic(value);
  const text = isArabic ? prepareArabicForPdf(value) : value;
  const font = fontFor(value, bold, bold ? "Helvetica-Bold" : "Helvetica");
  // For pre-shaped Arabic strings disable pdfkit's word-wrap to preserve
  // the inter-word space — see `arabicTextOptions` in this module.
  const opts = isArabic
    ? arabicTextOptions({ width, align })
    : { width, align };
  doc.font(font).text(text, x, y, opts);
}

async function streamToBuffer(doc: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/**
 * Render a sales invoice to a PDF Buffer in the requested locale.
 *
 * The whole layout flips with the locale's natural reading direction:
 *  - Arabic (RTL): customer block on the right, meta block on the left,
 *    "where the eye starts" headers right-aligned. This matches the
 *    Saudi VAT invoice convention.
 *  - English / German / French (LTR): customer block on the left, meta
 *    block on the right, headers left-aligned.
 *
 * Every label is pulled from `@/server/i18n/pdf-strings`; data values
 * (customer name, product description, notes) prefer the locale-native
 * field when available and fall back gracefully.
 */
export async function renderSalesInvoicePdf(
  companyId: number,
  invoice: any, // SalesInvoiceWithLines — typed loosely to avoid pulling
                // shared/schema into this server-side helper module.
  locale: Locale = "ar",
): Promise<Buffer> {
  // Lazy-load to avoid pulling pdfkit / storage / drizzle into the import
  // graph for callers (e.g. unit tests) that don't actually render PDFs.
  const PDFDocument = (await import("pdfkit")).default;
  const { storage } = await import("../storage");
  const { db } = await import("../db");
  const { products: productsTable } = await import("@shared/schema");
  const { eq, and, inArray } = await import("drizzle-orm");

  const settings = await storage.getSettings(companyId);
  const currency = settings.currencySymbol || settings.currencyCode || "";
  const orgName = settings.orgName || "";
  const isRtl = dirFor(locale) === "rtl";

  // Resolve product names so the line table can show "Product · description"
  // even when the user only supplied a productId. Issue a single bulk query
  // for all distinct product ids to keep the cost O(1) per invoice.
  const productIds = Array.from(
    new Set(
      (invoice.lines || [])
        .map((l: any) => l.productId)
        .filter((v: any): v is number => v != null),
    ),
  ) as number[];
  const productRows: Array<{ id: number; nameAr: string; nameEn: string | null }> =
    productIds.length === 0
      ? []
      : await db
          .select({
            id: productsTable.id,
            nameAr: productsTable.nameAr,
            nameEn: productsTable.nameEn,
          })
          .from(productsTable)
          .where(
            and(
              eq(productsTable.companyId, companyId),
              inArray(productsTable.id, productIds),
            ),
          );
  const productById = new Map(productRows.map((p) => [p.id, p]));

  const doc = new PDFDocument({
    size: "A4",
    margin: 40,
    info: {
      Title: `${t(locale, "invoice.title")} ${invoice.number}`,
      Producer: "Mohaseb",
    },
  });
  registerArabicFonts(doc);

  const pageW = doc.page.width;
  const pageM = 40;
  const innerW = pageW - pageM * 2;

  // Default cell alignment for "primary content" cells — labels, customer
  // names, etc. Numeric columns always stay right-aligned regardless of
  // direction (accountants read totals on the right in both LTR and RTL
  // ledgers).
  const startAlign: "left" | "right" = isRtl ? "right" : "left";
  const endAlign:   "left" | "right" = isRtl ? "left"  : "right";

  // -------- Header band --------
  doc.rect(pageM, pageM, innerW, 56).fill("#065F46");
  doc.fillColor("#ffffff").fontSize(18);
  cell(doc, t(locale, "invoice.title"), pageM + 12, pageM + 10, innerW - 24, startAlign, true);
  doc.fontSize(10);
  cell(
    doc,
    orgName,
    pageM + 12,
    pageM + 36,
    innerW - 24,
    // Org name follows its content's natural direction: an Arabic name
    // sits on the right whatever the active UI locale is.
    containsArabic(orgName) ? "right" : startAlign,
    false,
  );

  doc.fillColor("#111").fontSize(10).font("Helvetica");
  let y = pageM + 78;

  // -------- Customer block + Meta block --------
  // For RTL: customer card on the RIGHT (where Arabic readers' eyes start),
  //          meta card on the LEFT.
  // For LTR: customer card on the LEFT (Western convention), meta on RIGHT.
  const colW = (innerW - 16) / 2;
  const leftX = pageM;
  const rightX = pageM + colW + 16;
  const customerX = isRtl ? rightX : leftX;
  const metaX     = isRtl ? leftX  : rightX;

  // Customer card
  doc.rect(customerX, y, colW, 96).strokeColor("#E5E7EB").lineWidth(1).stroke();
  cell(doc, t(locale, "invoice.billTo"), customerX + 10, y + 8, colW - 20, startAlign, true);
  const cust = invoice.customer;
  const custName = cust
    ? pickName(locale, cust.nameAr, cust.nameEn) || `#${cust.id}`
    : "-";
  cell(doc, custName, customerX + 10, y + 28, colW - 20, startAlign, true);
  if (cust?.code) {
    cell(
      doc,
      `${t(locale, "invoice.customerCode")}: ${cust.code}`,
      customerX + 10,
      y + 46,
      colW - 20,
      startAlign,
      false,
    );
  }

  // Meta card
  doc.rect(metaX, y, colW, 96).strokeColor("#E5E7EB").lineWidth(1).stroke();
  const metaRows: Array<[string, string]> = [
    [t(locale, "invoice.number"),  invoice.number],
    [t(locale, "invoice.date"),    formatLocaleDate(locale, invoice.invoiceDate)],
    [t(locale, "invoice.due"),     invoice.dueDate ? formatLocaleDate(locale, invoice.dueDate) : "-"],
    [t(locale, "invoice.status"),  invoiceStatus(locale, invoice.status)],
    [t(locale, "invoice.payment"), paymentMethod(locale, invoice.paymentMethod)],
  ];
  metaRows.forEach(([label, value], i) => {
    const ry = y + 10 + i * 16;
    // Label sits on the "starting" side of the cell, value on the other,
    // mirroring the typical "label: value" reading flow.
    cell(doc, label, metaX + 10, ry, colW * 0.55 - 10, startAlign, false);
    cell(doc, String(value), metaX + colW * 0.55, ry, colW * 0.45 - 10, endAlign, true);
  });

  y += 96 + 16;

  // -------- Lines table --------
  // Column geometry stays the same (pdfkit is LTR-positioned), but each
  // header/cell's text alignment follows the locale direction.
  const colXs = {
    idx: leftX,
    desc: leftX + 30,
    qty: leftX + innerW - 280,
    price: leftX + innerW - 210,
    vat: leftX + innerW - 130,
    total: leftX + innerW - 70,
  };
  const colWs = {
    idx: 30,
    desc: innerW - 30 - 280,
    qty: 70,
    price: 80,
    vat: 60,
    total: 70,
  };

  // Header row
  doc.rect(leftX, y, innerW, 22).fill("#065F46");
  doc.fillColor("#ffffff").fontSize(9);
  cell(doc, "#", colXs.idx, y + 6, colWs.idx, "center", true);
  cell(doc, t(locale, "invoice.col.description"), colXs.desc,  y + 6, colWs.desc,  startAlign, true);
  cell(doc, t(locale, "invoice.col.qty"),         colXs.qty,   y + 6, colWs.qty,   "right", true);
  cell(doc, t(locale, "invoice.col.price"),       colXs.price, y + 6, colWs.price, "right", true);
  cell(doc, t(locale, "invoice.col.vat"),         colXs.vat,   y + 6, colWs.vat,   "right", true);
  cell(doc, t(locale, "invoice.col.total"),       colXs.total, y + 6, colWs.total, "right", true);
  y += 22;

  doc.fillColor("#111").fontSize(9);
  let alt = false;
  (invoice.lines || []).forEach((line: any, i: number) => {
    if (y > doc.page.height - 200) {
      doc.addPage();
      y = pageM;
    }
    if (alt) doc.rect(leftX, y, innerW, 22).fill("#F9FAFB");
    doc.fillColor("#111");
    const product = line.productId ? productById.get(line.productId) : null;
    const productName = product ? pickName(locale, product.nameAr, product.nameEn) : "";
    const desc =
      productName && line.description
        ? `${productName} — ${line.description}`
        : productName || line.description || "";
    cell(doc, String(i + 1), colXs.idx, y + 6, colWs.idx, "center", false);
    cell(doc, desc,                                    colXs.desc,  y + 6, colWs.desc,  startAlign, false);
    cell(doc, fmtQty(line.quantity),                   colXs.qty,   y + 6, colWs.qty,   "right",    false);
    cell(doc, fmtMoney(line.unitPrice),                colXs.price, y + 6, colWs.price, "right",    false);
    cell(doc, fmtMoney(line.lineVat),                  colXs.vat,   y + 6, colWs.vat,   "right",    false);
    cell(doc, fmtMoney(line.lineTotal),                colXs.total, y + 6, colWs.total, "right",    true);
    y += 22;
    alt = !alt;
  });

  // -------- Totals box --------
  // Stays anchored to the side where numbers naturally settle: in RTL
  // that's the LEFT side of the page (the visual end of an Arabic line);
  // in LTR it's the RIGHT side. Inside the box, label is on the start
  // side and the amount on the end side.
  y += 10;
  const totalsW = 260;
  const totalsX = isRtl ? leftX : leftX + innerW - totalsW;
  const totalsRows: Array<[string, string, boolean]> = [
    [t(locale, "invoice.subtotal"),  `${fmtMoney(invoice.subtotal)} ${currency}`,    false],
    [t(locale, "invoice.vatAmount"), `${fmtMoney(invoice.vatAmount)} ${currency}`,   false],
    [t(locale, "invoice.total"),     `${fmtMoney(invoice.totalAmount)} ${currency}`, true],
  ];
  totalsRows.forEach(([label, value, bold], i) => {
    const ry = y + i * 22;
    if (bold) doc.rect(totalsX, ry - 2, totalsW, 22).fill("#D1FAE5");
    doc.fillColor("#111").fontSize(bold ? 11 : 10);
    cell(doc, label, totalsX + 8,             ry + 4, totalsW * 0.55 - 8, startAlign, bold);
    cell(doc, value, totalsX + totalsW * 0.55, ry + 4, totalsW * 0.45 - 8, endAlign,   bold);
  });
  y += totalsRows.length * 22 + 16;

  // -------- Notes + JE reference --------
  if (invoice.notes && invoice.notes.trim().length > 0) {
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = pageM;
    }
    doc.fillColor("#111").fontSize(10);
    cell(doc, t(locale, "invoice.notes"), leftX, y, innerW, startAlign, true);
    y += 16;
    cell(doc, String(invoice.notes), leftX, y, innerW, startAlign, false);
    y += 24;
  }
  if (invoice.journalEntryReference) {
    doc.fillColor("#6B7280").fontSize(9);
    cell(
      doc,
      `${t(locale, "invoice.linkedJE")}: ${invoice.journalEntryReference}`,
      leftX,
      y,
      innerW,
      startAlign,
      false,
    );
  }

  return await streamToBuffer(doc);
}
