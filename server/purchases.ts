/**
 * Purchases-portal business logic — task #368.
 *
 * Mirrors `server/sales.ts` for the AP side of the ledger:
 *
 *   draft  ─ post ─►  posted  ─ cancel ─►  cancelled
 *      │                │
 *      └ delete ────────┴ delete (reverses + removes)
 *
 * Posting builds and writes a balanced journal entry through
 * `storage.createJournalEntry`, then atomically links it to the bill and
 * (for goods lines) increments stock via the inventory engine. Cancel /
 * delete on a posted bill go through the shared
 * `reverseAutoPostedJournalEntry` helper inside
 * `storage.reversePurchaseInvoicePosting`, which composes with
 * `reversePurchaseInbound` so the inbound layer is walked back atomically.
 *
 * AP payments use the same recipe: create the payment + allocations (each
 * allocation bumps the target bill's `paidAmount`), then build a single
 * Dr AP / Cr Cash JE and link it via `markPurchasePaymentPosted`.
 */
import { db } from "./db";
import {
  accounts,
  products,
  type Vendor,
  type CreatePurchaseInvoiceInput,
  type UpdatePurchaseInvoiceInput,
  type PurchaseInvoiceWithLines,
  type PurchasePaymentWithAllocations,
  type CreatePurchasePaymentInput,
  type PurchaseInvoicePaymentMethod,
} from "@shared/schema";
import {
  AP_ACCOUNT_CODE,
  CASH_ACCOUNT_CODE,
  INVENTORY_ACCOUNT_CODE,
  VAT_RECOVERABLE_CODE,
  pickExpenseAccountCode,
} from "@shared/coa-seed";
import { storage, type AuditContext } from "./storage";
import { and, eq, inArray } from "drizzle-orm";
import {
  applyPurchaseInboundStandalone,
  linkPurchaseTransactionToJournalEntry,
  reversePurchaseInboundStandalone,
} from "./inventory";

interface NormalisedLine {
  productId: number | null;
  description: string;
  quantity: number;
  unitCost: number;
  vatRate: number;
  isService: boolean;       // service / free-form lines bypass the inventory engine
  expenseAccountCode: string; // empty → derived from description at post time
  // Computed:
  lineSubtotal: number;
  lineVat: number;
  lineTotal: number;
}

interface NormalisedInvoice {
  lines: NormalisedLine[];
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Loads the products referenced by `lines`, filling in `isService` and a
 * sensible default `unitCost` from the catalog when the input doesn't
 * carry them. Throws with a clear Arabic message if a referenced
 * productId doesn't belong to this workspace — defence-in-depth on top of
 * the composite FK that `purchase_invoice_lines` already declares.
 */
async function normaliseLines(
  companyId: number,
  rawLines: CreatePurchaseInvoiceInput["lines"],
  fallbackVatRate: number,
): Promise<NormalisedLine[]> {
  const productIds = Array.from(
    new Set(
      rawLines
        .map((l) => l.productId ?? null)
        .filter((v): v is number => v != null),
    ),
  );
  const productRows = productIds.length === 0
    ? []
    : await db
        .select()
        .from(products)
        .where(
          and(eq(products.companyId, companyId), inArray(products.id, productIds)),
        );
  const productById = new Map(productRows.map((p) => [p.id, p]));

  return rawLines.map<NormalisedLine>((l) => {
    const productId = l.productId ?? null;
    const prod = productId ? productById.get(productId) : undefined;
    if (productId && !prod) {
      throw new Error(`المنتج (${productId}) غير موجود في هذا الحساب`);
    }
    const vatRate = l.vatRate != null
      ? Number(l.vatRate)
      : prod?.vatRate != null
        ? Number(prod.vatRate)
        : fallbackVatRate;
    const unitCost = l.unitCost != null && Number(l.unitCost) >= 0
      ? Number(l.unitCost)
      : prod
        ? Number(prod.unitCost)
        : 0;
    // Free-form lines (productId=null) are always treated as expense lines
    // — they never decrement / increment stock and post to the resolved
    // expense account at posting time.
    const isService = prod ? prod.isService : true;
    const quantity = Number(l.quantity);

    const lineSubtotal = round2(quantity * unitCost);
    const lineVat = round2(lineSubtotal * vatRate);
    const lineTotal = round2(lineSubtotal + lineVat);

    return {
      productId,
      description: l.description ?? (prod ? prod.nameAr : ""),
      quantity,
      unitCost,
      vatRate,
      isService,
      expenseAccountCode: l.expenseAccountCode ?? "",
      lineSubtotal,
      lineVat,
      lineTotal,
    };
  });
}

function totalsFromLines(lines: NormalisedLine[]): NormalisedInvoice {
  let subtotal = 0;
  let vatAmount = 0;
  let totalAmount = 0;
  for (const l of lines) {
    subtotal += l.lineSubtotal;
    vatAmount += l.lineVat;
    totalAmount += l.lineTotal;
  }
  return {
    lines,
    subtotal: round2(subtotal),
    vatAmount: round2(vatAmount),
    totalAmount: round2(totalAmount),
  };
}

async function assertVendorOwned(companyId: number, vendorId: number): Promise<Vendor> {
  const v = await storage.getVendor(companyId, vendorId);
  if (!v) throw new Error(`المورد (${vendorId}) غير موجود في هذا الحساب`);
  return v;
}

async function workspaceVatRate(companyId: number): Promise<number> {
  const settings = await storage.getSettings(companyId);
  return Number(settings.vatRate);
}

/**
 * Creates a draft (or, when `status === 'posted'`, immediately posts) a
 * purchase invoice. Returns the fully hydrated bill — the same shape
 * `GET /api/purchases/bills/:id` produces, so the create dialog can
 * render the result without a second request.
 */
export async function createPurchaseInvoice(
  companyId: number,
  input: CreatePurchaseInvoiceInput,
  ctx?: AuditContext,
): Promise<PurchaseInvoiceWithLines> {
  await assertVendorOwned(companyId, input.vendorId);
  const fallbackVat = await workspaceVatRate(companyId);
  const normalisedLines = await normaliseLines(companyId, input.lines, fallbackVat);
  const totals = totalsFromLines(normalisedLines);
  const number = await storage.getNextPurchaseInvoiceNumber(companyId);

  const draft = await storage.createDraftPurchaseInvoice(
    companyId,
    {
      number,
      vendorId: input.vendorId,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate ?? null,
      paymentMethod: input.paymentMethod,
      vendorReference: input.vendorReference ?? "",
      notes: input.notes ?? "",
      subtotal: totals.subtotal,
      vatAmount: totals.vatAmount,
      totalAmount: totals.totalAmount,
    },
    totals.lines.map((l) => ({
      productId: l.productId,
      description: l.description,
      quantity: l.quantity,
      unitCost: l.unitCost,
      vatRate: l.vatRate,
      lineSubtotal: l.lineSubtotal,
      lineVat: l.lineVat,
      lineTotal: l.lineTotal,
      expenseAccountCode: l.expenseAccountCode,
    })),
    ctx,
  );

  if (input.status === "posted") {
    return await postPurchaseInvoice(companyId, draft.id, ctx);
  }
  const hydrated = await storage.getPurchaseInvoice(companyId, draft.id);
  return hydrated ?? draft;
}

export async function updatePurchaseInvoice(
  companyId: number,
  id: number,
  input: UpdatePurchaseInvoiceInput,
  ctx?: AuditContext,
): Promise<PurchaseInvoiceWithLines> {
  const existing = await storage.getPurchaseInvoice(companyId, id);
  if (!existing) throw new Error("الفاتورة غير موجودة");
  if (existing.status !== "draft") {
    throw new Error("لا يمكن تعديل فاتورة بعد ترحيلها — قم بإلغاءها وإنشاء جديدة");
  }
  if (input.vendorId !== undefined) {
    await assertVendorOwned(companyId, input.vendorId);
  }
  const fallbackVat = await workspaceVatRate(companyId);
  const sourceLines = input.lines
    ? input.lines
    : existing.lines.map((l) => ({
        productId: l.productId ?? null,
        description: l.description,
        quantity: Number(l.quantity),
        unitCost: Number(l.unitCost),
        vatRate: Number(l.vatRate),
        expenseAccountCode: l.expenseAccountCode ?? "",
      }));
  const normalisedLines = await normaliseLines(
    companyId,
    sourceLines as CreatePurchaseInvoiceInput["lines"],
    fallbackVat,
  );
  const totals = totalsFromLines(normalisedLines);

  await storage.updateDraftPurchaseInvoice(
    companyId,
    id,
    {
      vendorId: input.vendorId,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate ?? undefined,
      paymentMethod: input.paymentMethod,
      vendorReference: input.vendorReference,
      notes: input.notes,
      subtotal: totals.subtotal,
      vatAmount: totals.vatAmount,
      totalAmount: totals.totalAmount,
    },
    totals.lines.map((l) => ({
      productId: l.productId,
      description: l.description,
      quantity: l.quantity,
      unitCost: l.unitCost,
      vatRate: l.vatRate,
      lineSubtotal: l.lineSubtotal,
      lineVat: l.lineVat,
      lineTotal: l.lineTotal,
      expenseAccountCode: l.expenseAccountCode,
    })),
    ctx,
  );
  if (input.status === "posted") {
    return await postPurchaseInvoice(companyId, id, ctx);
  }
  const hydrated = await storage.getPurchaseInvoice(companyId, id);
  return hydrated!;
}

/**
 * Builds and writes the posting JE, then atomically links it + the
 * inventory inbound through `storage.markPurchaseInvoicePosted`. The
 * orphan-JE failure mode is the same as sales: a JE that fails to link
 * stays visible in the journal as a record of the failed attempt and the
 * next post creates a fresh one.
 */
export async function postPurchaseInvoice(
  companyId: number,
  invoiceId: number,
  ctx?: AuditContext,
): Promise<PurchaseInvoiceWithLines> {
  const inv = await storage.getPurchaseInvoice(companyId, invoiceId);
  if (!inv) throw new Error("الفاتورة غير موجودة");
  if (inv.status !== "draft") throw new Error("لا يمكن ترحيل فاتورة بهذه الحالة");
  if (inv.lines.length === 0) throw new Error("الفاتورة لا تحتوي على بنود");

  const vendor = await assertVendorOwned(companyId, inv.vendorId);

  // Resolve the CoA codes once, in a single round-trip.
  const allAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.companyId, companyId));
  const idOf = (code: string): number => {
    const a = allAccounts.find((x) => x.code === code);
    if (!a) {
      throw new Error(
        `حساب رقم (${code}) غير موجود — قم بإعادة تشغيل /api/accounts/seed لإنشاء الدليل المحاسبي القياسي.`,
      );
    }
    return a.id;
  };

  // Classify each line as goods (inventory inbound + Dr Inventory) or
  // service / expense (Dr <expense account>). Free-form lines (productId=null)
  // and service products always take the expense path.
  const allProductIds = inv.lines
    .map((l) => l.productId)
    .filter((v): v is number => v != null);
  const productCatalog = allProductIds.length === 0
    ? []
    : await db
        .select({
          id: products.id,
          isService: products.isService,
          nameAr: products.nameAr,
        })
        .from(products)
        .where(and(eq(products.companyId, companyId), inArray(products.id, allProductIds)));
  const isServiceById = new Map(productCatalog.map((p) => [p.id, p.isService]));

  const goodsLinesForEngine: Array<{
    productId: number;
    quantity: number;
    unitCost: number;
  }> = [];
  // Sum service-line subtotals per expense account so we can collapse
  // them into one JE leg per account (keeps the ledger tidy).
  const expenseSubtotalByAccount = new Map<string, number>();
  let inventorySubtotal = 0; // running Dr-inventory total derived from line cost
  for (const l of inv.lines) {
    const qty = Number(l.quantity);
    const lineSubtotal = Number(l.lineSubtotal);
    const isInventoryLine =
      l.productId != null && !isServiceById.get(l.productId) && qty > 0;
    if (isInventoryLine) {
      goodsLinesForEngine.push({
        productId: l.productId!,
        quantity: qty,
        unitCost: Number(l.unitCost),
      });
      inventorySubtotal = round2(inventorySubtotal + lineSubtotal);
    } else {
      const code = l.expenseAccountCode && l.expenseAccountCode.trim().length > 0
        ? l.expenseAccountCode.trim()
        : pickExpenseAccountCode("", l.description ?? "");
      expenseSubtotalByAccount.set(
        code,
        round2((expenseSubtotalByAccount.get(code) ?? 0) + lineSubtotal),
      );
    }
  }

  // Run the inventory engine before we touch the JE so a failed inbound
  // (e.g. a service product mis-classified) surfaces *before* we leave a
  // stale JE behind. Service-only bills get an empty engine call.
  const inbound = await applyPurchaseInboundStandalone(companyId, {
    invoiceId,
    invoiceNumber: inv.number,
    invoiceDate: inv.invoiceDate,
    vendorName: vendor.nameAr,
    lines: goodsLinesForEngine,
  });
  // Reconcile the inventory subtotal with the engine's total. We use the
  // engine's value (which mirrors the unit costs we already wrote) so the
  // Dr Inventory leg matches the FIFO layer's recorded cost exactly.
  if (Math.abs(inbound.inboundCost - inventorySubtotal) > 0.01) {
    inventorySubtotal = round2(inbound.inboundCost);
  }

  const subtotal = Number(inv.subtotal);
  const vatAmount = Number(inv.vatAmount);
  const totalAmount = Number(inv.totalAmount);

  // Build journal lines:
  //   Dr Inventory (1300)            inventorySubtotal   — per goods
  //   Dr <Expense> (6xxx / 5xxx)     per service-line bucket
  //   Dr VAT Recoverable (1230)      vatAmount           — only if > 0
  //   Cr AP (2110) | Cash (1110)     totalAmount         — single credit
  //
  // Precedence: the AR mirror on the sale side credits a single revenue
  // account; here we have the symmetric situation but expense lines may
  // route to multiple expense codes, so we emit one Dr leg per code.
  const lines: Array<{
    accountId: number;
    debit: number;
    credit: number;
    description: string;
  }> = [];
  if (inventorySubtotal > 0.0001) {
    lines.push({
      accountId: idOf(INVENTORY_ACCOUNT_CODE),
      debit: inventorySubtotal,
      credit: 0,
      description: `إدخال مخزون — فاتورة شراء ${inv.number}`,
    });
  }
  for (const [code, amount] of Array.from(expenseSubtotalByAccount.entries())) {
    if (amount <= 0.0001) continue;
    lines.push({
      accountId: idOf(code),
      debit: amount,
      credit: 0,
      description: `مصروف — فاتورة شراء ${inv.number}`,
    });
  }
  if (vatAmount > 0.0001) {
    lines.push({
      accountId: idOf(VAT_RECOVERABLE_CODE),
      debit: vatAmount,
      credit: 0,
      description: `ض.ق.م قابلة للاسترداد — ${inv.number}`,
    });
  }
  const creditCode =
    inv.paymentMethod === "cash" ? CASH_ACCOUNT_CODE : AP_ACCOUNT_CODE;
  const creditDescription =
    inv.paymentMethod === "cash"
      ? `سداد نقدي للمورد ${vendor.nameAr} — ${inv.number}`
      : `استحقاق للمورد ${vendor.nameAr} — ${inv.number}`;
  lines.push({
    accountId: idOf(creditCode),
    debit: 0,
    credit: totalAmount,
    description: creditDescription,
  });

  // Sanity-check the JE balances before we ask storage to accept it.
  const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredits = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    if (inbound.transactionId != null) {
      try {
        await reversePurchaseInboundStandalone(companyId, invoiceId);
      } catch {
        /* swallow — the balance error below is more informative */
      }
    }
    throw new Error(
      `قيد الفاتورة غير متوازن (مدين ${totalDebits.toFixed(2)} ≠ دائن ${totalCredits.toFixed(2)})`,
    );
  }

  let je;
  try {
    je = await storage.createJournalEntry(
      companyId,
      {
        entryDate: inv.invoiceDate,
        description: `فاتورة شراء ${inv.number} — ${vendor.nameAr}`,
        source: "manual",
        lines,
      },
      ctx,
    );
  } catch (jeErr) {
    if (inbound.transactionId != null) {
      try {
        await reversePurchaseInboundStandalone(companyId, invoiceId);
      } catch {
        /* swallow — the JE error is more informative */
      }
    }
    throw jeErr;
  }

  // Bidirectionally link the JE id onto the engine's ITX row so the
  // ledger and the inventory transaction reference each other.
  if (inbound.transactionId != null) {
    await linkPurchaseTransactionToJournalEntry(companyId, inbound.transactionId, je.id);
  }

  await storage.markPurchaseInvoicePosted(companyId, invoiceId, je.id, ctx);
  const refreshed = await storage.getPurchaseInvoice(companyId, invoiceId);
  return refreshed!;
}

/**
 * Cancel a posted bill: reverses the JE, walks back the inventory
 * inbound, and flips the row to status='cancelled'. Refuses (409 in the
 * route layer) if there are AP-payment allocations against the bill —
 * those have to be reversed first.
 */
export async function cancelPurchaseInvoice(
  companyId: number,
  invoiceId: number,
  ctx?: AuditContext,
): Promise<PurchaseInvoiceWithLines> {
  const inv = await storage.getPurchaseInvoice(companyId, invoiceId);
  if (!inv) throw new Error("الفاتورة غير موجودة");
  if (inv.status === "cancelled") return inv;
  if (inv.status !== "posted") {
    throw new Error("يمكن إلغاء الفواتير المرحّلة فقط");
  }
  await storage.reversePurchaseInvoicePosting(companyId, invoiceId, "cancel", ctx);
  const refreshed = await storage.getPurchaseInvoice(companyId, invoiceId);
  return refreshed!;
}

export async function deletePurchaseInvoice(
  companyId: number,
  invoiceId: number,
  ctx?: AuditContext,
): Promise<void> {
  const inv = await storage.getPurchaseInvoice(companyId, invoiceId);
  if (!inv) return;
  if (inv.status === "posted") {
    await storage.reversePurchaseInvoicePosting(companyId, invoiceId, "delete", ctx);
    return;
  }
  await storage.deleteDraftOrCancelledPurchaseInvoice(companyId, invoiceId, ctx);
}

// ---------------------------------------------------------------------------
// AP payments — multi-bill allocation
// ---------------------------------------------------------------------------

/**
 * Records a multi-bill AP payment: writes the payment header, the
 * allocation rows, bumps each target bill's `paidAmount`, then writes a
 * single Dr AP / Cr Cash JE and links it. All steps are atomic in
 * `storage.createPurchasePayment` + `markPurchasePaymentPosted` — a JE
 * failure leaves an unposted payment row that can be retried or deleted.
 */
export async function createPurchasePayment(
  companyId: number,
  input: CreatePurchasePaymentInput,
  ctx?: AuditContext,
): Promise<PurchasePaymentWithAllocations> {
  const vendor = await assertVendorOwned(companyId, input.vendorId);
  if (input.allocations.length === 0) {
    throw new Error("يجب تحديد فاتورة واحدة على الأقل");
  }

  // Validate every allocation's bill belongs to this vendor + workspace +
  // is posted, and that the allocated amount doesn't exceed the bill's
  // open balance.
  for (const alloc of input.allocations) {
    const bill = await storage.getPurchaseInvoice(companyId, alloc.invoiceId);
    if (!bill) throw new Error(`الفاتورة (${alloc.invoiceId}) غير موجودة`);
    if (bill.vendorId !== input.vendorId) {
      throw new Error(`الفاتورة ${bill.number} ليست لهذا المورد`);
    }
    if (bill.status !== "posted") {
      throw new Error(`الفاتورة ${bill.number} غير مرحّلة`);
    }
    if (bill.paymentMethod !== "credit") {
      throw new Error(`الفاتورة ${bill.number} نقدية ولا تحتاج سداد`);
    }
    const open = round2(Number(bill.totalAmount) - Number(bill.paidAmount));
    if (alloc.amount > open + 0.01) {
      throw new Error(
        `مبلغ التخصيص (${alloc.amount.toFixed(2)}) أكبر من الرصيد المفتوح للفاتورة ${bill.number} (${open.toFixed(2)})`,
      );
    }
  }

  const totalAmount = round2(
    input.allocations.reduce((s, a) => s + Number(a.amount), 0),
  );
  const number = await storage.getNextPurchasePaymentNumber(companyId);

  const draft = await storage.createPurchasePayment(
    companyId,
    {
      number,
      vendorId: input.vendorId,
      paymentDate: input.paymentDate,
      amount: totalAmount,
      notes: input.notes ?? "",
    },
    input.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: Number(a.amount) })),
    ctx,
  );

  // Build the AP payment JE: Dr AP / Cr Cash.
  const allAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.companyId, companyId));
  const idOf = (code: string): number => {
    const a = allAccounts.find((x) => x.code === code);
    if (!a) {
      throw new Error(
        `حساب رقم (${code}) غير موجود — قم بإعادة تشغيل /api/accounts/seed لإنشاء الدليل المحاسبي القياسي.`,
      );
    }
    return a.id;
  };

  let je;
  try {
    je = await storage.createJournalEntry(
      companyId,
      {
        entryDate: input.paymentDate,
        description: `سداد للمورد ${vendor.nameAr} — ${number}`,
        source: "manual",
        lines: [
          {
            accountId: idOf(AP_ACCOUNT_CODE),
            debit: totalAmount,
            credit: 0,
            description: `تسوية ذمم دائنة — ${number}`,
          },
          {
            accountId: idOf(CASH_ACCOUNT_CODE),
            debit: 0,
            credit: totalAmount,
            description: `سداد نقدي — ${number}`,
          },
        ],
      },
      ctx,
    );
  } catch (jeErr) {
    // The payment header + allocation bumps already landed; reverse them
    // so we don't leave bills marked partially paid against a JE-less
    // payment row.
    try {
      await storage.reversePurchasePayment(companyId, draft.id, ctx);
    } catch {
      /* swallow — the JE error is more informative */
    }
    throw jeErr;
  }

  await storage.markPurchasePaymentPosted(companyId, draft.id, je.id, ctx);
  const refreshed = await storage.getPurchasePayment(companyId, draft.id);
  return refreshed!;
}

export async function reversePurchasePayment(
  companyId: number,
  paymentId: number,
  ctx?: AuditContext,
): Promise<void> {
  const pay = await storage.getPurchasePayment(companyId, paymentId);
  if (!pay) throw new Error("سند الدفع غير موجود");
  if (pay.status !== "posted") return;
  await storage.reversePurchasePayment(companyId, paymentId, ctx);
}

export type { PurchaseInvoicePaymentMethod };
