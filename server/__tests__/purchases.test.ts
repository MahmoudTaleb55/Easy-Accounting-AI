import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { storage } from "../storage";
import { withRlsBypass } from "../db";
import {
  createPurchaseInvoice,
  cancelPurchaseInvoice,
  createPurchasePayment,
  reversePurchasePayment,
} from "../purchases";
import { seedDefaultCoaForCompany } from "../init-coa";

/**
 * Task #368 unit-test floor for the Purchase Invoices module.
 *
 * Drives `server/purchases.ts` through `storage` directly so the test
 * focuses on the lifecycle + JE plumbing, not the auth surface.
 *
 * Coverage:
 *   1. Credit bill — draft → post: vendor balance = total, JE linked,
 *      cancel: vendor balance back to 0, JE detached and deleted, status='cancelled'.
 *   2. Cash bill — post: NO AP balance increment (cash settlement), JE linked,
 *      cancel: status='cancelled', JE deleted.
 *   3. Multi-bill payment — pays two bills from the same vendor in one shot,
 *      bumps each bill's paidAmount, links a single Dr AP / Cr Cash JE,
 *      then reverse: paidAmount drops back to 0 on both bills.
 */

const TAG = `t368_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

let pgc: pg.Client;
let companyId: number;
let vendorId: number;

beforeAll(async () => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for this test");
  pgc = new pg.Client({ connectionString: dbUrl });
  await pgc.connect();
  await pgc.query(`SET app.rls_bypass = 'on'`);

  const co = await pgc.query<{ id: number }>(
    `INSERT INTO companies (name, functional_currency, currency_symbol, is_default, is_active)
     VALUES ($1, 'SAR', 'ر.س', false, true)
     RETURNING id`,
    [`Task368 Co ${TAG}`],
  );
  companyId = co.rows[0].id;

  // Seed the IFRS CoA for this workspace so the AP / Cash / Inventory /
  // Input-VAT account codes referenced by the JE builder all exist.
  // `initIfrsChartOfAccounts` also touches the settings row (vatRate, etc.)
  // and `storage.getSettings` auto-creates one on first read, so no extra
  // settings INSERT is needed.
  await withRlsBypass("test:purchases-seed-coa", () =>
    seedDefaultCoaForCompany(companyId),
  );
  // Bump VAT rate to 15% so the credit-bill assertion (200 sub + 30 VAT) holds.
  await pgc.query(
    `UPDATE settings SET vat_rate = 0.15 WHERE company_id = $1`,
    [companyId],
  );

  const vendor = await withRlsBypass("test:purchases-bootstrap", () =>
    storage.createVendor(companyId, {
      code: `VEND-${TAG}`,
      nameAr: "مورد اختبار",
      nameEn: "Test Vendor",
      taxNumber: "",
      phone: "",
      email: "",
      address: "",
      notes: "",
      isActive: true,
    }),
  );
  vendorId = vendor.id;
});

afterAll(async () => {
  if (pgc) await pgc.end();
});

describe("purchases lifecycle", () => {
  it("posts and cancels a credit bill, swinging AP balance round-trip", async () => {
   await withRlsBypass("test:purchases-credit-bill", async () => {
    const bill = await createPurchaseInvoice(companyId, {
      vendorId,
      invoiceDate: new Date().toISOString().slice(0, 10),
      dueDate: null,
      status: "posted",
      paymentMethod: "credit",
      vendorReference: `REF-${TAG}-1`,
      notes: "",
      locationId: null,
      lines: [
        {
          productId: null,
          description: "Office supplies",
          quantity: 2,
          unitCost: 100,
          vatRate: 0.15,
          expenseAccountCode: "5100", // operating expense
        },
      ],
    });

    expect(bill.status).toBe("posted");
    expect(bill.journalEntryId).toBeGreaterThan(0);
    expect(Number(bill.subtotal)).toBeCloseTo(200, 2);
    expect(Number(bill.vatAmount)).toBeCloseTo(30, 2);
    expect(Number(bill.totalAmount)).toBeCloseTo(230, 2);

    const balAfterPost = await storage.getVendorBalance(companyId, vendorId);
    expect(balAfterPost).toBeCloseTo(230, 2);

    const cancelled = await cancelPurchaseInvoice(companyId, bill.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.journalEntryId).toBeNull();

    const balAfterCancel = await storage.getVendorBalance(companyId, vendorId);
    expect(balAfterCancel).toBeCloseTo(0, 2);
   });
  });

  it("posts and cancels a cash bill without leaving an AP balance", async () => {
   await withRlsBypass("test:purchases-cash-bill", async () => {
    const bill = await createPurchaseInvoice(companyId, {
      vendorId,
      invoiceDate: new Date().toISOString().slice(0, 10),
      dueDate: null,
      status: "posted",
      paymentMethod: "cash",
      vendorReference: `REF-${TAG}-2`,
      notes: "",
      locationId: null,
      lines: [
        {
          productId: null,
          description: "Petty cash purchase",
          quantity: 1,
          unitCost: 50,
          vatRate: 0,
          expenseAccountCode: "5100",
        },
      ],
    });

    expect(bill.status).toBe("posted");
    expect(bill.journalEntryId).toBeGreaterThan(0);
    expect(Number(bill.totalAmount)).toBeCloseTo(50, 2);

    // Cash bills must NOT bump the AP balance — payment is settled in
    // the same JE (Dr Expense / Cr Cash).
    const bal = await storage.getVendorBalance(companyId, vendorId);
    expect(bal).toBeCloseTo(0, 2);

    const cancelled = await cancelPurchaseInvoice(companyId, bill.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.journalEntryId).toBeNull();
   });
  });

  it("settles two bills with one multi-bill payment, then reverses cleanly", async () => {
   await withRlsBypass("test:purchases-multi-bill-payment", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const billA = await createPurchaseInvoice(companyId, {
      vendorId,
      invoiceDate: today,
      dueDate: null,
      status: "posted",
      paymentMethod: "credit",
      vendorReference: `REF-${TAG}-A`,
      notes: "",
      locationId: null,
      lines: [
        {
          productId: null,
          description: "Bill A",
          quantity: 1,
          unitCost: 100,
          vatRate: 0,
          expenseAccountCode: "5100",
        },
      ],
    });
    const billB = await createPurchaseInvoice(companyId, {
      vendorId,
      invoiceDate: today,
      dueDate: null,
      status: "posted",
      paymentMethod: "credit",
      vendorReference: `REF-${TAG}-B`,
      notes: "",
      locationId: null,
      lines: [
        {
          productId: null,
          description: "Bill B",
          quantity: 1,
          unitCost: 150,
          vatRate: 0,
          expenseAccountCode: "5100",
        },
      ],
    });

    const apBefore = await storage.getVendorBalance(companyId, vendorId);
    expect(apBefore).toBeCloseTo(250, 2);

    const payment = await createPurchasePayment(companyId, {
      vendorId,
      paymentDate: today,
      notes: "multi-bill",
      allocations: [
        { invoiceId: billA.id, amount: 100 },
        { invoiceId: billB.id, amount: 150 },
      ],
    });

    expect(payment.status).toBe("posted");
    expect(payment.journalEntryId).toBeGreaterThan(0);
    expect(Number(payment.amount)).toBeCloseTo(250, 2);
    expect(payment.allocations.length).toBe(2);

    const billAAfter = await storage.getPurchaseInvoice(companyId, billA.id);
    const billBAfter = await storage.getPurchaseInvoice(companyId, billB.id);
    expect(Number(billAAfter!.paidAmount)).toBeCloseTo(100, 2);
    expect(Number(billBAfter!.paidAmount)).toBeCloseTo(150, 2);

    const apAfter = await storage.getVendorBalance(companyId, vendorId);
    expect(apAfter).toBeCloseTo(0, 2);

    await reversePurchasePayment(companyId, payment.id);

    const billAFinal = await storage.getPurchaseInvoice(companyId, billA.id);
    const billBFinal = await storage.getPurchaseInvoice(companyId, billB.id);
    expect(Number(billAFinal!.paidAmount)).toBeCloseTo(0, 2);
    expect(Number(billBFinal!.paidAmount)).toBeCloseTo(0, 2);

    const apFinal = await storage.getVendorBalance(companyId, vendorId);
    expect(apFinal).toBeCloseTo(250, 2);
   });
  });
});
