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
 * End-to-end smoke for the Purchases Portal (task #368).
 *
 * Mirrors `sales-portal.spec.ts` for the AP side. Walks the workspace-
 * scoped REST surface:
 *
 *   1. POST /api/purchases/vendors            → creates a vendor.
 *   2. POST /api/purchases/bills (posted)     → creates + auto-posts a
 *      credit bill (qty 2, cost 100, VAT 15% → 230 total). Asserts
 *      the response carries a numeric `journalEntryId`, embedded vendor
 *      summary, and the right totals.
 *   3. GET /api/purchases/vendors/:id/balance → 230 open AP.
 *   4. GET /api/purchases/aging?asOf=today    → vendor's bill is in the
 *      `current` bucket and totals.current ≥ 230.
 *   5. POST a second credit bill (160 total).
 *   6. POST /api/purchases/payments           → multi-bill payment paying
 *      both bills; asserts allocation count, status='posted', single JE,
 *      and vendor balance back to 0.
 *   7. DELETE /api/purchases/payments/:id     → reverses the payment;
 *      vendor balance returns to 230 + 160 = 390.
 *   8. POST /api/purchases/bills/:id/cancel   → 200, status='cancelled',
 *      JE link cleared, JE deleted from the GL.
 *   9. POST + DELETE on a fresh draft bill → 204 (delete only allowed on
 *      draft / cancelled).
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
  const dbUrl = requireDbUrl(`purchases-portal ${label} spec`);
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `purchases-${label}-${stamp}@example.test`;
  const firstName = "Purchases";
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

function readBalance(payload: unknown): number {
  if (typeof payload === "number") return payload;
  if (typeof payload === "string") return Number(payload);
  const p = payload as Record<string, unknown>;
  return Number(
    (p.balance ?? p.openAP ?? p.openAp ?? p.amount ?? 0) as number,
  );
}

test.describe("purchases portal — end-to-end", () => {
  let owner: Owner;

  test.beforeAll(async ({ browser }) => {
    owner = await signupOwner(browser, "owner");
  });

  test.afterAll(async () => {
    await owner.context.close();
  });

  test("posts a credit bill, exposes balance + aging, settles via multi-bill payment, then cancels cleanly", async () => {
    const stamp = Math.random().toString(36).slice(2, 8);
    const today = new Date().toISOString().slice(0, 10);

    // ---- (1) Create vendor ----
    const vendorRes = await owner.request.post("/api/purchases/vendors", {
      headers: hdrs(owner.companyId),
      data: {
        code: `VEND-${stamp}`,
        nameAr: "مورد تجريبي",
        nameEn: "Test Vendor",
        email: "test-vendor@example.test",
      },
    });
    expect(
      vendorRes.status(),
      `POST /api/purchases/vendors: ${await vendorRes.text()}`,
    ).toBe(201);
    const vendor = await vendorRes.json();
    expect(vendor.id, "vendor.id must be a positive integer").toBeGreaterThan(0);

    // ---- (2) Post first credit bill (qty 2 × 100 + 15% VAT = 230) ----
    const billRes = await owner.request.post("/api/purchases/bills", {
      headers: hdrs(owner.companyId),
      data: {
        vendorId: vendor.id,
        invoiceDate: today,
        status: "posted",
        paymentMethod: "credit",
        vendorReference: `INV-${stamp}-A`,
        notes: "smoke",
        lines: [
          {
            productId: null,
            description: "Test line A",
            quantity: 2,
            unitCost: 100,
            vatRate: 0.15,
            expenseAccountCode: "5100",
          },
        ],
      },
    });
    expect(
      billRes.status(),
      `POST /api/purchases/bills (posted): ${await billRes.text()}`,
    ).toBe(201);
    const bill = await billRes.json();
    expect(bill.status).toBe("posted");
    expect(
      bill.journalEntryId,
      "posting a bill must auto-create + link a JE",
    ).toBeGreaterThan(0);
    expect(Number(bill.subtotal)).toBeCloseTo(200, 2);
    expect(Number(bill.vatAmount)).toBeCloseTo(30, 2);
    expect(Number(bill.totalAmount)).toBeCloseTo(230, 2);
    expect(Array.isArray(bill.lines)).toBe(true);
    expect(bill.lines.length).toBe(1);
    expect(bill.vendor?.id).toBe(vendor.id);

    // ---- (3) Vendor balance — 230 open AP ----
    const balRes = await owner.request.get(
      `/api/purchases/vendors/${vendor.id}/balance`,
      { headers: hdrs(owner.companyId) },
    );
    expect(balRes.status(), `GET vendor balance: ${await balRes.text()}`).toBe(200);
    expect(readBalance(await balRes.json())).toBeCloseTo(230, 2);

    // ---- (4) AP aging — bill must surface in `current` bucket ----
    const agingRes = await owner.request.get(
      `/api/purchases/aging?asOf=${encodeURIComponent(today)}`,
      { headers: hdrs(owner.companyId) },
    );
    expect(agingRes.status(), `GET AP aging: ${await agingRes.text()}`).toBe(200);
    const aging = await agingRes.json();
    const billRow = (aging.rows as Array<{ invoiceId: number; bucket: string; openAmount: number }>)
      .find((r) => r.invoiceId === bill.id);
    expect(billRow, "AP aging must include the posted bill").toBeTruthy();
    expect(billRow!.bucket).toBe("current");
    expect(Number(billRow!.openAmount)).toBeCloseTo(230, 2);
    expect(Number(aging.totals.current)).toBeGreaterThanOrEqual(230);

    // ---- (5) Post a second credit bill (160 total) ----
    const billBRes = await owner.request.post("/api/purchases/bills", {
      headers: hdrs(owner.companyId),
      data: {
        vendorId: vendor.id,
        invoiceDate: today,
        status: "posted",
        paymentMethod: "credit",
        vendorReference: `INV-${stamp}-B`,
        notes: "second bill",
        lines: [
          {
            productId: null,
            description: "Test line B",
            quantity: 1,
            unitCost: 160,
            vatRate: 0,
            expenseAccountCode: "5100",
          },
        ],
      },
    });
    expect(billBRes.status()).toBe(201);
    const billB = await billBRes.json();
    expect(Number(billB.totalAmount)).toBeCloseTo(160, 2);

    // ---- (6) Multi-bill payment — settles both bills ----
    const payRes = await owner.request.post("/api/purchases/payments", {
      headers: hdrs(owner.companyId),
      data: {
        vendorId: vendor.id,
        paymentDate: today,
        notes: "multi-bill payment",
        allocations: [
          { invoiceId: bill.id, amount: 230 },
          { invoiceId: billB.id, amount: 160 },
        ],
      },
    });
    expect(
      payRes.status(),
      `POST /api/purchases/payments: ${await payRes.text()}`,
    ).toBe(201);
    const payment = await payRes.json();
    expect(payment.status).toBe("posted");
    expect(payment.journalEntryId).toBeGreaterThan(0);
    expect(Number(payment.amount)).toBeCloseTo(390, 2);
    expect(Array.isArray(payment.allocations)).toBe(true);
    expect(payment.allocations.length).toBe(2);

    // Vendor balance back to 0 after payment.
    const balAfterPayRes = await owner.request.get(
      `/api/purchases/vendors/${vendor.id}/balance`,
      { headers: hdrs(owner.companyId) },
    );
    expect(readBalance(await balAfterPayRes.json())).toBeCloseTo(0, 2);

    // ---- (7) Reverse the payment — balance back to 390 ----
    const reverseRes = await owner.request.delete(
      `/api/purchases/payments/${payment.id}`,
      { headers: hdrs(owner.companyId) },
    );
    expect(
      reverseRes.status(),
      `DELETE payment: ${await reverseRes.text()}`,
    ).toBeLessThan(300);

    const balAfterReverseRes = await owner.request.get(
      `/api/purchases/vendors/${vendor.id}/balance`,
      { headers: hdrs(owner.companyId) },
    );
    expect(readBalance(await balAfterReverseRes.json())).toBeCloseTo(390, 2);

    // ---- (8) Cancel the first bill — balance drops by 230, JE deleted ----
    const cancelRes = await owner.request.post(
      `/api/purchases/bills/${bill.id}/cancel`,
      { headers: hdrs(owner.companyId) },
    );
    expect(
      cancelRes.status(),
      `cancel bill: ${await cancelRes.text()}`,
    ).toBe(200);
    const cancelled = await cancelRes.json();
    expect(cancelled.status).toBe("cancelled");
    expect(
      cancelled.journalEntryId,
      "cancel must clear the bill's JE link",
    ).toBeNull();

    const jesAfterCancel = (await (
      await owner.request.get("/api/journal-entries", {
        headers: hdrs(owner.companyId),
      })
    ).json()) as Array<{ id: number }>;
    expect(
      jesAfterCancel.find((je) => je.id === bill.journalEntryId),
      `cancel must delete the auto-posted JE #${bill.journalEntryId} from the GL`,
    ).toBeUndefined();

    const balAfterCancelRes = await owner.request.get(
      `/api/purchases/vendors/${vendor.id}/balance`,
      { headers: hdrs(owner.companyId) },
    );
    expect(readBalance(await balAfterCancelRes.json())).toBeCloseTo(160, 2);
  });

  test("draft bill can be deleted", async () => {
    const stamp = Math.random().toString(36).slice(2, 8);
    const today = new Date().toISOString().slice(0, 10);

    const vendorRes = await owner.request.post("/api/purchases/vendors", {
      headers: hdrs(owner.companyId),
      data: {
        code: `VEND-D-${stamp}`,
        nameAr: "مورد مسودة",
        nameEn: "Draft Vendor",
      },
    });
    expect(vendorRes.status()).toBe(201);
    const vendor = await vendorRes.json();

    const draftRes = await owner.request.post("/api/purchases/bills", {
      headers: hdrs(owner.companyId),
      data: {
        vendorId: vendor.id,
        invoiceDate: today,
        status: "draft",
        paymentMethod: "credit",
        notes: "draft to delete",
        lines: [
          {
            productId: null,
            description: "Draft line",
            quantity: 1,
            unitCost: 50,
            vatRate: 0.15,
            expenseAccountCode: "5100",
          },
        ],
      },
    });
    expect(
      draftRes.status(),
      `POST /api/purchases/bills (draft): ${await draftRes.text()}`,
    ).toBe(201);
    const draft = await draftRes.json();
    expect(draft.status).toBe("draft");
    expect(draft.journalEntryId, "draft must not auto-post a JE").toBeFalsy();

    const delRes = await owner.request.delete(
      `/api/purchases/bills/${draft.id}`,
      { headers: hdrs(owner.companyId) },
    );
    expect(
      delRes.status(),
      `DELETE draft bill: ${await delRes.text()}`,
    ).toBe(204);

    const getRes = await owner.request.get(
      `/api/purchases/bills/${draft.id}`,
      { headers: hdrs(owner.companyId) },
    );
    expect(getRes.status()).toBe(404);
  });
});
