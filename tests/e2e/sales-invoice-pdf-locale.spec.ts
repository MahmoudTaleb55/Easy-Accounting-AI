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
 * pdfkit serializes the `/Info` Title in one of two ways:
 *
 *  - Pure ASCII: parenthesised literal, e.g. `/Title (Sales Invoice 1001)`.
 *  - Anything else (including French diacritics, Arabic, …): a UTF-16BE
 *    hex string with a leading FEFF BOM, e.g.
 *    `/Title <FEFF00460061…>`.
 *
 * For the test we look for whichever form is appropriate.
 */
function utf16BeHex(s: string): string {
  let hex = "feff"; // BOM
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xffff) {
      hex += cp.toString(16).padStart(4, "0");
    } else {
      // Surrogate pair — unlikely for our titles but covered for completeness.
      const v = cp - 0x10000;
      const hi = 0xd800 + (v >> 10);
      const lo = 0xdc00 + (v & 0x3ff);
      hex += hi.toString(16).padStart(4, "0") + lo.toString(16).padStart(4, "0");
    }
  }
  return hex;
}

function bodyContainsTitle(buf: Buffer, expectedTitle: string): boolean {
  const ascii = buf.toString("latin1");
  if (ascii.includes(`(${expectedTitle}`)) return true;
  // Hex strings in PDF can be upper- or lower-case; pdfkit emits lowercase.
  const hex = utf16BeHex(expectedTitle);
  return ascii.toLowerCase().includes(`<${hex}`);
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
