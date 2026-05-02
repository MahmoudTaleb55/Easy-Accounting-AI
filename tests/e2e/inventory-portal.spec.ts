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
 * End-to-end smoke for the Inventory & Costing Portal (task #346).
 *
 * Walks the engine-driven happy path through the workspace-scoped REST
 * surface so a regression in any of the FIFO consumption / JE posting /
 * reversal / read-side roll-up paths trips this spec instead of leaking
 * silently into production:
 *
 *   1. POST /api/inventory/categories          → seed category.
 *   2. POST /api/inventory/locations           → first location is auto
 *      promoted to default by the storage layer (the engine reads the
 *      default for sale-side consumption).
 *   3. POST /api/sales/products                → stocked item, FIFO
 *      costing, minimumStock = 50 (high enough that any sale qty < 50
 *      triggers the low-stock alert).
 *   4. POST /api/inventory/purchases (qty 10 @ 60) → creates a purchase
 *      ITX + 1 cost layer (10 @ 60). Stock = 10, valuation = 600.
 *   5. POST /api/sales/customers + POST /api/sales/invoices (posted,
 *      qty 2) → engine consumes 2 @ 60, returns cogsAmount = 120, and
 *      the JE carries the engine-driven Dr 5100 / Cr 1300 pair.
 *   6. GET /api/inventory/alerts                → product surfaces with
 *      shortageQty 50 − 8 = 42.
 *   7. GET /api/inventory/valuation             → grandTotalValue 480
 *      (8 @ 60 remaining).
 *   8. POST /api/sales/invoices/:id/cancel      → engine reverses the
 *      sale, the COGS / Inventory legs disappear with the JE, and the
 *      cost layer is restored to 10 @ 60. Valuation back to 600.
 *
 * Auth follows the same `signupOwner` pattern as
 * `tests/e2e/sales-portal.spec.ts`: hit /api/auth/signup with a spoofed
 * forwarded-for / forwarded-proto so the rate-limiter + Secure-cookie
 * guard stay out of the way, then forge a parallel passport session via
 * `_helpers/forge-session.ts` so Playwright's `page.request` can call
 * workspace-scoped routes as that owner.
 */

const PASSWORD = "Sup3rS3cret!42";
const BASE_URL = `http://127.0.0.1:${process.env.PORT || "5000"}`;

// 5100 = COGS, 1300 = Inventory (mirrors COGS_ACCOUNT_CODE / INVENTORY_CODE
// in server/sales.ts). Hard-coding here keeps the assertion grounded in
// the chart-of-accounts contract — if either code is renamed the JE
// posting code AND this spec must move together.
const COGS_ACCOUNT_CODE = "5100";
const INVENTORY_ACCOUNT_CODE = "1300";

interface Owner {
  userId: string;
  companyId: number;
  email: string;
  context: BrowserContext;
  request: APIRequestContext;
}

async function signupOwner(browser: Browser, label: string): Promise<Owner> {
  const dbUrl = requireDbUrl(`inventory-portal ${label} spec`);
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `inv-${label}-${stamp}@example.test`;
  const firstName = "Inv";
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

interface JournalLine {
  debit: string | number;
  credit: string | number;
  account?: { code?: string | null } | null;
}
interface JournalEntry {
  id: number;
  lines: JournalLine[];
}

test.describe("inventory portal — end-to-end", () => {
  let owner: Owner;

  test.beforeAll(async ({ browser }) => {
    owner = await signupOwner(browser, "owner");
  });

  test.afterAll(async () => {
    await owner.context.close();
  });

  test(
    "purchase → sale (engine COGS in JE) → reversal restores layers; valuation + low-stock alert match engine output",
    async () => {
      const stamp = Math.random().toString(36).slice(2, 8);

      // ---- (1) Category --------------------------------------------------
      const categoryRes = await owner.request.post("/api/inventory/categories", {
        headers: hdrs(owner.companyId),
        data: { nameAr: `تصنيف-${stamp}`, nameEn: `Category-${stamp}` },
      });
      expect(
        categoryRes.status(),
        `POST /api/inventory/categories: ${await categoryRes.text()}`,
      ).toBe(201);
      const category = await categoryRes.json();
      expect(category.id, "category.id must be a positive integer").toBeGreaterThan(0);

      // ---- (2) Location (auto-promoted to default) -----------------------
      const locationRes = await owner.request.post("/api/inventory/locations", {
        headers: hdrs(owner.companyId),
        data: {
          nameAr: `مخزن-${stamp}`,
          nameEn: `Warehouse-${stamp}`,
          address: "Main hall",
        },
      });
      expect(
        locationRes.status(),
        `POST /api/inventory/locations: ${await locationRes.text()}`,
      ).toBe(201);
      const location = await locationRes.json();
      expect(location.id, "location.id must be a positive integer").toBeGreaterThan(0);
      // The first location in a workspace must be promoted to default so the
      // sale-side consumeStock helper has a location to draw from.
      expect(
        location.isDefault,
        "first inventory location must be auto-promoted to default",
      ).toBe(true);

      // ---- (3) Stocked product (FIFO, low minimum so the alert lights) ---
      const productSku = `INV-SKU-${stamp}`;
      const productRes = await owner.request.post("/api/sales/products", {
        headers: hdrs(owner.companyId),
        data: {
          sku: productSku,
          nameAr: `صنف-${stamp}`,
          nameEn: `Item ${stamp}`,
          unitPrice: 100,
          unitCost: 60,
          // Pre-purchase stockQty stays at 0 — we exercise the engine path,
          // not the legacy stockQty seed.
          stockQty: 0,
          isService: false,
          unit: "pcs",
          minimumStock: 50,
          categoryId: category.id,
          // Pin FIFO on the item itself so the assertion isn't sensitive to
          // settings.defaultCostingMethod (which defaults to 'avg' on a
          // freshly-bootstrapped workspace).
          costingMethod: "fifo",
        },
      });
      expect(
        productRes.status(),
        `POST /api/sales/products: ${await productRes.text()}`,
      ).toBe(201);
      const product = await productRes.json();
      expect(product.id, "product.id must be a positive integer").toBeGreaterThan(0);
      expect(product.costingMethod).toBe("fifo");
      expect(Number(product.minimumStock)).toBe(50);

      // ---- (4) Purchase 10 @ 60 -----------------------------------------
      const purchaseRes = await owner.request.post("/api/inventory/purchases", {
        headers: hdrs(owner.companyId),
        data: {
          txnDate: new Date().toISOString().slice(0, 10),
          locationId: location.id,
          paymentMethod: "credit",
          vendorName: "Acme Wholesale",
          reference: `PO-${stamp}`,
          lines: [
            {
              productId: product.id,
              description: "opening stock",
              quantity: 10,
              unitCost: 60,
            },
          ],
        },
      });
      expect(
        purchaseRes.status(),
        `POST /api/inventory/purchases: ${await purchaseRes.text()}`,
      ).toBe(201);
      const purchase = await purchaseRes.json();
      expect(purchase.id, "purchase.id must be a positive integer").toBeGreaterThan(0);

      // Stock level + valuation reflect the inbound layer.
      const stockAfterPurchase = (await (
        await owner.request.get("/api/inventory/stock-levels", {
          headers: hdrs(owner.companyId),
        })
      ).json()) as Array<{ productId: number; locationId: number; qty: string }>;
      const lvlAfterPurchase = stockAfterPurchase.find(
        (r) => r.productId === product.id && r.locationId === location.id,
      );
      expect(
        lvlAfterPurchase,
        "purchase must create a stock-level row at the destination location",
      ).toBeTruthy();
      expect(Number(lvlAfterPurchase!.qty)).toBeCloseTo(10, 4);

      const valuationAfterPurchase = await (
        await owner.request.get("/api/inventory/valuation", {
          headers: hdrs(owner.companyId),
        })
      ).json();
      expect(Number(valuationAfterPurchase.grandTotalValue)).toBeCloseTo(600, 2);
      const valRowAfterPurchase = (
        valuationAfterPurchase.rows as Array<{ productId: number; totalValue: string }>
      ).find((r) => r.productId === product.id);
      expect(valRowAfterPurchase, "valuation must include the purchased item").toBeTruthy();
      expect(Number(valRowAfterPurchase!.totalValue)).toBeCloseTo(600, 2);

      // ---- (5) Customer + posted sales invoice (qty 2) ------------------
      const customerRes = await owner.request.post("/api/sales/customers", {
        headers: hdrs(owner.companyId),
        data: {
          code: `CUST-${stamp}`,
          nameAr: "عميل المخزون",
          nameEn: "Inventory Customer",
        },
      });
      expect(
        customerRes.status(),
        `POST /api/sales/customers: ${await customerRes.text()}`,
      ).toBe(201);
      const customer = await customerRes.json();

      const invoiceRes = await owner.request.post("/api/sales/invoices", {
        headers: hdrs(owner.companyId),
        data: {
          customerId: customer.id,
          invoiceDate: new Date().toISOString().slice(0, 10),
          status: "posted",
          paymentMethod: "credit",
          notes: "inventory portal smoke",
          lines: [
            {
              productId: product.id,
              description: "Item ship-out",
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
      // Engine-driven COGS = 2 layers consumed @ 60 = 120.
      expect(Number(invoice.cogsAmount)).toBeCloseTo(120, 2);

      // ---- (5a) JE carries the engine-driven Dr COGS / Cr Inventory pair -
      const journalEntries = (await (
        await owner.request.get("/api/journal-entries", {
          headers: hdrs(owner.companyId),
        })
      ).json()) as JournalEntry[];
      const invoiceJe = journalEntries.find((j) => j.id === invoice.journalEntryId);
      expect(
        invoiceJe,
        `posted-invoice JE #${invoice.journalEntryId} must be present in /api/journal-entries`,
      ).toBeTruthy();

      const cogsLine = invoiceJe!.lines.find(
        (l) => l.account?.code === COGS_ACCOUNT_CODE,
      );
      const inventoryLine = invoiceJe!.lines.find(
        (l) => l.account?.code === INVENTORY_ACCOUNT_CODE,
      );
      expect(
        cogsLine,
        `JE must carry an engine-driven COGS leg on account ${COGS_ACCOUNT_CODE}`,
      ).toBeTruthy();
      expect(
        inventoryLine,
        `JE must carry an engine-driven Inventory leg on account ${INVENTORY_ACCOUNT_CODE}`,
      ).toBeTruthy();
      expect(Number(cogsLine!.debit)).toBeCloseTo(120, 2);
      expect(Number(cogsLine!.credit)).toBeCloseTo(0, 2);
      expect(Number(inventoryLine!.credit)).toBeCloseTo(120, 2);
      expect(Number(inventoryLine!.debit)).toBeCloseTo(0, 2);

      // ---- (6) Stock dropped to 8 → low-stock alert (min 50, qty 8) -----
      const alerts = (await (
        await owner.request.get("/api/inventory/alerts", {
          headers: hdrs(owner.companyId),
        })
      ).json()) as Array<{
        productId: number;
        minimumStock: string;
        totalQty: string;
        shortageQty: string;
      }>;
      const alert = alerts.find((a) => a.productId === product.id);
      expect(
        alert,
        `product (qty 8 < min 50) must surface in /api/inventory/alerts`,
      ).toBeTruthy();
      expect(Number(alert!.totalQty)).toBeCloseTo(8, 4);
      expect(Number(alert!.minimumStock)).toBeCloseTo(50, 4);
      expect(Number(alert!.shortageQty)).toBeCloseTo(42, 4);

      // ---- (7) Valuation total reflects the engine consumption ---------
      const valuationAfterSale = await (
        await owner.request.get("/api/inventory/valuation", {
          headers: hdrs(owner.companyId),
        })
      ).json();
      // Remaining FIFO layer: 8 @ 60 = 480.
      expect(Number(valuationAfterSale.grandTotalValue)).toBeCloseTo(480, 2);
      const valRowAfterSale = (
        valuationAfterSale.rows as Array<{ productId: number; totalQty: string; totalValue: string }>
      ).find((r) => r.productId === product.id);
      expect(valRowAfterSale, "valuation must still include the item after sale").toBeTruthy();
      expect(Number(valRowAfterSale!.totalQty)).toBeCloseTo(8, 4);
      expect(Number(valRowAfterSale!.totalValue)).toBeCloseTo(480, 2);

      // ---- (8) Cancel — engine reverses; layers + JE roll back ---------
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
      expect(
        cancelled.journalEntryId,
        "cancel must clear the invoice's JE link",
      ).toBeNull();

      // The auto-posted JE must be deleted from the GL by
      // reverseAutoPostedJournalEntry (no orphan COGS/Inventory legs).
      const journalEntriesAfter = (await (
        await owner.request.get("/api/journal-entries", {
          headers: hdrs(owner.companyId),
        })
      ).json()) as JournalEntry[];
      expect(
        journalEntriesAfter.find((j) => j.id === invoice.journalEntryId),
        `cancel must delete the auto-posted JE #${invoice.journalEntryId} from the GL`,
      ).toBeUndefined();

      // Stock level back to 10 — proves reverseSaleConsumption put the
      // FIFO layer back (rather than just zeroing the running qty).
      const stockAfterCancel = (await (
        await owner.request.get("/api/inventory/stock-levels", {
          headers: hdrs(owner.companyId),
        })
      ).json()) as Array<{ productId: number; locationId: number; qty: string }>;
      const lvlAfterCancel = stockAfterCancel.find(
        (r) => r.productId === product.id && r.locationId === location.id,
      );
      expect(
        lvlAfterCancel,
        "stock-level row must still exist after the sale is cancelled",
      ).toBeTruthy();
      expect(Number(lvlAfterCancel!.qty)).toBeCloseTo(10, 4);

      // Valuation rolled back to 10 @ 60 = 600 — locks the read-side
      // assertion that cost layers (not just running totals) were
      // restored. If reverseSaleConsumption ever regressed to
      // "increment qty without re-creating layers", this would still
      // pass under WAvg but break under FIFO; pinning the product to
      // FIFO above guarantees the layer-restore path is what's tested.
      const valuationAfterCancel = await (
        await owner.request.get("/api/inventory/valuation", {
          headers: hdrs(owner.companyId),
        })
      ).json();
      expect(Number(valuationAfterCancel.grandTotalValue)).toBeCloseTo(600, 2);
      const valRowAfterCancel = (
        valuationAfterCancel.rows as Array<{ productId: number; totalQty: string; totalValue: string }>
      ).find((r) => r.productId === product.id);
      expect(valRowAfterCancel, "valuation must include the item after cancel").toBeTruthy();
      expect(Number(valRowAfterCancel!.totalQty)).toBeCloseTo(10, 4);
      expect(Number(valRowAfterCancel!.totalValue)).toBeCloseTo(600, 2);
    },
  );
});
