/**
 * Inventory & Costing engine — task #346.
 *
 * Lives in its own module (mirroring `server/sales.ts`) so the data layer in
 * `server/storage.ts` stays free of CoA / FIFO logic.
 *
 * Two costing methods are supported, configured per item (with a workspace
 * default in `settings.default_costing_method`):
 *
 *   FIFO         — every inbound creates a row in `inventory_cost_layers`
 *                  (originalQty = remainingQty). Outbound walks the queue
 *                  oldest-first (createdAt ASC, id ASC) and decrements
 *                  remaining_qty. The cost of an outbound is the sum of
 *                  (consumed * layer.unit_cost) across the layers it
 *                  touches.
 *
 *   Weighted-Avg — only `inventory_stock_levels.avg_cost` is consulted on
 *                  outbound; cost = qty * avg_cost. Inbound recomputes
 *                  the rolling avg = (oldQty*oldAvg + newQty*newCost) /
 *                  (oldQty + newQty). No layers are created.
 *
 * Both methods always maintain `inventory_stock_levels.qty` so the stock
 * alerts panel and valuation report can scan a single table per workspace.
 *
 * The engine NEVER touches `db.` directly — every helper takes a Drizzle
 * transaction handle (`tx`) so the caller composes inventory writes with
 * the JE write + audit row inside one atomic unit (the same recipe sales /
 * payroll / fixed-assets follow).
 */
import { and, asc, desc, eq, sql, inArray } from "drizzle-orm";
import { db, withCompanyScope } from "./db";
import {
  accounts,
  inventoryCategories,
  inventoryCostLayers,
  inventoryLocations,
  inventoryStockLevels,
  inventoryTransactionLines,
  inventoryTransactions,
  journalEntries,
  products,
  settings,
  type CreateInventoryAdjustmentInput,
  type CreateInventoryPurchaseInput,
  type CreateInventoryTransferInput,
  type InventoryCostingMethod,
  type InventoryTransactionWithLines,
  type InventoryTxnType,
  type Product,
} from "@shared/schema";
import {
  AP_ACCOUNT_CODE,
  CASH_ACCOUNT_CODE,
  INVENTORY_ACCOUNT_CODE,
  INVENTORY_ADJUSTMENT_CODE,
} from "@shared/coa-seed";
import { storage, type AuditContext } from "./storage";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ---------------------------------------------------------------------------
// Public API used by routes + sales.ts
// ---------------------------------------------------------------------------

export interface AppliedOutbound {
  productId: number;
  locationId: number;
  qty: number;          // positive (qty consumed)
  unitCost: number;     // weighted average of cost actually consumed
  costAmount: number;   // qty × unitCost
}

/**
 * Round to 2dp for currency. The numeric columns are 14,4 / 14,2 so we
 * keep 4 decimals for unitCost / qty and snap currency totals to 2.
 */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function r4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

export async function resolveDefaultLocation(
  tx: Tx | typeof db,
  companyId: number,
): Promise<{ id: number; nameAr: string; nameEn: string } | null> {
  const [defaultLoc] = await tx
    .select({ id: inventoryLocations.id, nameAr: inventoryLocations.nameAr, nameEn: inventoryLocations.nameEn })
    .from(inventoryLocations)
    .where(and(eq(inventoryLocations.companyId, companyId), eq(inventoryLocations.isDefault, true)))
    .limit(1);
  if (defaultLoc) return defaultLoc;
  const [first] = await tx
    .select({ id: inventoryLocations.id, nameAr: inventoryLocations.nameAr, nameEn: inventoryLocations.nameEn })
    .from(inventoryLocations)
    .where(eq(inventoryLocations.companyId, companyId))
    .orderBy(asc(inventoryLocations.id))
    .limit(1);
  return first ?? null;
}

export async function effectiveCostingMethod(
  companyId: number,
  product: Pick<Product, "costingMethod">,
): Promise<InventoryCostingMethod> {
  if (product.costingMethod === "fifo" || product.costingMethod === "avg") {
    return product.costingMethod;
  }
  const [s] = await db
    .select({ m: settings.defaultCostingMethod })
    .from(settings)
    .where(eq(settings.companyId, companyId))
    .limit(1);
  return (s?.m === "fifo" ? "fifo" : "avg");
}

/**
 * Workspace-default costing method, fetched without a product context.
 * Used by the routes layer when seeding new items.
 */
export async function workspaceDefaultCostingMethod(
  companyId: number,
): Promise<InventoryCostingMethod> {
  const [s] = await db
    .select({ m: settings.defaultCostingMethod })
    .from(settings)
    .where(eq(settings.companyId, companyId))
    .limit(1);
  return (s?.m === "fifo" ? "fifo" : "avg");
}

// ---------------------------------------------------------------------------
// Stock-level upsert (canonical qty + avgCost per item × location)
// ---------------------------------------------------------------------------

interface StockLevelRow {
  id: number;
  qty: number;
  avgCost: number;
}

async function getOrCreateStockLevel(
  tx: Tx,
  companyId: number,
  productId: number,
  locationId: number,
): Promise<StockLevelRow> {
  const [existing] = await tx
    .select({ id: inventoryStockLevels.id, qty: inventoryStockLevels.qty, avgCost: inventoryStockLevels.avgCost })
    .from(inventoryStockLevels)
    .where(
      and(
        eq(inventoryStockLevels.companyId, companyId),
        eq(inventoryStockLevels.productId, productId),
        eq(inventoryStockLevels.locationId, locationId),
      ),
    )
    .limit(1);
  if (existing) return { id: existing.id, qty: Number(existing.qty), avgCost: Number(existing.avgCost) };
  const [created] = await tx
    .insert(inventoryStockLevels)
    .values({ companyId, productId, locationId, qty: "0", avgCost: "0" })
    .returning({ id: inventoryStockLevels.id });
  return { id: created.id, qty: 0, avgCost: 0 };
}

async function setStockLevel(
  tx: Tx,
  rowId: number,
  qty: number,
  avgCost: number,
): Promise<void> {
  await tx
    .update(inventoryStockLevels)
    .set({ qty: qty.toFixed(4), avgCost: avgCost.toFixed(4), updatedAt: new Date() })
    .where(eq(inventoryStockLevels.id, rowId));
}

// ---------------------------------------------------------------------------
// applyInbound / applyOutbound — primitives every txn handler builds on top
// ---------------------------------------------------------------------------

/**
 * Add `qty` units of `productId` at `locationId` at `unitCost`. Always
 * recomputes the rolling weighted-average in stock_levels (so FIFO items
 * have a meaningful "snapshot" avgCost for the valuation report) and, for
 * FIFO items, appends a cost layer the next outbound will consume.
 * Returns the cost amount inserted (qty × unitCost, rounded to 2dp).
 */
export async function applyInbound(
  tx: Tx,
  args: {
    companyId: number;
    productId: number;
    locationId: number;
    qty: number;
    unitCost: number;
    costingMethod: InventoryCostingMethod;
    sourceTransactionId: number;
    sourceTransactionLineId: number;
  },
): Promise<number> {
  const { companyId, productId, locationId, qty, unitCost, costingMethod } = args;
  if (qty <= 0) throw new Error("inbound qty must be positive");
  const lvl = await getOrCreateStockLevel(tx, companyId, productId, locationId);
  const newQty = r4(lvl.qty + qty);
  const newAvgCost = lvl.qty + qty <= 0
    ? unitCost
    : r4(((lvl.qty * lvl.avgCost) + (qty * unitCost)) / (lvl.qty + qty));
  await setStockLevel(tx, lvl.id, newQty, newAvgCost);

  if (costingMethod === "fifo") {
    await tx.insert(inventoryCostLayers).values({
      companyId,
      productId,
      locationId,
      originalQty: qty.toFixed(4),
      remainingQty: qty.toFixed(4),
      unitCost: unitCost.toFixed(4),
      sourceTransactionId: args.sourceTransactionId,
      sourceTransactionLineId: args.sourceTransactionLineId,
    });
  }
  return r2(qty * unitCost);
}

/**
 * Consume `qty` units. For FIFO items, walks layers oldest-first and
 * returns the weighted unit cost actually consumed; for WAvg items uses
 * stock_levels.avg_cost. Throws if there's not enough on hand. Always
 * decrements stock_levels.qty.
 */
export async function applyOutbound(
  tx: Tx,
  args: {
    companyId: number;
    productId: number;
    locationId: number;
    qty: number;
    costingMethod: InventoryCostingMethod;
  },
): Promise<{ unitCost: number; costAmount: number }> {
  const { companyId, productId, locationId, qty, costingMethod } = args;
  if (qty <= 0) throw new Error("outbound qty must be positive");
  const lvl = await getOrCreateStockLevel(tx, companyId, productId, locationId);
  if (lvl.qty + 1e-6 < qty) {
    // Allow a tiny float slop, but otherwise refuse to go negative — the
    // task spec disallows negative on-hand. Surface the offending item id
    // so the UI can map to a name.
    throw Object.assign(
      new Error(`الكمية غير كافية للمنتج (#${productId}) في الموقع (#${locationId}) — المتاح ${lvl.qty}, المطلوب ${qty}`),
      { code: "INSUFFICIENT_STOCK", productId, locationId, available: lvl.qty, requested: qty },
    );
  }

  let consumedCost = 0;

  if (costingMethod === "fifo") {
    const layers = await tx
      .select({
        id: inventoryCostLayers.id,
        remainingQty: inventoryCostLayers.remainingQty,
        unitCost: inventoryCostLayers.unitCost,
      })
      .from(inventoryCostLayers)
      .where(
        and(
          eq(inventoryCostLayers.companyId, companyId),
          eq(inventoryCostLayers.productId, productId),
          eq(inventoryCostLayers.locationId, locationId),
          sql`${inventoryCostLayers.remainingQty} > 0`,
        ),
      )
      .orderBy(asc(inventoryCostLayers.createdAt), asc(inventoryCostLayers.id));

    let remainingToConsume = qty;
    for (const layer of layers) {
      if (remainingToConsume <= 0) break;
      const avail = Number(layer.remainingQty);
      const take = Math.min(avail, remainingToConsume);
      const layerUnitCost = Number(layer.unitCost);
      consumedCost += take * layerUnitCost;
      const newRem = r4(avail - take);
      await tx
        .update(inventoryCostLayers)
        .set({ remainingQty: newRem.toFixed(4) })
        .where(eq(inventoryCostLayers.id, layer.id));
      remainingToConsume = r4(remainingToConsume - take);
    }
    if (remainingToConsume > 1e-6) {
      // Layer queue is short of total qty — fall back to stock_levels.avg_cost
      // for the residual. This can happen if cost layers were never seeded
      // (e.g. a brand-new product with stockQty>0 set directly on the
      // products row). Keeps the engine forgiving rather than blocking
      // legitimate posts on a backfill quirk.
      consumedCost += remainingToConsume * lvl.avgCost;
    }
  } else {
    consumedCost = qty * lvl.avgCost;
  }

  // Decrement on-hand. avgCost stays unchanged on outbound (the rolling
  // WAvg only moves on inbound). For FIFO we recompute the snapshot
  // avgCost from the surviving layer queue so the valuation report
  // doesn't drift.
  const newQty = r4(lvl.qty - qty);
  let newAvgCost = lvl.avgCost;
  if (costingMethod === "fifo" && newQty > 0) {
    const [agg] = await tx
      .select({
        totalQty: sql<string>`coalesce(sum(${inventoryCostLayers.remainingQty}), 0)`,
        totalValue: sql<string>`coalesce(sum(${inventoryCostLayers.remainingQty} * ${inventoryCostLayers.unitCost}), 0)`,
      })
      .from(inventoryCostLayers)
      .where(
        and(
          eq(inventoryCostLayers.companyId, companyId),
          eq(inventoryCostLayers.productId, productId),
          eq(inventoryCostLayers.locationId, locationId),
        ),
      );
    const tq = Number(agg?.totalQty ?? 0);
    const tv = Number(agg?.totalValue ?? 0);
    if (tq > 0) newAvgCost = r4(tv / tq);
  }
  await setStockLevel(tx, lvl.id, newQty, newAvgCost);

  const unitCost = qty > 0 ? r4(consumedCost / qty) : 0;
  return { unitCost, costAmount: r2(consumedCost) };
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

const NUMBER_PREFIX: Record<InventoryTxnType, string> = {
  purchase: "TXN-PUR-",
  sale: "TXN-SAL-",
  adjustment: "TXN-ADJ-",
  transfer: "TXN-TRF-",
};

async function nextTransactionNumber(
  tx: Tx,
  companyId: number,
  type: InventoryTxnType,
): Promise<string> {
  const prefix = NUMBER_PREFIX[type];
  const rows = await tx
    .select({ number: inventoryTransactions.number })
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.companyId, companyId),
        sql`${inventoryTransactions.number} LIKE ${prefix + "%"}`,
      ),
    )
    .orderBy(desc(inventoryTransactions.id))
    .limit(50);
  let max = 0;
  for (const r of rows) {
    const tail = r.number.slice(prefix.length);
    const n = Number(tail);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// CoA helper
// ---------------------------------------------------------------------------

async function loadAccountIds(
  tx: Tx,
  companyId: number,
  codes: string[],
): Promise<Map<string, number>> {
  const rows = await tx
    .select({ id: accounts.id, code: accounts.code })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), inArray(accounts.code, codes)));
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.code, r.id);
  for (const code of codes) {
    if (!map.has(code)) {
      throw new Error(
        `حساب رقم (${code}) غير موجود — قم بإعادة تشغيل /api/accounts/seed لإنشاء الدليل المحاسبي القياسي.`,
      );
    }
  }
  return map;
}

async function loadProducts(
  tx: Tx,
  companyId: number,
  productIds: number[],
): Promise<Map<number, Product>> {
  if (productIds.length === 0) return new Map();
  const uniqueIds = Array.from(new Set(productIds));
  const rows = await tx
    .select()
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, uniqueIds)));
  return new Map(rows.map((p) => [p.id, p]));
}

// ---------------------------------------------------------------------------
// Recorders — purchase / adjustment / transfer
// ---------------------------------------------------------------------------

interface RecordedTransaction {
  id: number;
  number: string;
  journalEntryId: number | null;
  totalAmount: number;
}

/** Build + post a purchase. Cash → Cr 1110; Credit → Cr 2110. */
export async function recordPurchase(
  companyId: number,
  input: CreateInventoryPurchaseInput,
  ctx?: AuditContext,
): Promise<RecordedTransaction> {
  const productMap = await loadProducts(db as any, companyId, input.lines.map((l) => l.productId));
  // Validate location ownership.
  const [loc] = await db
    .select({ id: inventoryLocations.id })
    .from(inventoryLocations)
    .where(
      and(
        eq(inventoryLocations.companyId, companyId),
        eq(inventoryLocations.id, input.locationId),
      ),
    )
    .limit(1);
  if (!loc) throw new Error("الموقع غير موجود في هذا الحساب");
  // Pre-resolve costing methods (read settings once, outside the tx).
  const methodByProduct = new Map<number, InventoryCostingMethod>();
  for (const l of input.lines) {
    const p = productMap.get(l.productId);
    if (!p) throw new Error(`المنتج (${l.productId}) غير موجود في هذا الحساب`);
    if (p.isService) throw new Error(`المنتج "${p.nameAr}" خدمي ولا يمكن شراؤه كمخزون`);
    methodByProduct.set(l.productId, await effectiveCostingMethod(companyId, p));
  }

  const targetCashCode = input.paymentMethod === "cash" ? CASH_ACCOUNT_CODE : AP_ACCOUNT_CODE;

  return await db.transaction(async (tx) => {
    const codeIds = await loadAccountIds(tx, companyId, [INVENTORY_ACCOUNT_CODE, targetCashCode]);
    const number = await nextTransactionNumber(tx, companyId, "purchase");
    const total = r2(input.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost), 0));

    const [hdr] = await tx
      .insert(inventoryTransactions)
      .values({
        companyId,
        number,
        type: "purchase",
        txnDate: input.txnDate,
        locationId: input.locationId,
        reference: input.reference,
        vendorName: input.vendorName,
        notes: input.notes,
        status: "posted",
        totalAmount: total.toFixed(2),
      })
      .returning();

    let lineCostTotal = 0;
    for (const l of input.lines) {
      const qty = Number(l.quantity);
      const unitCost = Number(l.unitCost);
      const costAmount = r2(qty * unitCost);
      const [insertedLine] = await tx
        .insert(inventoryTransactionLines)
        .values({
          companyId,
          transactionId: hdr.id,
          productId: l.productId,
          description: l.description,
          quantity: qty.toFixed(4),
          unitCost: unitCost.toFixed(4),
          costAmount: costAmount.toFixed(2),
        })
        .returning({ id: inventoryTransactionLines.id });
      const method = methodByProduct.get(l.productId)!;
      await applyInbound(tx, {
        companyId,
        productId: l.productId,
        locationId: input.locationId,
        qty,
        unitCost,
        costingMethod: method,
        sourceTransactionId: hdr.id,
        sourceTransactionLineId: insertedLine.id,
      });
      // Mirror legacy products.stockQty so the existing Products page tile
      // and any pre-inventory consumer keeps showing a sensible total.
      await tx
        .update(products)
        .set({ stockQty: sql`coalesce(${products.stockQty}, 0) + ${qty}` })
        .where(and(eq(products.companyId, companyId), eq(products.id, l.productId)));
      lineCostTotal += costAmount;
    }

    // Build JE: Dr 1300 / Cr 1110 or 2110.
    const description = input.paymentMethod === "cash"
      ? `مشتريات نقدية ${number}${input.vendorName ? " — " + input.vendorName : ""}`
      : `مشتريات آجل ${number}${input.vendorName ? " — " + input.vendorName : ""}`;

    let journalEntryId: number | null = null;
    if (lineCostTotal > 0.0001) {
      const je = await storage.createJournalEntry(
        companyId,
        {
          entryDate: input.txnDate,
          description,
          source: "manual",
          lines: [
            { accountId: codeIds.get(INVENTORY_ACCOUNT_CODE)!, debit: lineCostTotal, credit: 0, description: `زيادة المخزون — ${number}` },
            { accountId: codeIds.get(targetCashCode)!, debit: 0, credit: lineCostTotal, description },
          ],
        },
        ctx,
      );
      journalEntryId = je.id;
      await tx
        .update(inventoryTransactions)
        .set({ journalEntryId: je.id })
        .where(eq(inventoryTransactions.id, hdr.id));
    }

    return { id: hdr.id, number, journalEntryId, totalAmount: r2(lineCostTotal) };
  });
}

/**
 * Adjustment — quantity is signed per line.  Aggregates per product into a
 * single value:
 *   netCost > 0  → Dr 1300 / Cr 5200 (gain)
 *   netCost < 0  → Dr 5200 / Cr 1300 (loss / shrinkage)
 */
export async function recordAdjustment(
  companyId: number,
  input: CreateInventoryAdjustmentInput,
  ctx?: AuditContext,
): Promise<RecordedTransaction> {
  const productMap = await loadProducts(db as any, companyId, input.lines.map((l) => l.productId));
  const [loc] = await db
    .select({ id: inventoryLocations.id })
    .from(inventoryLocations)
    .where(
      and(
        eq(inventoryLocations.companyId, companyId),
        eq(inventoryLocations.id, input.locationId),
      ),
    )
    .limit(1);
  if (!loc) throw new Error("الموقع غير موجود في هذا الحساب");
  const methodByProduct = new Map<number, InventoryCostingMethod>();
  for (const l of input.lines) {
    const p = productMap.get(l.productId);
    if (!p) throw new Error(`المنتج (${l.productId}) غير موجود في هذا الحساب`);
    if (p.isService) throw new Error(`المنتج "${p.nameAr}" خدمي ولا يمكن تسويته`);
    methodByProduct.set(l.productId, await effectiveCostingMethod(companyId, p));
  }

  return await db.transaction(async (tx) => {
    const codeIds = await loadAccountIds(tx, companyId, [INVENTORY_ACCOUNT_CODE, INVENTORY_ADJUSTMENT_CODE]);
    const number = await nextTransactionNumber(tx, companyId, "adjustment");
    const [hdr] = await tx
      .insert(inventoryTransactions)
      .values({
        companyId,
        number,
        type: "adjustment",
        txnDate: input.txnDate,
        locationId: input.locationId,
        reason: input.reason,
        notes: input.notes,
        status: "posted",
      })
      .returning();

    let netValue = 0; // signed; +ve = inventory increased, -ve = inventory decreased
    for (const l of input.lines) {
      const qty = Number(l.quantity);
      const method = methodByProduct.get(l.productId)!;
      let unitCost = Number(l.unitCost);
      let costAmount = 0;
      if (qty > 0) {
        // Positive adjustment: needs a unit cost (use product's last known
        // cost if the form left it 0).
        if (unitCost <= 0) {
          const p = productMap.get(l.productId)!;
          unitCost = Number(p.unitCost) || 0;
        }
        costAmount = r2(qty * unitCost);
        const [ln] = await tx
          .insert(inventoryTransactionLines)
          .values({
            companyId, transactionId: hdr.id, productId: l.productId,
            description: l.description,
            quantity: qty.toFixed(4),
            unitCost: unitCost.toFixed(4),
            costAmount: costAmount.toFixed(2),
          })
          .returning({ id: inventoryTransactionLines.id });
        await applyInbound(tx, {
          companyId, productId: l.productId, locationId: input.locationId,
          qty, unitCost, costingMethod: method,
          sourceTransactionId: hdr.id, sourceTransactionLineId: ln.id,
        });
        await tx
          .update(products)
          .set({ stockQty: sql`coalesce(${products.stockQty}, 0) + ${qty}` })
          .where(and(eq(products.companyId, companyId), eq(products.id, l.productId)));
        netValue += costAmount;
      } else {
        // Negative adjustment: cost comes from the engine.
        const absQty = -qty;
        const out = await applyOutbound(tx, {
          companyId, productId: l.productId, locationId: input.locationId,
          qty: absQty, costingMethod: method,
        });
        unitCost = out.unitCost;
        costAmount = out.costAmount;
        await tx
          .insert(inventoryTransactionLines)
          .values({
            companyId, transactionId: hdr.id, productId: l.productId,
            description: l.description,
            quantity: qty.toFixed(4),                         // signed (negative)
            unitCost: unitCost.toFixed(4),
            costAmount: (-costAmount).toFixed(2),             // signed (negative for loss)
          });
        await tx
          .update(products)
          .set({ stockQty: sql`coalesce(${products.stockQty}, 0) - ${absQty}` })
          .where(and(eq(products.companyId, companyId), eq(products.id, l.productId)));
        netValue -= costAmount;
      }
    }

    netValue = r2(netValue);
    let journalEntryId: number | null = null;
    if (Math.abs(netValue) > 0.0001) {
      // Direction: +ve net → inventory grew → Dr 1300 / Cr 5200 (gain)
      //            -ve net → inventory shrunk → Dr 5200 / Cr 1300 (loss)
      const amount = Math.abs(netValue);
      const inventoryDr = netValue > 0;
      const lines = inventoryDr
        ? [
            { accountId: codeIds.get(INVENTORY_ACCOUNT_CODE)!, debit: amount, credit: 0, description: `تسوية مخزون — ${number}` },
            { accountId: codeIds.get(INVENTORY_ADJUSTMENT_CODE)!, debit: 0, credit: amount, description: `تسوية مخزون — ${number}` },
          ]
        : [
            { accountId: codeIds.get(INVENTORY_ADJUSTMENT_CODE)!, debit: amount, credit: 0, description: `تسوية مخزون — ${number}` },
            { accountId: codeIds.get(INVENTORY_ACCOUNT_CODE)!, debit: 0, credit: amount, description: `تسوية مخزون — ${number}` },
          ];
      const je = await storage.createJournalEntry(
        companyId,
        { entryDate: input.txnDate, description: `${number} (${input.reason})`, source: "manual", lines },
        ctx,
      );
      journalEntryId = je.id;
      await tx
        .update(inventoryTransactions)
        .set({ journalEntryId: je.id, totalAmount: amount.toFixed(2) })
        .where(eq(inventoryTransactions.id, hdr.id));
    }
    return { id: hdr.id, number, journalEntryId, totalAmount: Math.abs(netValue) };
  });
}

/**
 * Transfer — moves qty from src to dest. Same Inventory account either
 * side, so no JE is created (memo only). Stock movement applies an
 * outbound at src + inbound at dest at the SAME unit cost the source
 * yielded, preserving total inventory value.
 */
export async function recordTransfer(
  companyId: number,
  input: CreateInventoryTransferInput,
  ctx?: AuditContext,
): Promise<RecordedTransaction> {
  const productMap = await loadProducts(db as any, companyId, input.lines.map((l) => l.productId));
  const [src] = await db
    .select({ id: inventoryLocations.id })
    .from(inventoryLocations)
    .where(and(eq(inventoryLocations.companyId, companyId), eq(inventoryLocations.id, input.locationId)))
    .limit(1);
  const [dst] = await db
    .select({ id: inventoryLocations.id })
    .from(inventoryLocations)
    .where(and(eq(inventoryLocations.companyId, companyId), eq(inventoryLocations.id, input.destLocationId)))
    .limit(1);
  if (!src || !dst) throw new Error("أحد الموقعين غير موجود في هذا الحساب");
  const methodByProduct = new Map<number, InventoryCostingMethod>();
  for (const l of input.lines) {
    const p = productMap.get(l.productId);
    if (!p) throw new Error(`المنتج (${l.productId}) غير موجود في هذا الحساب`);
    if (p.isService) throw new Error(`المنتج "${p.nameAr}" خدمي ولا يمكن نقله`);
    methodByProduct.set(l.productId, await effectiveCostingMethod(companyId, p));
  }

  return await db.transaction(async (tx) => {
    const number = await nextTransactionNumber(tx, companyId, "transfer");
    const [hdr] = await tx
      .insert(inventoryTransactions)
      .values({
        companyId,
        number,
        type: "transfer",
        txnDate: input.txnDate,
        locationId: input.locationId,
        destLocationId: input.destLocationId,
        notes: input.notes,
        status: "posted",
      })
      .returning();

    let total = 0;
    for (const l of input.lines) {
      const qty = Number(l.quantity);
      const method = methodByProduct.get(l.productId)!;
      const out = await applyOutbound(tx, {
        companyId, productId: l.productId, locationId: input.locationId,
        qty, costingMethod: method,
      });
      // Inbound at dest at the same unit cost the source surrendered.
      const [ln] = await tx
        .insert(inventoryTransactionLines)
        .values({
          companyId, transactionId: hdr.id, productId: l.productId,
          description: l.description,
          quantity: qty.toFixed(4),
          unitCost: out.unitCost.toFixed(4),
          costAmount: out.costAmount.toFixed(2),
        })
        .returning({ id: inventoryTransactionLines.id });
      await applyInbound(tx, {
        companyId, productId: l.productId, locationId: input.destLocationId,
        qty, unitCost: out.unitCost, costingMethod: method,
        sourceTransactionId: hdr.id, sourceTransactionLineId: ln.id,
      });
      total += out.costAmount;
    }
    total = r2(total);
    await tx
      .update(inventoryTransactions)
      .set({ totalAmount: total.toFixed(2) })
      .where(eq(inventoryTransactions.id, hdr.id));
    return { id: hdr.id, number, journalEntryId: null, totalAmount: total };
  });
}

// ---------------------------------------------------------------------------
// Sale costing — called from server/sales.ts in place of static unitCost
// ---------------------------------------------------------------------------

/**
 * Compute (and apply) per-line outbound cost for a posted sales invoice.
 * The caller passes the source location (defaults to the workspace's Main
 * warehouse when omitted) plus the line product+quantity tuples and gets
 * back the per-line costAmount + a sale `inventory_transactions` row that
 * mirrors the JE for traceability.
 */
export async function applySaleConsumption(
  tx: Tx,
  args: {
    companyId: number;
    sourceInvoiceId: number;
    invoiceNumber: string;
    invoiceDate: string;
    journalEntryId: number;
    locationId: number;
    lines: Array<{ productId: number; quantity: number }>;
  },
): Promise<AppliedOutbound[]> {
  if (args.lines.length === 0) return [];
  const productMap = await loadProducts(tx, args.companyId, args.lines.map((l) => l.productId));

  const number = await nextTransactionNumber(tx, args.companyId, "sale");
  const [hdr] = await tx
    .insert(inventoryTransactions)
    .values({
      companyId: args.companyId,
      number,
      type: "sale",
      txnDate: args.invoiceDate,
      locationId: args.locationId,
      reference: args.invoiceNumber,
      notes: `استهلاك مخزون لفاتورة ${args.invoiceNumber}`,
      status: "posted",
      sourceInvoiceId: args.sourceInvoiceId,
      journalEntryId: args.journalEntryId,
    })
    .returning();

  const out: AppliedOutbound[] = [];
  let totalCost = 0;
  for (const l of args.lines) {
    const p = productMap.get(l.productId);
    if (!p || p.isService) continue; // services don't consume stock
    const method = await effectiveCostingMethod(args.companyId, p);
    const r = await applyOutbound(tx, {
      companyId: args.companyId,
      productId: l.productId,
      locationId: args.locationId,
      qty: l.quantity,
      costingMethod: method,
    });
    await tx.insert(inventoryTransactionLines).values({
      companyId: args.companyId,
      transactionId: hdr.id,
      productId: l.productId,
      description: p.nameAr,
      quantity: (-l.quantity).toFixed(4),                  // signed: outbound
      unitCost: r.unitCost.toFixed(4),
      costAmount: (-r.costAmount).toFixed(2),
    });
    // Mirror to legacy products.stockQty (back-compat with the existing
    // Products UI tile and any pre-inventory consumer).
    await tx
      .update(products)
      .set({ stockQty: sql`coalesce(${products.stockQty}, 0) - ${l.quantity}` })
      .where(and(eq(products.companyId, args.companyId), eq(products.id, l.productId)));
    totalCost += r.costAmount;
    out.push({ productId: l.productId, locationId: args.locationId, qty: l.quantity, unitCost: r.unitCost, costAmount: r.costAmount });
  }
  await tx
    .update(inventoryTransactions)
    .set({ totalAmount: totalCost.toFixed(2) })
    .where(eq(inventoryTransactions.id, hdr.id));
  return out;
}

/**
 * Reverse a previously posted sale's stock consumption: replay every
 * outbound from the linked sale txn as an inbound at the recorded unit
 * cost. Used by the cancel/delete-posted-invoice path so the layer queue
 * stays internally consistent.
 */
export async function reverseSaleConsumption(
  tx: Tx,
  companyId: number,
  sourceInvoiceId: number,
): Promise<{ found: boolean }> {
  const [hdr] = await tx
    .select()
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.companyId, companyId),
        eq(inventoryTransactions.type, "sale"),
        eq(inventoryTransactions.sourceInvoiceId, sourceInvoiceId),
        eq(inventoryTransactions.status, "posted"),
      ),
    )
    .limit(1);
  if (!hdr) return { found: false }; // sale was never recorded (service-only invoice / legacy pre-engine)
  const lines = await tx
    .select()
    .from(inventoryTransactionLines)
    .where(eq(inventoryTransactionLines.transactionId, hdr.id));
  const productMap = await loadProducts(tx, companyId, lines.map((l) => l.productId));
  for (const l of lines) {
    const qty = -Number(l.quantity);                    // original was negative
    if (qty <= 0) continue;
    const p = productMap.get(l.productId);
    if (!p) continue;
    const method = await effectiveCostingMethod(companyId, p);
    await applyInbound(tx, {
      companyId,
      productId: l.productId,
      locationId: hdr.locationId!,
      qty,
      unitCost: Number(l.unitCost),
      costingMethod: method,
      sourceTransactionId: hdr.id,
      sourceTransactionLineId: l.id,
    });
    // Mirror to legacy products.stockQty (back-compat).
    await tx
      .update(products)
      .set({ stockQty: sql`coalesce(${products.stockQty}, 0) + ${qty}` })
      .where(and(eq(products.companyId, companyId), eq(products.id, l.productId)));
  }
  await tx
    .update(inventoryTransactions)
    .set({ status: "reversed" })
    .where(eq(inventoryTransactions.id, hdr.id));
  return { found: true };
}

// ---------------------------------------------------------------------------
// Standalone wrappers used by sales.ts (each opens its own tx)
// ---------------------------------------------------------------------------

/**
 * One-shot helper sales.ts uses at posting time. Resolves the workspace's
 * default location, consumes layers for every goods line, mirrors to
 * `products.stockQty`, and returns the engine-computed cogs total + the
 * `inventory_transactions` row id (so the caller can later patch in the JE
 * id once the JE is created).
 *
 * The returned txnId is null when there were no goods lines (service-only
 * invoice) — caller skips the COGS / Inventory legs in the JE.
 */
export async function consumeStockForSaleStandalone(
  companyId: number,
  args: {
    invoiceId: number;
    invoiceNumber: string;
    invoiceDate: string;
    lines: Array<{ productId: number; quantity: number }>;
  },
): Promise<{ cogsAmount: number; transactionId: number | null }> {
  if (args.lines.length === 0) return { cogsAmount: 0, transactionId: null };
  const loc = await resolveDefaultLocation(db as any, companyId);
  if (!loc) {
    throw new Error("لا يوجد موقع مخزن — أنشئ مستودعاً أولاً قبل ترحيل فواتير المبيعات.");
  }
  return await db.transaction(async (tx) => {
    const applied = await applySaleConsumption(tx, {
      companyId,
      sourceInvoiceId: args.invoiceId,
      invoiceNumber: args.invoiceNumber,
      invoiceDate: args.invoiceDate,
      journalEntryId: 0, // placeholder; sales.ts will patch in via linkSaleTransactionToJournalEntry
      locationId: loc.id,
      lines: args.lines,
    });
    if (applied.length === 0) return { cogsAmount: 0, transactionId: null };
    const total = applied.reduce((s, a) => s + a.costAmount, 0);
    // Find the txn row we just created so caller can patch in JE id later.
    const [hdr] = await tx
      .select({ id: inventoryTransactions.id })
      .from(inventoryTransactions)
      .where(
        and(
          eq(inventoryTransactions.companyId, companyId),
          eq(inventoryTransactions.type, "sale"),
          eq(inventoryTransactions.sourceInvoiceId, args.invoiceId),
          eq(inventoryTransactions.status, "posted"),
        ),
      )
      .limit(1);
    return { cogsAmount: r2(total), transactionId: hdr?.id ?? null };
  });
}

/**
 * Patch an existing sale-side `inventory_transactions` row with its
 * journal-entry id (set in a separate tx by sales.ts after the JE is
 * created). Cheap, idempotent.
 */
export async function linkSaleTransactionToJournalEntry(
  companyId: number,
  transactionId: number,
  journalEntryId: number,
): Promise<void> {
  await db
    .update(inventoryTransactions)
    .set({ journalEntryId })
    .where(and(eq(inventoryTransactions.companyId, companyId), eq(inventoryTransactions.id, transactionId)));
}

/**
 * Standalone reversal helper called from storage.reverseSalesInvoicePosting.
 * Opens its own tx so it can be used both inside the broader cancel flow
 * and from the recovery branch when JE creation fails after consumption.
 */
export async function reverseSaleConsumptionStandalone(
  companyId: number,
  invoiceId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await reverseSaleConsumption(tx, companyId, invoiceId);
  });
}

// ---------------------------------------------------------------------------
// Reverse a purchase / adjustment / transfer (UI-driven)
// ---------------------------------------------------------------------------

export async function reverseInventoryTransaction(
  companyId: number,
  txnId: number,
  ctx?: AuditContext,
): Promise<RecordedTransaction> {
  const [orig] = await db
    .select()
    .from(inventoryTransactions)
    .where(and(eq(inventoryTransactions.companyId, companyId), eq(inventoryTransactions.id, txnId)))
    .limit(1);
  if (!orig) throw new Error("الحركة غير موجودة");
  if (orig.status !== "posted") throw new Error("لا يمكن عكس حركة غير مرحّلة");
  if (orig.type === "sale") throw new Error("استخدم زر الإلغاء على الفاتورة لعكس استهلاك مبيعات");

  const lines = await db
    .select()
    .from(inventoryTransactionLines)
    .where(eq(inventoryTransactionLines.transactionId, txnId));
  const productMap = await loadProducts(db as any, companyId, lines.map((l) => l.productId));

  return await db.transaction(async (tx) => {
    const number = await nextTransactionNumber(tx, companyId, orig.type as InventoryTxnType);
    const [rev] = await tx
      .insert(inventoryTransactions)
      .values({
        companyId,
        number,
        type: orig.type,
        txnDate: new Date().toISOString().slice(0, 10),
        locationId: orig.locationId,
        destLocationId: orig.destLocationId,
        reference: `REV ${orig.number}`,
        vendorName: orig.vendorName,
        reason: orig.reason,
        notes: `عكس الحركة ${orig.number}`,
        status: "posted",
        reversalOfId: orig.id,
      })
      .returning();

    let netValue = 0;
    for (const l of lines) {
      const origQty = Number(l.quantity);
      const origUnitCost = Number(l.unitCost);
      const origCost = Number(l.costAmount);
      const product = productMap.get(l.productId);
      if (!product) continue;
      const method = await effectiveCostingMethod(companyId, product);

      if (orig.type === "purchase") {
        // Original was inbound +qty. Reversal = outbound qty (consumes layers,
        // ideally the very layer this txn created, but FIFO will pick oldest).
        const out = await applyOutbound(tx, {
          companyId, productId: l.productId, locationId: orig.locationId!,
          qty: origQty, costingMethod: method,
        });
        await tx.insert(inventoryTransactionLines).values({
          companyId, transactionId: rev.id, productId: l.productId,
          description: l.description,
          quantity: (-origQty).toFixed(4),
          unitCost: out.unitCost.toFixed(4),
          costAmount: (-out.costAmount).toFixed(2),
        });
        await tx.update(products)
          .set({ stockQty: sql`coalesce(${products.stockQty}, 0) - ${origQty}` })
          .where(and(eq(products.companyId, companyId), eq(products.id, l.productId)));
        netValue -= out.costAmount;
      } else if (orig.type === "adjustment") {
        if (origQty > 0) {
          // Reverse positive adjustment = outbound
          const out = await applyOutbound(tx, {
            companyId, productId: l.productId, locationId: orig.locationId!,
            qty: origQty, costingMethod: method,
          });
          await tx.insert(inventoryTransactionLines).values({
            companyId, transactionId: rev.id, productId: l.productId,
            description: l.description,
            quantity: (-origQty).toFixed(4),
            unitCost: out.unitCost.toFixed(4),
            costAmount: (-out.costAmount).toFixed(2),
          });
          await tx.update(products)
            .set({ stockQty: sql`coalesce(${products.stockQty}, 0) - ${origQty}` })
            .where(and(eq(products.companyId, companyId), eq(products.id, l.productId)));
          netValue -= out.costAmount;
        } else {
          // Reverse negative adjustment = inbound at recorded unit cost
          const absQty = -origQty;
          await applyInbound(tx, {
            companyId, productId: l.productId, locationId: orig.locationId!,
            qty: absQty, unitCost: origUnitCost, costingMethod: method,
            sourceTransactionId: rev.id, sourceTransactionLineId: 0,
          });
          await tx.insert(inventoryTransactionLines).values({
            companyId, transactionId: rev.id, productId: l.productId,
            description: l.description,
            quantity: absQty.toFixed(4),
            unitCost: origUnitCost.toFixed(4),
            costAmount: Math.abs(origCost).toFixed(2),
          });
          await tx.update(products)
            .set({ stockQty: sql`coalesce(${products.stockQty}, 0) + ${absQty}` })
            .where(and(eq(products.companyId, companyId), eq(products.id, l.productId)));
          netValue += Math.abs(origCost);
        }
      } else if (orig.type === "transfer") {
        // Reversal of a transfer: outbound at dest, inbound at src, same cost.
        const out = await applyOutbound(tx, {
          companyId, productId: l.productId, locationId: orig.destLocationId!,
          qty: origQty, costingMethod: method,
        });
        await applyInbound(tx, {
          companyId, productId: l.productId, locationId: orig.locationId!,
          qty: origQty, unitCost: out.unitCost, costingMethod: method,
          sourceTransactionId: rev.id, sourceTransactionLineId: 0,
        });
        await tx.insert(inventoryTransactionLines).values({
          companyId, transactionId: rev.id, productId: l.productId,
          description: l.description,
          quantity: (-origQty).toFixed(4),
          unitCost: out.unitCost.toFixed(4),
          costAmount: (-out.costAmount).toFixed(2),
        });
      }
    }

    netValue = r2(Math.abs(netValue));
    let revJeId: number | null = null;
    if (orig.journalEntryId && netValue > 0.0001) {
      const codes = await loadAccountIds(tx, companyId, [
        INVENTORY_ACCOUNT_CODE, INVENTORY_ADJUSTMENT_CODE, CASH_ACCOUNT_CODE, AP_ACCOUNT_CODE,
      ]);
      let revLines;
      if (orig.type === "purchase") {
        const cashCode = orig.vendorName ? AP_ACCOUNT_CODE : CASH_ACCOUNT_CODE; // weak heuristic; we don't store payment method on txn
        revLines = [
          { accountId: codes.get(cashCode)!, debit: netValue, credit: 0, description: `عكس مشتريات ${orig.number}` },
          { accountId: codes.get(INVENTORY_ACCOUNT_CODE)!, debit: 0, credit: netValue, description: `عكس مشتريات ${orig.number}` },
        ];
      } else {
        // adjustment reversal — direction is opposite of the original.
        // We rebuild from the new txn lines: if the reversal grew inventory,
        // Dr 1300 / Cr 5200; if it shrank it, Dr 5200 / Cr 1300.
        const grew = lines.some((l) => Number(l.quantity) < 0); // original had outbounds → reversal added stock
        revLines = grew
          ? [
              { accountId: codes.get(INVENTORY_ACCOUNT_CODE)!, debit: netValue, credit: 0, description: `عكس تسوية ${orig.number}` },
              { accountId: codes.get(INVENTORY_ADJUSTMENT_CODE)!, debit: 0, credit: netValue, description: `عكس تسوية ${orig.number}` },
            ]
          : [
              { accountId: codes.get(INVENTORY_ADJUSTMENT_CODE)!, debit: netValue, credit: 0, description: `عكس تسوية ${orig.number}` },
              { accountId: codes.get(INVENTORY_ACCOUNT_CODE)!, debit: 0, credit: netValue, description: `عكس تسوية ${orig.number}` },
            ];
      }
      const je = await storage.createJournalEntry(
        companyId,
        {
          entryDate: new Date().toISOString().slice(0, 10),
          description: `عكس الحركة ${orig.number}`,
          source: "manual",
          lines: revLines,
        },
        ctx,
      );
      revJeId = je.id;
      await tx
        .update(inventoryTransactions)
        .set({ journalEntryId: je.id, totalAmount: netValue.toFixed(2) })
        .where(eq(inventoryTransactions.id, rev.id));
    }
    await tx
      .update(inventoryTransactions)
      .set({ status: "reversed" })
      .where(eq(inventoryTransactions.id, orig.id));
    return { id: rev.id, number, journalEntryId: revJeId, totalAmount: netValue };
  });
}

// ---------------------------------------------------------------------------
// Read paths (used by routes layer)
// ---------------------------------------------------------------------------

export async function listTransactions(
  companyId: number,
  filters?: { type?: InventoryTxnType; locationId?: number; from?: string; to?: string },
): Promise<InventoryTransactionWithLines[]> {
  const where = [eq(inventoryTransactions.companyId, companyId)];
  if (filters?.type) where.push(eq(inventoryTransactions.type, filters.type));
  if (filters?.locationId) where.push(eq(inventoryTransactions.locationId, filters.locationId));
  if (filters?.from) where.push(sql`${inventoryTransactions.txnDate} >= ${filters.from}`);
  if (filters?.to) where.push(sql`${inventoryTransactions.txnDate} <= ${filters.to}`);

  const headers = await db
    .select()
    .from(inventoryTransactions)
    .where(and(...where))
    .orderBy(desc(inventoryTransactions.txnDate), desc(inventoryTransactions.id))
    .limit(500);
  if (headers.length === 0) return [];
  const ids = headers.map((h) => h.id);
  const lines = await db
    .select()
    .from(inventoryTransactionLines)
    .where(and(eq(inventoryTransactionLines.companyId, companyId), inArray(inventoryTransactionLines.transactionId, ids)));
  const linesByTxn = new Map<number, typeof lines>();
  for (const l of lines) {
    if (!linesByTxn.has(l.transactionId)) linesByTxn.set(l.transactionId, []);
    linesByTxn.get(l.transactionId)!.push(l);
  }
  const locs = await db
    .select({ id: inventoryLocations.id, nameAr: inventoryLocations.nameAr, nameEn: inventoryLocations.nameEn })
    .from(inventoryLocations)
    .where(eq(inventoryLocations.companyId, companyId));
  const locById = new Map(locs.map((l) => [l.id, l]));
  const jeIds = headers.map((h) => h.journalEntryId).filter((v): v is number => v != null);
  const jeRefs = jeIds.length === 0
    ? new Map<number, string>()
    : new Map(
        (await db
          .select({ id: journalEntries.id, reference: journalEntries.reference })
          .from(journalEntries)
          .where(and(eq(journalEntries.companyId, companyId), inArray(journalEntries.id, jeIds))))
          .map((r) => [r.id, r.reference]),
      );
  return headers.map((h) => ({
    ...h,
    lines: linesByTxn.get(h.id) ?? [],
    location: h.locationId ? locById.get(h.locationId) ?? null : null,
    destLocation: h.destLocationId ? locById.get(h.destLocationId) ?? null : null,
    journalEntryReference: h.journalEntryId ? jeRefs.get(h.journalEntryId) ?? null : null,
  }));
}

export async function getTransaction(
  companyId: number,
  id: number,
): Promise<InventoryTransactionWithLines | null> {
  const [hdr] = await db
    .select()
    .from(inventoryTransactions)
    .where(and(eq(inventoryTransactions.companyId, companyId), eq(inventoryTransactions.id, id)))
    .limit(1);
  if (!hdr) return null;
  const lines = await db
    .select()
    .from(inventoryTransactionLines)
    .where(eq(inventoryTransactionLines.transactionId, id));
  let location = null;
  let destLocation = null;
  if (hdr.locationId) {
    const [loc] = await db
      .select({ id: inventoryLocations.id, nameAr: inventoryLocations.nameAr, nameEn: inventoryLocations.nameEn })
      .from(inventoryLocations)
      .where(eq(inventoryLocations.id, hdr.locationId)).limit(1);
    location = loc ?? null;
  }
  if (hdr.destLocationId) {
    const [loc] = await db
      .select({ id: inventoryLocations.id, nameAr: inventoryLocations.nameAr, nameEn: inventoryLocations.nameEn })
      .from(inventoryLocations)
      .where(eq(inventoryLocations.id, hdr.destLocationId)).limit(1);
    destLocation = loc ?? null;
  }
  let jeRef: string | null = null;
  if (hdr.journalEntryId) {
    const [je] = await db
      .select({ reference: journalEntries.reference })
      .from(journalEntries)
      .where(eq(journalEntries.id, hdr.journalEntryId)).limit(1);
    jeRef = je?.reference ?? null;
  }
  return { ...hdr, lines, location, destLocation, journalEntryReference: jeRef };
}

// ---------------------------------------------------------------------------
// CRUD: categories
// ---------------------------------------------------------------------------

export async function listCategories(companyId: number) {
  return db
    .select()
    .from(inventoryCategories)
    .where(eq(inventoryCategories.companyId, companyId))
    .orderBy(asc(inventoryCategories.nameAr));
}

export async function createCategory(
  companyId: number,
  input: { nameAr: string; nameEn?: string | null },
) {
  const [row] = await db
    .insert(inventoryCategories)
    .values({ companyId, nameAr: input.nameAr.trim(), nameEn: input.nameEn?.trim() ?? "" })
    .returning();
  return row;
}

export async function updateCategory(
  companyId: number,
  id: number,
  input: { nameAr?: string; nameEn?: string | null },
) {
  const set: Record<string, unknown> = {};
  if (input.nameAr !== undefined) set.nameAr = input.nameAr.trim();
  if (input.nameEn !== undefined) set.nameEn = input.nameEn?.trim() ?? null;
  if (Object.keys(set).length === 0) {
    const [row] = await db
      .select()
      .from(inventoryCategories)
      .where(and(eq(inventoryCategories.companyId, companyId), eq(inventoryCategories.id, id)))
      .limit(1);
    if (!row) throw new Error("التصنيف غير موجود");
    return row;
  }
  const [row] = await db
    .update(inventoryCategories)
    .set(set)
    .where(and(eq(inventoryCategories.companyId, companyId), eq(inventoryCategories.id, id)))
    .returning();
  if (!row) throw new Error("التصنيف غير موجود");
  return row;
}

export async function deleteCategory(companyId: number, id: number) {
  // Reject delete if any product still points at this category — better
  // than ON DELETE SET NULL silently nulling the link without telling
  // the user.
  const [linked] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(and(eq(products.companyId, companyId), eq(products.categoryId, id)));
  if ((linked?.count ?? 0) > 0) {
    throw Object.assign(new Error("التصنيف مرتبط بأصناف، أزل الربط أولاً"), { status: 409 });
  }
  const result = await db
    .delete(inventoryCategories)
    .where(and(eq(inventoryCategories.companyId, companyId), eq(inventoryCategories.id, id)))
    .returning({ id: inventoryCategories.id });
  if (result.length === 0) throw new Error("التصنيف غير موجود");
}

// ---------------------------------------------------------------------------
// CRUD: locations
// ---------------------------------------------------------------------------

export async function listLocations(companyId: number) {
  return db
    .select()
    .from(inventoryLocations)
    .where(eq(inventoryLocations.companyId, companyId))
    .orderBy(desc(inventoryLocations.isDefault), asc(inventoryLocations.nameAr));
}

export async function createLocation(
  companyId: number,
  input: { nameAr: string; nameEn?: string | null; isDefault?: boolean },
) {
  return db.transaction(async (tx) => {
    if (input.isDefault) {
      // Single-default invariant: clear any existing default in the same
      // workspace before flipping ours on.
      await tx
        .update(inventoryLocations)
        .set({ isDefault: false })
        .where(and(eq(inventoryLocations.companyId, companyId), eq(inventoryLocations.isDefault, true)));
    }
    // If the workspace currently has no default, force this one to be it
    // so `resolveDefaultLocation` always succeeds for the first row.
    let isDefault = !!input.isDefault;
    if (!isDefault) {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(inventoryLocations)
        .where(eq(inventoryLocations.companyId, companyId));
      if (count === 0) isDefault = true;
    }
    const [row] = await tx
      .insert(inventoryLocations)
      .values({
        companyId,
        nameAr: input.nameAr.trim(),
        nameEn: input.nameEn?.trim() ?? "",
        address: "",
        isDefault,
      })
      .returning();
    return row;
  });
}

export async function updateLocation(
  companyId: number,
  id: number,
  input: { nameAr?: string; nameEn?: string | null; isDefault?: boolean },
) {
  return db.transaction(async (tx) => {
    if (input.isDefault === true) {
      await tx
        .update(inventoryLocations)
        .set({ isDefault: false })
        .where(and(eq(inventoryLocations.companyId, companyId), eq(inventoryLocations.isDefault, true)));
    }
    const set: Record<string, unknown> = {};
    if (input.nameAr !== undefined) set.nameAr = input.nameAr.trim();
    if (input.nameEn !== undefined) set.nameEn = input.nameEn?.trim() ?? null;
    if (input.isDefault !== undefined) set.isDefault = input.isDefault;
    const [row] = await tx
      .update(inventoryLocations)
      .set(set)
      .where(and(eq(inventoryLocations.companyId, companyId), eq(inventoryLocations.id, id)))
      .returning();
    if (!row) throw new Error("المخزن غير موجود");
    // Always keep at least one default in the workspace.
    const [{ count: defaults }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(inventoryLocations)
      .where(and(eq(inventoryLocations.companyId, companyId), eq(inventoryLocations.isDefault, true)));
    if (defaults === 0) {
      await tx
        .update(inventoryLocations)
        .set({ isDefault: true })
        .where(and(eq(inventoryLocations.companyId, companyId), eq(inventoryLocations.id, row.id)));
      row.isDefault = true;
    }
    return row;
  });
}

export async function deleteLocation(companyId: number, id: number) {
  // Block delete if any layer/level/txn still references this location.
  const [{ count: layerCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryCostLayers)
    .where(and(eq(inventoryCostLayers.companyId, companyId), eq(inventoryCostLayers.locationId, id)));
  if (layerCount > 0) {
    throw Object.assign(new Error("لا يمكن حذف المخزن لوجود طبقات تكلفة"), { status: 409 });
  }
  const [{ count: levelCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryStockLevels)
    .where(
      and(
        eq(inventoryStockLevels.companyId, companyId),
        eq(inventoryStockLevels.locationId, id),
        sql`${inventoryStockLevels.qty} > 0`,
      ),
    );
  if (levelCount > 0) {
    throw Object.assign(new Error("لا يمكن حذف المخزن لوجود رصيد"), { status: 409 });
  }
  // Defensive: refuse to delete the last default.
  const [hdr] = await db
    .select()
    .from(inventoryLocations)
    .where(and(eq(inventoryLocations.companyId, companyId), eq(inventoryLocations.id, id)))
    .limit(1);
  if (!hdr) throw new Error("المخزن غير موجود");
  if (hdr.isDefault) {
    const [{ count: total }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventoryLocations)
      .where(eq(inventoryLocations.companyId, companyId));
    if (total <= 1) {
      throw Object.assign(new Error("لا يمكن حذف المخزن الافتراضي الوحيد"), { status: 409 });
    }
  }
  await db
    .delete(inventoryLocations)
    .where(and(eq(inventoryLocations.companyId, companyId), eq(inventoryLocations.id, id)));
}

// ---------------------------------------------------------------------------
// Read-side: stock levels, alerts, valuation
// ---------------------------------------------------------------------------

export interface StockLevelView {
  productId: number;
  productSku: string;
  productNameAr: string;
  productNameEn: string | null;
  unit: string;
  minimumStock: string;
  costingMethod: InventoryCostingMethod;
  locationId: number;
  locationNameAr: string;
  locationNameEn: string | null;
  qty: string;
  avgCost: string;
}

export async function listStockLevels(companyId: number): Promise<StockLevelView[]> {
  const rows = await db
    .select({
      productId: products.id,
      productSku: products.sku,
      productNameAr: products.nameAr,
      productNameEn: products.nameEn,
      unit: products.unit,
      minimumStock: products.minimumStock,
      costingMethod: products.costingMethod,
      locationId: inventoryStockLevels.locationId,
      locationNameAr: inventoryLocations.nameAr,
      locationNameEn: inventoryLocations.nameEn,
      qty: inventoryStockLevels.qty,
      avgCost: inventoryStockLevels.avgCost,
    })
    .from(inventoryStockLevels)
    .innerJoin(
      products,
      and(
        eq(inventoryStockLevels.productId, products.id),
        eq(inventoryStockLevels.companyId, products.companyId),
      ),
    )
    .innerJoin(
      inventoryLocations,
      and(
        eq(inventoryStockLevels.locationId, inventoryLocations.id),
        eq(inventoryStockLevels.companyId, inventoryLocations.companyId),
      ),
    )
    .where(eq(inventoryStockLevels.companyId, companyId))
    .orderBy(asc(products.nameAr), asc(inventoryLocations.nameAr));
  return rows as unknown as StockLevelView[];
}

export interface AlertRow {
  productId: number;
  productSku: string;
  productNameAr: string;
  productNameEn: string | null;
  unit: string;
  minimumStock: string;
  totalQty: string;
  shortageQty: string;
}

export async function listLowStockAlerts(companyId: number): Promise<AlertRow[]> {
  // Aggregate across all locations and compare against the per-product
  // minimumStock threshold. Service products / items with min == 0 are
  // excluded.
  const rows = await db
    .select({
      productId: products.id,
      productSku: products.sku,
      productNameAr: products.nameAr,
      productNameEn: products.nameEn,
      unit: products.unit,
      minimumStock: products.minimumStock,
      totalQty: sql<string>`coalesce(sum(${inventoryStockLevels.qty}), 0)::text`,
    })
    .from(products)
    .leftJoin(
      inventoryStockLevels,
      and(
        eq(inventoryStockLevels.productId, products.id),
        eq(inventoryStockLevels.companyId, products.companyId),
      ),
    )
    .where(
      and(
        eq(products.companyId, companyId),
        eq(products.isService, false),
        sql`${products.minimumStock}::numeric > 0`,
      ),
    )
    .groupBy(
      products.id,
      products.sku,
      products.nameAr,
      products.nameEn,
      products.unit,
      products.minimumStock,
    )
    .having(sql`coalesce(sum(${inventoryStockLevels.qty}), 0) < ${products.minimumStock}::numeric`)
    .orderBy(asc(products.nameAr));
  return rows.map((r) => ({
    ...r,
    shortageQty: (Number(r.minimumStock) - Number(r.totalQty)).toFixed(4),
  }));
}

export interface ValuationRow {
  productId: number;
  productSku: string;
  productNameAr: string;
  productNameEn: string | null;
  unit: string;
  costingMethod: InventoryCostingMethod;
  totalQty: string;
  totalValue: string;
}

export async function getValuationReport(
  companyId: number,
): Promise<{ rows: ValuationRow[]; grandTotalQty: string; grandTotalValue: string }> {
  // For FIFO: sum (remainingQty * unitCost) over open layers.
  // For Avg : sum (qty * avgCost) over stock levels.
  // We build a unified per-product roll-up by computing both and picking
  // the one that matches each product's costing method.
  const fifoAgg = await db
    .select({
      productId: inventoryCostLayers.productId,
      qty: sql<string>`coalesce(sum(${inventoryCostLayers.remainingQty}), 0)::text`,
      value: sql<string>`coalesce(sum(${inventoryCostLayers.remainingQty} * ${inventoryCostLayers.unitCost}), 0)::text`,
    })
    .from(inventoryCostLayers)
    .where(
      and(
        eq(inventoryCostLayers.companyId, companyId),
        sql`${inventoryCostLayers.remainingQty} > 0`,
      ),
    )
    .groupBy(inventoryCostLayers.productId);
  const avgAgg = await db
    .select({
      productId: inventoryStockLevels.productId,
      qty: sql<string>`coalesce(sum(${inventoryStockLevels.qty}), 0)::text`,
      value: sql<string>`coalesce(sum(${inventoryStockLevels.qty} * ${inventoryStockLevels.avgCost}), 0)::text`,
    })
    .from(inventoryStockLevels)
    .where(eq(inventoryStockLevels.companyId, companyId))
    .groupBy(inventoryStockLevels.productId);
  const fifoMap = new Map(fifoAgg.map((r) => [r.productId, r]));
  const avgMap = new Map(avgAgg.map((r) => [r.productId, r]));
  const productRows = await db
    .select({
      id: products.id,
      sku: products.sku,
      nameAr: products.nameAr,
      nameEn: products.nameEn,
      unit: products.unit,
      costingMethod: products.costingMethod,
    })
    .from(products)
    .where(and(eq(products.companyId, companyId), eq(products.isService, false)))
    .orderBy(asc(products.nameAr));
  const settingsRow = await db
    .select({ defaultCostingMethod: settings.defaultCostingMethod })
    .from(settings)
    .where(eq(settings.companyId, companyId))
    .limit(1);
  const wsDefault = (settingsRow[0]?.defaultCostingMethod ?? "fifo") as InventoryCostingMethod;
  const rows: ValuationRow[] = [];
  let grandQty = 0;
  let grandValue = 0;
  for (const p of productRows) {
    const method = (p.costingMethod ?? wsDefault) as InventoryCostingMethod;
    const src = method === "fifo" ? fifoMap.get(p.id) : avgMap.get(p.id);
    const qty = Number(src?.qty ?? 0);
    const value = Number(src?.value ?? 0);
    if (qty === 0 && value === 0) continue;
    rows.push({
      productId: p.id,
      productSku: p.sku,
      productNameAr: p.nameAr,
      productNameEn: p.nameEn,
      unit: p.unit,
      costingMethod: method,
      totalQty: qty.toFixed(4),
      totalValue: value.toFixed(2),
    });
    grandQty += qty;
    grandValue += value;
  }
  return {
    rows,
    grandTotalQty: grandQty.toFixed(4),
    grandTotalValue: grandValue.toFixed(2),
  };
}
