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
 * End-to-end smoke for Customer Receipt Vouchers / سند قبض.
 *
 * Mirrors `purchases-portal.spec.ts` for the AR side:
 *
 *   1. POST /api/sales/customers           → creates a customer.
 *   2. POST /api/sales/invoices (posted)   → posts two credit invoices.
 *   3. GET  /api/sales/customers/:id/balance → expects sum of opens.
 *   4. POST /api/sales/payments            → single voucher allocates both.
 *      Asserts status='posted', linked JE, ARRCV-#### number, and balance
 *      back to 0.
 *   5. DELETE /api/sales/payments/:id      → reverses; balance restored.
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
  const dbUrl = requireDbUrl(`sales-payments-portal ${label} spec`);
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `sales-pay-${label}-${stamp}@example.test`;
  const firstName = "SalesPay";
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
  expect(res.status, `signup must succeed: ${await res.text()}`).toBe(201);

  const seed = new pg.Client({ connectionString: dbUrl });
  await seed.connect();
  let userId: string;
  let companyId: number;
  try {
    const userRow = (
      await seed.query(`SELECT id FROM users WHERE email=$1 LIMIT 1`, [email])
    ).rows[0];
    userId = userRow.id as string;
    const companyRow = (
      await seed.query(
        `SELECT company_id FROM memberships
         WHERE user_id=$1 AND role='owner'
         ORDER BY created_at ASC LIMIT 1`,
        [userId],
      )
    ).rows[0];
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

function readBalance(payload: unknown): number {
  if (typeof payload === "number") return payload;
  if (typeof payload === "string") return Number(payload);
  const p = payload as Record<string, unknown>;
  return Number((p.balance ?? p.openAR ?? p.openAr ?? p.amount ?? 0) as number);
}

test.describe("sales payments — customer receipt vouchers (سند قبض)", () => {
  let owner: Owner;

  test.beforeAll(async ({ browser }) => {
    owner = await signupOwner(browser, "owner");
  });

  test.afterAll(async () => {
    await owner.context.close();
  });

  test("settles two credit invoices with one voucher, then reverses cleanly", async () => {
    const stamp = Math.random().toString(36).slice(2, 8);
    const today = new Date().toISOString().slice(0, 10);

    // (1) Customer
    const custRes = await owner.request.post("/api/sales/customers", {
      headers: hdrs(owner.companyId),
      data: {
        code: `CUST-${stamp}`,
        nameAr: "عميل اختبار",
        nameEn: "Test Customer",
        email: "test-customer@example.test",
      },
    });
    expect(custRes.status(), await custRes.text()).toBe(201);
    const customer = await custRes.json();

    // (2) Two posted credit invoices.
    const makeInvoice = async (label: string, unitPrice: number) => {
      const r = await owner.request.post("/api/sales/invoices", {
        headers: hdrs(owner.companyId),
        data: {
          customerId: customer.id,
          invoiceDate: today,
          status: "posted",
          paymentMethod: "credit",
          notes: label,
          lines: [
            {
              productId: null,
              description: label,
              quantity: 1,
              unitPrice,
              vatRate: 0,
            },
          ],
        },
      });
      expect(r.status(), `POST /api/sales/invoices: ${await r.text()}`).toBe(201);
      return await r.json();
    };
    const invA = await makeInvoice(`A-${stamp}`, 100);
    const invB = await makeInvoice(`B-${stamp}`, 150);
    expect(invA.status).toBe("posted");
    expect(invB.status).toBe("posted");

    // (3) AR balance = 250.
    const balRes = await owner.request.get(
      `/api/sales/customers/${customer.id}/balance`,
      { headers: hdrs(owner.companyId) },
    );
    expect(balRes.status()).toBe(200);
    expect(readBalance(await balRes.json())).toBeCloseTo(250, 2);

    // (4) Next-number sanity.
    const numRes = await owner.request.get("/api/sales/payments/next-number", {
      headers: hdrs(owner.companyId),
    });
    expect(numRes.status()).toBe(200);
    expect((await numRes.json()).number).toMatch(/^ARRCV-\d{4}$/);

    // (5) Multi-invoice receipt voucher.
    const payRes = await owner.request.post("/api/sales/payments", {
      headers: hdrs(owner.companyId),
      data: {
        customerId: customer.id,
        paymentDate: today,
        notes: "multi-invoice receipt",
        allocations: [
          { invoiceId: invA.id, amount: 100 },
          { invoiceId: invB.id, amount: 150 },
        ],
      },
    });
    expect(payRes.status(), `POST /api/sales/payments: ${await payRes.text()}`).toBe(201);
    const payment = await payRes.json();
    expect(payment.status).toBe("posted");
    expect(payment.journalEntryId, "receipt must link a JE").toBeGreaterThan(0);
    expect(Number(payment.amount)).toBeCloseTo(250, 2);
    expect(payment.allocations.length).toBe(2);
    expect(payment.number).toMatch(/^ARRCV-\d{4}$/);

    // (6) Balance back to 0.
    const balAfter = await owner.request.get(
      `/api/sales/customers/${customer.id}/balance`,
      { headers: hdrs(owner.companyId) },
    );
    expect(readBalance(await balAfter.json())).toBeCloseTo(0, 2);

    // (7) Reverse → balance back to 250.
    const delRes = await owner.request.delete(
      `/api/sales/payments/${payment.id}`,
      { headers: hdrs(owner.companyId) },
    );
    expect(delRes.status()).toBe(204);
    const balFinal = await owner.request.get(
      `/api/sales/customers/${customer.id}/balance`,
      { headers: hdrs(owner.companyId) },
    );
    expect(readBalance(await balFinal.json())).toBeCloseTo(250, 2);
  });
});
