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
 * End-to-end smoke for the Sales Portal (task #301).
 *
 * Walks the full happy path through the workspace-scoped REST surface:
 *
 *   1. POST /api/sales/customers           → creates a customer.
 *   2. POST /api/sales/products            → creates a stocked good
 *      (unitPrice 100, unitCost 60, stockQty 10).
 *   3. POST /api/sales/invoices (posted)   → creates + auto-posts an
 *      invoice for qty 2. Asserts the response carries a numeric
 *      `journalEntryId`, the lines compute (subtotal 200, VAT 30,
 *      total 230, COGS 120), and the embedded customer summary is
 *      attached.
 *   4. GET /api/sales/customers/:id/balance → 230 open AR.
 *   5. GET /api/sales/products             → stockQty = 8 (10 − 2).
 *   6. GET /api/sales/invoices/:id/pdf     → 200 application/pdf.
 *   7. GET /api/audit/sales_invoice/:id    → at least one event
 *      exists for the posted invoice (the History drawer's data
 *      source).
 *   8. POST /api/sales/invoices/:id/cancel → 200, status='cancelled',
 *      customer balance back to 0, stock restored to 10.
 *   9. POST + DELETE on a fresh draft invoice → 204 (delete only
 *      allowed on draft / cancelled).
 *
 * Auth follows the same `signupOwner` pattern used by
 * `account-balances-rollup.spec.ts`: hit /api/auth/signup with a
 * spoofed forwarded-for / forwarded-proto so the rate-limiter +
 * Secure-cookie guard don't interfere, then forge a parallel passport
 * session via `_helpers/forge-session.ts` so Playwright's
 * `page.request` can call workspace-scoped routes as that owner.
 */

const PASSWORD = "Sup3rS3cret!42";
const BASE_URL = `http://127.0.0.1:${process.env.PORT || "5000"}`;

interface Owner {
  userId: string;
  companyId: number;
  email: string;
  context: BrowserContext;
  request: APIRequestContext;
}

async function signupOwner(browser: Browser, label: string): Promise<Owner> {
  const dbUrl = requireDbUrl(`sales-portal ${label} spec`);
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `sales-${label}-${stamp}@example.test`;
  const firstName = "Sales";
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
    expect(userRow, `signup must persist a users row for ${email}`).toBeTruthy();
    userId = userRow.id as string;
    const companyRow = (
      await seed.query(
        `SELECT company_id FROM memberships
         WHERE user_id=$1 AND role='owner'
         ORDER BY created_at ASC LIMIT 1`,
        [userId],
      )
    ).rows[0];
    expect(
      companyRow,
      "signup must auto-create an owner membership pointing at the bootstrapped workspace",
    ).toBeTruthy();
    companyId = Number(companyRow.company_id);
  } finally {
    await seed.end();
  }

  await forgeSession({ page, dbUrl, userId, email, firstName, lastName });
  return { userId, companyId, email, context, request: context.request };
}

function hdrs(companyId: number): Record<string, string> {
  return { "X-Company-Id": String(companyId) };
}

test.describe("sales portal — end-to-end", () => {
  let owner: Owner;

  test.beforeAll(async ({ browser }) => {
    owner = await signupOwner(browser, "owner");
  });

  test.afterAll(async () => {
    await owner.context.close();
  });

  test("posts an invoice, decrements stock, exposes balance + audit, then cancels cleanly", async () => {
    // ---- (1) Create customer ----
    const stamp = Math.random().toString(36).slice(2, 8);
    const customerCode = `CUST-${stamp}`;
    const productSku = `SKU-${stamp}`;

    const customerRes = await owner.request.post("/api/sales/customers", {
      headers: hdrs(owner.companyId),
      data: {
        code: customerCode,
        nameAr: "عميل تجريبي",
        nameEn: "Test Customer",
        email: "test-customer@example.test",
      },
    });
    expect(
      customerRes.status(),
      `POST /api/sales/customers: ${await customerRes.text()}`,
    ).toBe(201);
    const customer = await customerRes.json();
    expect(customer.id, "customer.id must be a positive integer").toBeGreaterThan(0);
    expect(customer.code).toBe(customerCode);

    // ---- (2) Create product (stocked good, unitPrice 100, unitCost 60) ----
    const productRes = await owner.request.post("/api/sales/products", {
      headers: hdrs(owner.companyId),
      data: {
        sku: productSku,
        nameAr: "منتج تجريبي",
        nameEn: "Test Product",
        unitPrice: 100,
        unitCost: 60,
        stockQty: 10,
        isService: false,
      },
    });
    expect(
      productRes.status(),
      `POST /api/sales/products: ${await productRes.text()}`,
    ).toBe(201);
    const product = await productRes.json();
    expect(product.id, "product.id must be a positive integer").toBeGreaterThan(0);
    expect(Number(product.stockQty)).toBe(10);

    // ---- (3) Create + auto-post invoice (qty 2, VAT 15%) ----
    const invoiceRes = await owner.request.post("/api/sales/invoices", {
      headers: hdrs(owner.companyId),
      data: {
        customerId: customer.id,
        invoiceDate: new Date().toISOString().slice(0, 10),
        status: "posted",
        paymentMethod: "credit",
        notes: "smoke",
        lines: [
          {
            productId: product.id,
            description: "Test Product",
            quantity: 2,
            unitPrice: 100,
            vatRate: 0.15,
            unitCost: 60,
          },
        ],
      },
    });
    expect(
      invoiceRes.status(),
      `POST /api/sales/invoices (posted): ${await invoiceRes.text()}`,
    ).toBe(201);
    const invoice = await invoiceRes.json();
    expect(invoice.status).toBe("posted");
    expect(
      invoice.journalEntryId,
      "posting an invoice must auto-create + link a JE",
    ).toBeGreaterThan(0);
    expect(Number(invoice.subtotal)).toBeCloseTo(200, 2);
    expect(Number(invoice.vatAmount)).toBeCloseTo(30, 2);
    expect(Number(invoice.totalAmount)).toBeCloseTo(230, 2);
    expect(Number(invoice.cogsAmount)).toBeCloseTo(120, 2);
    expect(Array.isArray(invoice.lines)).toBe(true);
    expect(invoice.lines.length).toBe(1);
    expect(Number(invoice.lines[0].lineTotal)).toBeCloseTo(230, 2);
    expect(invoice.customer?.id).toBe(customer.id);

    // ---- (4) Customer balance — 230 open AR (credit invoice, nothing paid) ----
    const balRes = await owner.request.get(
      `/api/sales/customers/${customer.id}/balance`,
      { headers: hdrs(owner.companyId) },
    );
    expect(balRes.status(), `GET customer balance: ${await balRes.text()}`).toBe(200);
    const bal = await balRes.json();
    // Endpoint may return a number, a stringified decimal, or an object with
    // `balance` / `openAR` — accept any of those rather than over-fitting to
    // one shape.
    const balanceValue =
      typeof bal === "number"
        ? bal
        : typeof bal === "string"
          ? Number(bal)
          : Number(bal.balance ?? bal.openAR ?? bal.openAr ?? bal.amount ?? 0);
    expect(balanceValue).toBeCloseTo(230, 2);

    // ---- (5) Stock decremented from 10 → 8 ----
    const productsAfterRes = await owner.request.get("/api/sales/products", {
      headers: hdrs(owner.companyId),
    });
    expect(productsAfterRes.status()).toBe(200);
    const productsAfter = (await productsAfterRes.json()) as Array<{
      id: number;
      stockQty: string | number;
    }>;
    const refreshed = productsAfter.find((p) => p.id === product.id);
    expect(refreshed, "product must still exist after posting").toBeTruthy();
    expect(Number(refreshed!.stockQty)).toBeCloseTo(8, 4);

    // ---- (6) PDF endpoint returns a binary PDF ----
    const pdfRes = await owner.request.get(
      `/api/sales/invoices/${invoice.id}/pdf`,
      { headers: hdrs(owner.companyId) },
    );
    expect(pdfRes.status()).toBe(200);
    const pdfCt = pdfRes.headers()["content-type"] || "";
    expect(pdfCt.toLowerCase()).toContain("pdf");
    const pdfBody = await pdfRes.body();
    expect(pdfBody.length).toBeGreaterThan(100);
    expect(pdfBody.subarray(0, 4).toString("latin1")).toBe("%PDF");

    // ---- (7) Audit log surfaces the posted invoice ----
    const auditRes = await owner.request.get(
      `/api/audit/sales_invoice/${invoice.id}`,
      { headers: hdrs(owner.companyId) },
    );
    expect(auditRes.status(), `audit lookup: ${await auditRes.text()}`).toBe(200);
    const auditEvents = (await auditRes.json()) as Array<unknown>;
    expect(Array.isArray(auditEvents)).toBe(true);
    expect(auditEvents.length).toBeGreaterThan(0);

    // ---- (8) Cancel — balance back to 0, stock restored ----
    const cancelRes = await owner.request.post(
      `/api/sales/invoices/${invoice.id}/cancel`,
      { headers: hdrs(owner.companyId) },
    );
    expect(
      cancelRes.status(),
      `cancel invoice: ${await cancelRes.text()}`,
    ).toBe(200);
    const cancelled = await cancelRes.json();
    expect(cancelled.status).toBe("cancelled");
    // Cancellation must run the reverse cascade: the per-invoice JE link is
    // cleared and the JE row itself is deleted by
    // `reverseAutoPostedJournalEntry`. Without these assertions a future
    // refactor could silently leave the JE in the GL while the business-side
    // counters (balance / stock) still pass.
    expect(
      cancelled.journalEntryId,
      "cancel must clear the invoice's JE link",
    ).toBeNull();
    const jesAfterCancel = (await (
      await owner.request.get("/api/journal-entries", {
        headers: hdrs(owner.companyId),
      })
    ).json()) as Array<{ id: number }>;
    expect(
      jesAfterCancel.find((je) => je.id === invoice.journalEntryId),
      `cancel must delete the auto-posted JE #${invoice.journalEntryId} from the GL`,
    ).toBeUndefined();

    const balAfterCancel = await owner.request.get(
      `/api/sales/customers/${customer.id}/balance`,
      { headers: hdrs(owner.companyId) },
    );
    const balAfter = await balAfterCancel.json();
    const balAfterValue =
      typeof balAfter === "number"
        ? balAfter
        : typeof balAfter === "string"
          ? Number(balAfter)
          : Number(
              balAfter.balance ?? balAfter.openAR ?? balAfter.openAr ?? balAfter.amount ?? 0,
            );
    expect(balAfterValue).toBeCloseTo(0, 2);

    const productsAfterCancelRes = await owner.request.get(
      "/api/sales/products",
      { headers: hdrs(owner.companyId) },
    );
    const productsAfterCancel = (await productsAfterCancelRes.json()) as Array<{
      id: number;
      stockQty: string | number;
    }>;
    const restored = productsAfterCancel.find((p) => p.id === product.id);
    expect(Number(restored!.stockQty)).toBeCloseTo(10, 4);
  });

  test("draft invoice can be deleted", async () => {
    // Fresh customer + product to keep this test independent of the first.
    const stamp = Math.random().toString(36).slice(2, 8);

    const customerRes = await owner.request.post("/api/sales/customers", {
      headers: hdrs(owner.companyId),
      data: {
        code: `CUST-D-${stamp}`,
        nameAr: "عميل مسودة",
        nameEn: "Draft Customer",
      },
    });
    expect(customerRes.status()).toBe(201);
    const customer = await customerRes.json();

    const productRes = await owner.request.post("/api/sales/products", {
      headers: hdrs(owner.companyId),
      data: {
        sku: `SKU-D-${stamp}`,
        nameAr: "منتج مسودة",
        unitPrice: 50,
        unitCost: 30,
        stockQty: 5,
      },
    });
    expect(productRes.status()).toBe(201);
    const product = await productRes.json();

    const draftRes = await owner.request.post("/api/sales/invoices", {
      headers: hdrs(owner.companyId),
      data: {
        customerId: customer.id,
        invoiceDate: new Date().toISOString().slice(0, 10),
        status: "draft",
        paymentMethod: "credit",
        notes: "draft to delete",
        lines: [
          {
            productId: product.id,
            description: "Draft line",
            quantity: 1,
            unitPrice: 50,
            vatRate: 0.15,
            unitCost: 30,
          },
        ],
      },
    });
    expect(
      draftRes.status(),
      `POST /api/sales/invoices (draft): ${await draftRes.text()}`,
    ).toBe(201);
    const draft = await draftRes.json();
    expect(draft.status).toBe("draft");
    expect(draft.journalEntryId, "draft must not auto-post a JE").toBeFalsy();

    // Stock should NOT have been decremented for a draft.
    const productsRes = await owner.request.get("/api/sales/products", {
      headers: hdrs(owner.companyId),
    });
    const stillFive = ((await productsRes.json()) as Array<{
      id: number;
      stockQty: string | number;
    }>).find((p) => p.id === product.id);
    expect(Number(stillFive!.stockQty)).toBeCloseTo(5, 4);

    const delRes = await owner.request.delete(
      `/api/sales/invoices/${draft.id}`,
      { headers: hdrs(owner.companyId) },
    );
    expect(
      delRes.status(),
      `DELETE draft invoice: ${await delRes.text()}`,
    ).toBe(204);

    const getRes = await owner.request.get(
      `/api/sales/invoices/${draft.id}`,
      { headers: hdrs(owner.companyId) },
    );
    expect(getRes.status()).toBe(404);
  });
});
