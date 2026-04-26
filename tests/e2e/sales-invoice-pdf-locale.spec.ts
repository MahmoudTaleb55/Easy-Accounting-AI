import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import pg from "pg";
import { forgeSession, requireDbUrl } from "./_helpers/forge-session";

/**
 * Locale-aware sales-invoice PDF.
 *
 * `GET /api/sales/invoices/:id/pdf?lang=<ar|en|de|fr>` must:
 *   1. Always return a 200 with `Content-Type: application/pdf` and a real
 *      `%PDF` header.
 *   2. Bake the localized title (`fr → "Facture de vente"`,
 *      `de → "Verkaufsrechnung"`, `en → "Sales Invoice"`,
 *      `ar → "فاتورة مبيعات"`) into the document's `/Info` Title metadata.
 *      pdfkit writes Latin metadata as a parenthesised PDF string and
 *      Arabic metadata as a UTF-16BE hex string with a BOM, so each
 *      locale's expected bytes are recognisably present in the binary.
 *   3. Never leak Arabic text into a non-Arabic PDF (the bug we are
 *      fixing — historically `?lang=fr` still rendered Arabic glyphs).
 *
 * The test reuses the signup pattern from `sales-portal.spec.ts` so it
 * matches the project's existing auth conventions and doesn't need a
 * fixture user.
 */

const PASSWORD = "Sup3rS3cret!42";
const BASE_URL = `http://127.0.0.1:${process.env.PORT || "5000"}`;

interface Owner {
  userId: string;
  companyId: number;
  context: BrowserContext;
  request: APIRequestContext;
}

async function signupOwner(browser: Browser, label: string): Promise<Owner> {
  const dbUrl = requireDbUrl(`pdf-locale ${label} spec`);
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `pdfloc-${label}-${stamp}@example.test`;
  const firstName = "Pdf";
  const lastName = label;

  const context = await browser.newContext();
  const page = await context.newPage();

  const forwardedFor = `10.${Math.floor(Math.random() * 256)}.${Math.floor(
    Math.random() * 256,
  )}.${Math.floor(Math.random() * 200) + 1}`;

  const res = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-proto": "https",
      "x-forwarded-for": forwardedFor,
    },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      firstName,
      lastName,
      preferredLocale: "en",
    }),
  });
  expect(
    res.status,
    `POST /api/auth/signup must succeed for ${label}, got ${res.status}: ${await res.text()}`,
  ).toBe(201);

  const seed = new pg.Client({ connectionString: dbUrl });
  await seed.connect();
  let userId: string;
  let companyId: number;
  try {
    const userRow = (
      await seed.query(`SELECT id FROM users WHERE email=$1 LIMIT 1`, [email])
    ).rows[0];
    expect(userRow).toBeTruthy();
    userId = userRow.id as string;
    const compRow = (
      await seed.query(
        `SELECT company_id FROM memberships
         WHERE user_id=$1 AND role='owner'
         ORDER BY created_at ASC LIMIT 1`,
        [userId],
      )
    ).rows[0];
    expect(compRow).toBeTruthy();
    companyId = Number(compRow.company_id);
  } finally {
    await seed.end();
  }

  await forgeSession({ page, dbUrl, userId, email, firstName, lastName });
  return { userId, companyId, context, request: context.request };
}

function hdrs(companyId: number): Record<string, string> {
  return { "X-Company-Id": String(companyId) };
}

/**
 * pdfkit serializes string entries (including the `/Info` Title that
 * lives in its own indirect object) one of two ways:
 *
 *  - Pure ASCII: parenthesised literal, e.g. `(Sales Invoice INV-0001)`.
 *  - Anything else (Arabic, German diacritics, …): also parenthesised,
 *    but the contents are raw UTF-16BE bytes with a leading FEFF byte-
 *    order mark, e.g. `(þÿ\x06A\x06'…)` when read as latin1.
 *    Any data byte that happens to equal `0x28` (`(`), `0x29` (`)`),
 *    or `0x5c` (`\`) is backslash-escaped per PDF 1.7 §7.3.4.2 so the
 *    parser can find the real string terminator. For example "ة"
 *    (U+0629) encodes to bytes `06 29`, and the `29` is written as
 *    `\)` — i.e. `06 5c 29` on the wire.
 *
 * NOTE: pdfkit does NOT emit `<FEFF…>` hex strings here — observed via
 * direct inspection of the output bytes.
 *
 * For the test we look for whichever form is appropriate. The PDF body
 * is binary, so we read it as latin1 (1-byte-per-codepoint round-trip)
 * and search byte-for-byte for the literal needle the PDF would emit.
 */
function utf16BeBytesAsLatin1(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xffff) {
      out += String.fromCharCode((cp >> 8) & 0xff, cp & 0xff);
    } else {
      // Surrogate pair — unlikely for our titles, included for completeness.
      const v = cp - 0x10000;
      const hi = 0xd800 + (v >> 10);
      const lo = 0xdc00 + (v & 0x3ff);
      out += String.fromCharCode((hi >> 8) & 0xff, hi & 0xff,
                                 (lo >> 8) & 0xff, lo & 0xff);
    }
  }
  return out;
}

/** Apply the PDF literal-string backslash escapes pdfkit applies on
 *  the raw byte stream. Unescaped `(` `)` `\` would otherwise
 *  prematurely close the literal-string token. */
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
  // Pure-ASCII parenthesised literal — pdfkit's path for Latin-only titles.
  if (ascii.includes(`(${expectedTitle}`)) return true;
  // UTF-16BE bytes inside parens, with the FEFF BOM prefix and
  // per-byte literal-string escapes for `(`, `)` and `\`.
  const rawBytes = "\xFE\xFF" + utf16BeBytesAsLatin1(expectedTitle);
  const escaped = escapePdfLiteralBytes(rawBytes);
  return ascii.includes(`(${escaped}`);
}

test.describe("sales invoice PDF — locale", () => {
  let owner: Owner;
  let invoiceId: number;

  test.beforeAll(async ({ browser }) => {
    owner = await signupOwner(browser, "owner");

    const stamp = Math.random().toString(36).slice(2, 8);
    const customerRes = await owner.request.post("/api/sales/customers", {
      headers: hdrs(owner.companyId),
      data: {
        code: `CUST-${stamp}`,
        nameAr: "عميل تجريبي",
        nameEn: "Test Customer",
        email: "pdf-loc-customer@example.test",
      },
    });
    expect(customerRes.status(), await customerRes.text()).toBe(201);
    const customer = await customerRes.json();

    const productRes = await owner.request.post("/api/sales/products", {
      headers: hdrs(owner.companyId),
      data: {
        sku: `SKU-${stamp}`,
        nameAr: "منتج تجريبي",
        nameEn: "Test Product",
        unitPrice: 100,
        unitCost: 60,
        stockQty: 50,
        isService: false,
      },
    });
    expect(productRes.status(), await productRes.text()).toBe(201);
    const product = await productRes.json();

    const invoiceRes = await owner.request.post("/api/sales/invoices", {
      headers: hdrs(owner.companyId),
      data: {
        customerId: customer.id,
        invoiceDate: new Date().toISOString().slice(0, 10),
        status: "posted",
        paymentMethod: "credit",
        notes: "locale smoke",
        lines: [
          {
            productId: product.id,
            description: "Test Product",
            quantity: 1,
            unitPrice: 100,
            vatRate: 0.15,
            unitCost: 60,
          },
        ],
      },
    });
    expect(invoiceRes.status(), await invoiceRes.text()).toBe(201);
    const invoice = await invoiceRes.json();
    invoiceId = invoice.id;
  });

  test.afterAll(async () => {
    await owner.context.close();
  });

  // The four locale → expected-title combinations the renderer must honour.
  // Title = `${t(locale, "invoice.title")} ${invoice.number}`. We only
  // assert against the leading `t(...)` portion so the test stays
  // resilient to whatever auto-numbering produces.
  const cases = [
    { lang: "ar", title: "فاتورة مبيعات",   forbidden: ["Sales Invoice", "Verkaufsrechnung", "Facture de vente"] },
    { lang: "en", title: "Sales Invoice",    forbidden: ["فاتورة مبيعات", "Verkaufsrechnung", "Facture de vente"] },
    { lang: "de", title: "Verkaufsrechnung", forbidden: ["فاتورة مبيعات", "Sales Invoice", "Facture de vente"] },
    { lang: "fr", title: "Facture de vente", forbidden: ["فاتورة مبيعات", "Sales Invoice", "Verkaufsrechnung"] },
  ] as const;

  for (const c of cases) {
    test(`?lang=${c.lang} renders the ${c.lang} title in the PDF metadata`, async () => {
      const res = await owner.request.get(
        `/api/sales/invoices/${invoiceId}/pdf?lang=${c.lang}`,
        { headers: hdrs(owner.companyId) },
      );
      expect(res.status()).toBe(200);
      const ct = res.headers()["content-type"] || "";
      expect(ct.toLowerCase()).toContain("pdf");
      const body = await res.body();
      // Real PDF magic bytes — guards against accidental HTML-error responses.
      expect(body.subarray(0, 4).toString("latin1")).toBe("%PDF");
      expect(body.length).toBeGreaterThan(500);

      // Title in the locale we asked for is present in `/Info` …
      expect(
        bodyContainsTitle(body, c.title),
        `expected "${c.title}" to appear in the PDF /Info Title for ?lang=${c.lang}`,
      ).toBe(true);
      // … and titles from the other three locales are NOT present (this is
      // the regression we're locking in: French users no longer get
      // Arabic-titled PDFs by accident).
      for (const other of c.forbidden) {
        expect(
          bodyContainsTitle(body, other),
          `did not expect "${other}" to appear in the ?lang=${c.lang} PDF`,
        ).toBe(false);
      }
    });
  }

  test("default (no ?lang=) falls back to Arabic", async () => {
    const res = await owner.request.get(
      `/api/sales/invoices/${invoiceId}/pdf`,
      { headers: hdrs(owner.companyId) },
    );
    expect(res.status()).toBe(200);
    const body = await res.body();
    expect(body.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(bodyContainsTitle(body, "فاتورة مبيعات")).toBe(true);
  });

  test("invalid ?lang= value is rejected by falling back to Arabic, not crashing", async () => {
    const res = await owner.request.get(
      `/api/sales/invoices/${invoiceId}/pdf?lang=es`,
      { headers: hdrs(owner.companyId) },
    );
    expect(res.status()).toBe(200);
    const body = await res.body();
    expect(body.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(bodyContainsTitle(body, "فاتورة مبيعات")).toBe(true);
  });
});
