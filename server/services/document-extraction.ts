/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI document extraction.
 *
 * Sends a receipt/invoice (image or PDF page) to OpenAI's vision model and
 * returns a strictly-typed JSON payload describing the document, plus a
 * suggested IFRS-correct journal entry mapped onto the workspace's existing
 * chart of accounts. The model never invents account ids — it picks from
 * the candidate list we provide. If the model picks an unknown id, we drop
 * the suggestion rather than risk a bogus posting.
 */
import OpenAI from "openai";
import {
  extractedDocumentSchema,
  suggestedJournalSchema,
  type Account,
  type ExtractedDocument,
  type SuggestedJournal,
  type OrgSettings,
} from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// gpt-4o reads images natively and returns json reliably with response_format.
const MODEL = "gpt-4o";

const EXTRACTION_SYSTEM = `You are a multilingual accounting assistant that
reads receipts, invoices and credit notes for an IFRS-compliant platform.

The platform officially supports four document languages — Arabic (ar),
English (en), German (de) and French (fr) — plus bilingual receipts that
mix any two of those four (e.g. Arabic+English GCC VAT invoices, or
German+French Swiss receipts). It does NOT support documents written in
other languages (Spanish, Italian, Russian, Chinese, Hindi, Turkish,
etc.) — for those you MUST signal the special value described below.

Rules:
- Read text in any of the four supported languages. Many receipts are
  bilingual; if you see two of the supported languages on the same
  document, return "language": "mixed".
- If the dominant language of the visible text is NOT one of the four
  supported languages, return "language": "unsupported" and leave every
  other field null/zero/empty. Do not attempt to translate or guess.
- Return amounts as plain numbers (no currency symbols, no thousands
  separators). Use a dot for decimals.
- "documentDate" must be ISO YYYY-MM-DD. If only a partial date is visible,
  use the most plausible interpretation. dd/mm/yyyy is the GCC and
  European default; mm/dd/yyyy is occasionally used on US-style invoices.
- "currency" is the ISO 4217 code on the document (SAR, AED, KWD, QAR, BHD,
  OMR, EGP, JOD, USD, EUR, GBP, CHF). If missing, leave null.
- "vatRate" is a fraction (0.15 for 15%, 0.19 for 19%, 0.20 for 20%, 0.05
  for 5%). Compute it from vatAmount/subtotal if not printed. German
  invoices commonly use "MwSt." or "USt." for VAT; French invoices use
  "TVA"; Arabic invoices use "ض.ق.م." or "ضريبة القيمة المضافة".
- "category" is a short label in the document's language describing the
  spend (e.g. "Fuel", "وقود", "Kraftstoff", "Carburant", "Office supplies",
  "ضيافة", "Bürobedarf", "Fournitures de bureau").
- "documentType": receipt for cash receipts, invoice for vendor invoices
  with payment terms, credit_note for refunds, other for anything else.
- "direction" classifies whose document this is:
    "sales"    — issued BY the workspace TO a customer (we are the seller).
                 Look for the workspace's own org name in the "From"/"Seller"
                 block, or a customer name in the "To"/"Bill to" block.
    "purchase" — issued TO the workspace BY a vendor (we are the buyer).
                 Default for most receipts the user uploads.
                 If unsure, prefer "purchase".
- "counterparty" is the OTHER party on the document — the customer name when
  direction=sales, the vendor name when direction=purchase. Mirror what's
  printed; do not translate. Leave null if not legible.
- "confidence" reflects how legible and complete the data is. Be honest.
- Never fabricate. If a field is not visible, return null.
- Output ONLY valid JSON matching the requested schema, nothing else.`;

const SUGGESTION_SYSTEM = `You are an IFRS-aligned accounting reasoner.

You will be given:
1. Structured data extracted from a receipt or invoice.
2. A whitelist of postable accounts from the workspace's chart of accounts.

Your job is to suggest a balanced double-entry journal that records the
document. You MUST:

- Use only "accountId" values from the provided whitelist. Never invent ids.
- Total debits must equal total credits to the cent.
- Each line is either a debit OR a credit, never both.
- Default treatment for an expense receipt:
    Dr  Expense (best matching expense account)
    Dr  VAT Input  (if VAT > 0 and a VAT input account exists)
    Cr  Cash / Bank  (cash/card payment)  OR  Accounts Payable (credit terms)
- For sales invoices issued to a customer:
    Dr  Cash / Bank or Accounts Receivable
    Cr  Revenue
    Cr  VAT Output (if VAT > 0)
- Prefer a current-asset cash/bank account for cash/card payments. Prefer
  the Accounts Payable account for credit-term invoices.
- "reasoning" is one sentence in the user's primary language explaining the
  posting choice.

Output ONLY valid JSON matching the requested schema, nothing else.`;

const EXTRACTION_JSON_SHAPE = `{
  "vendor": string | null,
  "invoiceNumber": string | null,
  "documentDate": "YYYY-MM-DD" | null,
  "currency": string | null,
  "subtotal": number | null,
  "vatAmount": number | null,
  "vatRate": number | null,
  "total": number | null,
  "paymentMethod": "cash" | "card" | "bank" | "credit" | "unknown",
  "category": string | null,
  "documentType": "receipt" | "invoice" | "credit_note" | "other",
  "direction": "sales" | "purchase",
  "counterparty": string | null,
  "language": "ar" | "en" | "de" | "fr" | "mixed" | "unsupported",
  "lineItems": [{ "description": string, "quantity": number | null, "unitPrice": number | null, "total": number | null }],
  "confidence": number,
  "notes": string | null
}`;

const SUGGESTION_JSON_SHAPE = `{
  "description": string,
  "entryDate": "YYYY-MM-DD",
  "lines": [
    { "accountId": number, "accountCode": string, "accountName": string, "debit": number, "credit": number, "description": string }
  ],
  "reasoning": string
}`;

/**
 * Machine-readable error codes the document-extraction service can raise.
 * The route handler persists `code` into `documents.errorMessage`, and the
 * Smart Inbox UI maps it back to localized friendly copy in all four
 * supported UI languages. Keep the code list short and stable — adding a
 * new code is a cross-cutting change (server prompt + UI mapping +
 * tests). See task #345.
 */
export type ExtractionErrorCode =
  | "unsupported_language"
  // Reserved for future use — generic extraction failures still surface
  // through the catch block as plain `Error` instances.
  ;

export class DocumentExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  constructor(code: ExtractionErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "DocumentExtractionError";
  }
}

function bufferToDataUrl(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/**
 * Build the user-message content array sent to the vision model. Images
 * go in as `image_url` (the model rasterises the data URL itself); PDFs
 * go in as `file` content with the base64 bytes inline. gpt-4o reads
 * every page of an inline PDF in a single call, so multi-page invoices
 * are not silently truncated — see task #248.
 */
function buildUserContent(
  buffer: Buffer,
  mimeType: string,
): Array<Record<string, unknown>> {
  const promptText = `Extract this receipt/invoice into the following JSON shape exactly:\n${EXTRACTION_JSON_SHAPE}`;

  if (mimeType === "application/pdf") {
    return [
      {
        type: "text",
        text: `${promptText}\n\nThe attached file is a PDF. If it has multiple pages, read every page and merge the data — line items from page 2 belong on the same invoice as the totals on page 1.`,
      },
      {
        type: "file",
        file: {
          filename: "document.pdf",
          file_data: bufferToDataUrl(buffer, mimeType),
        },
      },
    ];
  }

  return [
    { type: "text", text: promptText },
    {
      type: "image_url",
      image_url: { url: bufferToDataUrl(buffer, mimeType), detail: "high" },
    },
  ];
}

/** Extract structured data from a receipt/invoice image or PDF. */
export async function extractDocument(
  buffer: Buffer,
  mimeType: string,
): Promise<ExtractedDocument> {
  if (!mimeType.startsWith("image/") && mimeType !== "application/pdf") {
    // The route's magic-bytes gate should have already rejected anything
    // other than an image or a PDF, so reaching this branch means the
    // caller passed a MIME we don't actually support — fail loud rather
    // than silently feed junk to the vision model.
    throw new Error(
      "Only image (PNG/JPEG/WEBP/GIF) and PDF uploads are supported by the extractor.",
    );
  }

  const response = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    temperature: 0,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM },
      {
        role: "user",
        // The chat-completions content array is loosely typed in the
        // OpenAI SDK because the union of supported part types varies
        // by model. We assemble the right shape per MIME above and
        // cast at the boundary.
        content: buildUserContent(buffer, mimeType) as any,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);

  // The model is instructed to return `language: "unsupported"` (a value
  // outside the schema enum) when the document isn't in one of the four
  // officially supported languages. Detect that BEFORE handing the
  // payload to Zod, so the user sees a clear "we don't speak this
  // language" message instead of a generic schema-parse failure. See
  // task #345.
  if (typeof parsed === "object" && parsed && parsed.language === "unsupported") {
    throw new DocumentExtractionError("unsupported_language");
  }

  return extractedDocumentSchema.parse(parsed);
}

/** Build a compact whitelist of postable accounts for the AI to pick from. */
function buildAccountWhitelist(accounts: Account[]) {
  return accounts
    .filter((a) => !a.isHeader && a.isActive)
    .map((a) => ({
      accountId: a.id,
      code: a.code,
      nameAr: a.nameAr,
      nameEn: a.nameEn,
      type: a.type,
      subtype: a.subtype,
    }));
}

/** Suggest a balanced journal entry for an already-extracted document. */
export async function suggestJournalForDocument(
  extracted: ExtractedDocument,
  accounts: Account[],
  settings: OrgSettings,
): Promise<SuggestedJournal | null> {
  const whitelist = buildAccountWhitelist(accounts);
  if (whitelist.length === 0) return null;

  const validIds = new Set(whitelist.map((a) => a.accountId));

  const userPayload = {
    extracted,
    workspace: {
      currencyCode: settings.currencyCode,
      currencySymbol: settings.currencySymbol,
      vatRate: Number(settings.vatRate ?? 0),
      locale: settings.locale,
    },
    accounts: whitelist,
  };

  const response = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    temperature: 0,
    messages: [
      { role: "system", content: SUGGESTION_SYSTEM },
      {
        role: "user",
        content: `Document and chart of accounts follow as JSON. Respond with a single JSON object matching this shape exactly:\n${SUGGESTION_JSON_SHAPE}\n\n${JSON.stringify(userPayload)}`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);
  const candidate = suggestedJournalSchema.safeParse(parsed);
  if (!candidate.success) return null;

  // Drop the suggestion if the model invented account ids. We refuse to
  // surface unverified posting suggestions to the user.
  for (const line of candidate.data.lines) {
    if (!validIds.has(line.accountId)) return null;
  }

  // Defensive balance check.
  const totalDebit = candidate.data.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = candidate.data.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01 || totalDebit <= 0) return null;

  return candidate.data;
}
