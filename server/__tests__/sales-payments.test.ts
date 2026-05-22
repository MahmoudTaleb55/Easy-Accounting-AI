import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { storage } from "../storage";
import { withRlsBypass } from "../db";
import {
  createSalesInvoice,
  postSalesInvoice,
  createSalesPayment,
  reverseSalesPayment,
} from "../sales";
import { seedDefaultCoaForCompany } from "../init-coa";

/**
 * Customer Receipt Voucher (سند قبض) lifecycle.
 *
 * Mirrors `server/__tests__/purchases.test.ts` end-to-end:
 * pays two posted credit invoices for one customer with a single
 * voucher, asserts paidAmount + AR balance + JE link, then reverses
 * and asserts everything swings back.
 */

const TAG = `arrcv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

let pgc: pg.Client;
let companyId: number;
let customerId: number;

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
    [`SalesPay Co ${TAG}`],
  );
  companyId = co.rows[0].id;

  await withRlsBypass("test:sales-payments-seed-coa", () =>
    seedDefaultCoaForCompany(companyId),
  );

  const customer = await withRlsBypass("test:sales-payments-bootstrap", () =>
    storage.createCustomer(companyId, {
      code: `CUST-${TAG}`,
      nameAr: "عميل اختبار",
      nameEn: "Test Customer",
      taxNumber: "",
      phone: "",
      email: "",
      address: "",
      notes: "",
      isActive: true,
    }),
  );
  customerId = customer.id;
});

afterAll(async () => {
  if (pgc) await pgc.end();
});

describe("sales payments lifecycle", () => {
  it("settles two credit invoices with one receipt voucher, then reverses cleanly", async () => {
    await withRlsBypass("test:sales-payments-multi-invoice", async () => {
      const today = new Date().toISOString().slice(0, 10);

      // Create + post two credit invoices.
      const invA = await createSalesInvoice(companyId, {
        customerId,
        invoiceDate: today,
        dueDate: null,
        paymentMethod: "credit",
        notes: "",
        lines: [
          {
            productId: null,
            description: "Service A",
            quantity: 1,
            unitPrice: 100,
            vatRate: 0,
          },
        ],
      });
      await postSalesInvoice(companyId, invA.id);
      const invB = await createSalesInvoice(companyId, {
        customerId,
        invoiceDate: today,
        dueDate: null,
        paymentMethod: "credit",
        notes: "",
        lines: [
          {
            productId: null,
            description: "Service B",
            quantity: 1,
            unitPrice: 150,
            vatRate: 0,
          },
        ],
      });
      await postSalesInvoice(companyId, invB.id);

      const arBefore = await storage.getCustomerBalance(companyId, customerId);
      expect(arBefore).toBeCloseTo(250, 2);

      // Single voucher settles both.
      const receipt = await createSalesPayment(companyId, {
        customerId,
        paymentDate: today,
        notes: "multi-invoice receipt",
        allocations: [
          { invoiceId: invA.id, amount: 100 },
          { invoiceId: invB.id, amount: 150 },
        ],
      });

      expect(receipt.status).toBe("posted");
      expect(receipt.journalEntryId).toBeGreaterThan(0);
      expect(Number(receipt.amount)).toBeCloseTo(250, 2);
      expect(receipt.allocations.length).toBe(2);
      expect(receipt.number).toMatch(/^ARRCV-\d{4}$/);

      const invAAfter = await storage.getSalesInvoice(companyId, invA.id);
      const invBAfter = await storage.getSalesInvoice(companyId, invB.id);
      expect(Number(invAAfter!.paidAmount)).toBeCloseTo(100, 2);
      expect(Number(invBAfter!.paidAmount)).toBeCloseTo(150, 2);

      const arAfter = await storage.getCustomerBalance(companyId, customerId);
      expect(arAfter).toBeCloseTo(0, 2);

      // Reverse — paid amounts back to 0, AR balance back to 250.
      await reverseSalesPayment(companyId, receipt.id);

      const invAFinal = await storage.getSalesInvoice(companyId, invA.id);
      const invBFinal = await storage.getSalesInvoice(companyId, invB.id);
      expect(Number(invAFinal!.paidAmount)).toBeCloseTo(0, 2);
      expect(Number(invBFinal!.paidAmount)).toBeCloseTo(0, 2);

      const arFinal = await storage.getCustomerBalance(companyId, customerId);
      expect(arFinal).toBeCloseTo(250, 2);

      const gone = await storage.getSalesPayment(companyId, receipt.id);
      expect(gone).toBeUndefined();
    });
  });

  it("rejects a receipt that over-allocates an invoice", async () => {
    await withRlsBypass("test:sales-payments-overalloc", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const inv = await createSalesInvoice(companyId, {
        customerId,
        invoiceDate: today,
        dueDate: null,
        paymentMethod: "credit",
        notes: "",
        lines: [
          {
            productId: null,
            description: "Service C",
            quantity: 1,
            unitPrice: 50,
            vatRate: 0,
          },
        ],
      });
      await postSalesInvoice(companyId, inv.id);

      await expect(
        createSalesPayment(companyId, {
          customerId,
          paymentDate: today,
          notes: "",
          allocations: [{ invoiceId: inv.id, amount: 100 }],
        }),
      ).rejects.toThrow(/تتجاوز/);

      // No partial state — invoice paidAmount untouched.
      const after = await storage.getSalesInvoice(companyId, inv.id);
      expect(Number(after!.paidAmount)).toBeCloseTo(0, 2);
    });
  });

  it("rejects a receipt for a cash invoice", async () => {
    await withRlsBypass("test:sales-payments-cash-invoice", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const inv = await createSalesInvoice(companyId, {
        customerId,
        invoiceDate: today,
        dueDate: null,
        paymentMethod: "cash",
        notes: "",
        lines: [
          {
            productId: null,
            description: "Cash service",
            quantity: 1,
            unitPrice: 80,
            vatRate: 0,
          },
        ],
      });
      await postSalesInvoice(companyId, inv.id);

      await expect(
        createSalesPayment(companyId, {
          customerId,
          paymentDate: today,
          notes: "",
          allocations: [{ invoiceId: inv.id, amount: 80 }],
        }),
      ).rejects.toThrow(/نقد/);
    });
  });
});
