/**
 * Sales-portal business logic — task #301.
 *
 * Lives in its own module (mirroring `server/payroll.ts` and the asset-event
 * helpers) so the data layer in `server/storage.ts` stays free of CoA / VAT
 * / pricing logic. Exposes the lifecycle a sales invoice goes through:
 *
 *   draft  ─ post ─►  posted  ─ cancel ─►  cancelled
 *      │                │
 *      └ delete ────────┴ delete (reverses + removes)
 *
 * Posting builds and writes a balanced journal entry through
 * `storage.createJournalEntry`, then atomically links it to the invoice and
 * decrements stock for goods lines via `storage.markSalesInvoicePosted`.
 *
 * Cancel / delete on a posted invoice both go through the shared
 * `reverseAutoPostedJournalEntry` helper (the same one payroll runs and
 * fixed-asset events use) — guaranteeing a posted JE never goes away
 * silently and that a downstream reference (e.g. a bank reconciliation) on
 * the JE blocks the reversal with a clear 409.
 */
import { db } from "./db";
import {
  accounts,
  customers,
  products,
  type Customer,
  type CreateSalesInvoiceInput,
  type UpdateSalesInvoiceInput,
  type SalesInvoiceWithLines,
  type SalesInvoicePaymentMethod,
} from "@shared/schema";
import { storage, type AuditContext } from "./storage";
import { and, eq, inArray } from "drizzle-orm";

// Standard chart-of-accounts codes that the auto-posting JE references.
// All five codes are part of the default seed (`shared/coa-seed.ts`); if a
// workspace is missing one of them we surface a clear error rather than
// silently skipping the leg, the same convention `runPayroll` uses.
const AR_ACCOUNT_CODE = "1210";       // Accounts Receivable — العملاء
const CASH_ACCOUNT_CODE = "1110";     // Cash on hand — الصندوق
const SALES_ACCOUNT_CODE = "4100";    // Sales Revenue — إيرادات المبيعات
const VAT_PAYABLE_CODE = "2130";      // VAT Payable — ضريبة القيمة المضافة المستحقة
const COGS_ACCOUNT_CODE = "5100";     // Cost of Goods Sold — تكلفة البضاعة المباعة
const INVENTORY_CODE = "1300";        // Inventory — المخزون

interface NormalisedLine {
  productId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  unitCost: number;
  isService: boolean;
  // Computed:
  lineSubtotal: number;
  lineVat: number;
  lineTotal: number;
  costAmount: number;
}

interface NormalisedInvoice {
  lines: NormalisedLine[];
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  cogsAmount: number;
}

/**
 * Round a currency amount to 2 decimal places using banker's-style toFixed.
 * The header-level `subtotal`, `vatAmount`, etc. are computed from the
 * already-rounded line values so the JE balance check (debits === credits)
 * is honoured exactly without any per-line rounding drift.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Loads the products referenced by `lines`, filling in `unitCost` /
 * `isService` from the catalog when the input doesn't carry them. Throws
 * with a clear Arabic message if a referenced productId doesn't belong to
 * this workspace — defence-in-depth on top of the composite FK that
 * `sales_invoice_lines` already declares to `products(id, company_id)`.
 */
async function normaliseLines(
  companyId: number,
  rawLines: CreateSalesInvoiceInput["lines"],
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
          and(
            eq(products.companyId, companyId),
            inArray(products.id, productIds),
          ),
        );
  const productById = new Map(productRows.map((p) => [p.id, p]));

  return rawLines.map<NormalisedLine>((l) => {
    const productId = l.productId ?? null;
    const prod = productId ? productById.get(productId) : undefined;
    if (productId && !prod) {
      throw new Error(`المنتج (${productId}) غير موجود في هذا الحساب`);
    }
    // Per-line VAT precedence: explicit input → product override → workspace
    // default. The form preselects the product's vatRate on selection so the
    // common case is "explicit input == product rate" and the fallback chain
    // is mostly for AI-driven invoice creation.
    const vatRate = l.vatRate != null
      ? Number(l.vatRate)
      : prod?.vatRate != null
        ? Number(prod.vatRate)
        : fallbackVatRate;
    const unitCost = l.unitCost != null && Number(l.unitCost) > 0
      ? Number(l.unitCost)
      : prod
        ? Number(prod.unitCost)
        : 0;
    const isService = prod ? prod.isService : true; // free-form lines never decrement stock
    const quantity = Number(l.quantity);
    const unitPrice = Number(l.unitPrice);

    const lineSubtotal = round2(quantity * unitPrice);
    const lineVat = round2(lineSubtotal * vatRate);
    const lineTotal = round2(lineSubtotal + lineVat);
    const costAmount = round2(quantity * unitCost);

    return {
      productId,
      description: l.description ?? (prod ? prod.nameAr : ""),
      quantity,
      unitPrice,
      vatRate,
      unitCost,
      isService,
      lineSubtotal,
      lineVat,
      lineTotal,
      costAmount,
    };
  });
}

function totalsFromLines(lines: NormalisedLine[]): NormalisedInvoice {
  let subtotal = 0;
  let vatAmount = 0;
  let totalAmount = 0;
  let cogsAmount = 0;
  for (const l of lines) {
    subtotal += l.lineSubtotal;
    vatAmount += l.lineVat;
    totalAmount += l.lineTotal;
    cogsAmount += l.costAmount;
  }
  return {
    lines,
    subtotal: round2(subtotal),
    vatAmount: round2(vatAmount),
    totalAmount: round2(totalAmount),
    cogsAmount: round2(cogsAmount),
  };
}

/**
 * Confirms the customer belongs to this workspace before we link an invoice
 * to it. The composite FK `sales_invoices_customer_company_fk` enforces the
 * same invariant at the DB layer; we check here to surface a clean 404
 * instead of a generic FK-violation error.
 */
async function assertCustomerOwned(companyId: number, customerId: number): Promise<Customer> {
  const c = await storage.getCustomer(companyId, customerId);
  if (!c) throw new Error(`العميل (${customerId}) غير موجود في هذا الحساب`);
  return c;
}

async function workspaceVatRate(companyId: number): Promise<number> {
  const settings = await storage.getSettings(companyId);
  return Number(settings.vatRate);
}

/**
 * Creates a draft (or, when `status === 'posted'`, immediately posts) a
 * sales invoice. Returns the fully hydrated invoice — the same shape
 * `GET /api/sales/invoices/:id` produces, so the create dialog can render
 * the result without a second request.
 */
export async function createSalesInvoice(
  companyId: number,
  input: CreateSalesInvoiceInput,
  ctx?: AuditContext,
): Promise<SalesInvoiceWithLines> {
  await assertCustomerOwned(companyId, input.customerId);
  const fallbackVat = await workspaceVatRate(companyId);
  const normalisedLines = await normaliseLines(companyId, input.lines, fallbackVat);
  const totals = totalsFromLines(normalisedLines);
  const number = await storage.getNextSalesInvoiceNumber(companyId);

  const draft = await storage.createDraftSalesInvoice(
    companyId,
    {
      number,
      customerId: input.customerId,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate ?? null,
      paymentMethod: input.paymentMethod,
      notes: input.notes ?? "",
      subtotal: totals.subtotal,
      vatAmount: totals.vatAmount,
      totalAmount: totals.totalAmount,
      cogsAmount: totals.cogsAmount,
    },
    totals.lines.map((l) => ({
      productId: l.productId,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      lineSubtotal: l.lineSubtotal,
      lineVat: l.lineVat,
      lineTotal: l.lineTotal,
      unitCost: l.unitCost,
      costAmount: l.costAmount,
    })),
    ctx,
  );

  if (input.status === "posted") {
    return await postSalesInvoice(companyId, draft.id, ctx);
  }
  // Always re-fetch through `getSalesInvoice` so the caller sees the same
  // hydrated shape (customer summary + JE reference) the list endpoint emits.
  const hydrated = await storage.getSalesInvoice(companyId, draft.id);
  return hydrated ?? draft;
}

/**
 * Mutates a draft invoice's header + lines. Posted/cancelled invoices are
 * read-only — to amend a posted invoice the user cancels (which reverses
 * the JE) then re-creates.
 */
export async function updateSalesInvoice(
  companyId: number,
  id: number,
  input: UpdateSalesInvoiceInput,
  ctx?: AuditContext,
): Promise<SalesInvoiceWithLines> {
  const existing = await storage.getSalesInvoice(companyId, id);
  if (!existing) throw new Error("الفاتورة غير موجودة");
  if (existing.status !== "draft") {
    throw new Error("لا يمكن تعديل فاتورة بعد ترحيلها — قم بإلغاءها وإنشاء جديدة");
  }
  if (input.customerId !== undefined) {
    await assertCustomerOwned(companyId, input.customerId);
  }
  const fallbackVat = await workspaceVatRate(companyId);
  // Re-use the existing lines unless the patch supplies a fresh array.
  const sourceLines = input.lines
    ? input.lines
    : existing.lines.map((l) => ({
        productId: l.productId ?? null,
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        vatRate: Number(l.vatRate),
        unitCost: Number(l.unitCost),
      }));
  const normalisedLines = await normaliseLines(companyId, sourceLines as CreateSalesInvoiceInput["lines"], fallbackVat);
  const totals = totalsFromLines(normalisedLines);

  await storage.updateDraftSalesInvoice(
    companyId,
    id,
    {
      customerId: input.customerId,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate ?? undefined,
      paymentMethod: input.paymentMethod,
      notes: input.notes,
      subtotal: totals.subtotal,
      vatAmount: totals.vatAmount,
      totalAmount: totals.totalAmount,
      cogsAmount: totals.cogsAmount,
    },
    totals.lines.map((l) => ({
      productId: l.productId,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      lineSubtotal: l.lineSubtotal,
      lineVat: l.lineVat,
      lineTotal: l.lineTotal,
      unitCost: l.unitCost,
      costAmount: l.costAmount,
    })),
    ctx,
  );
  if (input.status === "posted") {
    return await postSalesInvoice(companyId, id, ctx);
  }
  const hydrated = await storage.getSalesInvoice(companyId, id);
  return hydrated!;
}

/**
 * Builds and writes the posting JE, then atomically links it + decrements
 * stock through `storage.markSalesInvoicePosted`. The JE is created
 * *before* the transaction that links it: `storage.createJournalEntry` is
 * itself atomic, so the worst case is an orphan JE that
 * `reverseAutoPostedJournalEntry` will refuse to delete (because the
 * invoice it links from didn't end up `posted`). The next post attempt
 * will create a fresh JE — the stale one stays visible in the journal as a
 * record of the failed attempt and can be cleaned up manually.
 */
export async function postSalesInvoice(
  companyId: number,
  invoiceId: number,
  ctx?: AuditContext,
): Promise<SalesInvoiceWithLines> {
  const inv = await storage.getSalesInvoice(companyId, invoiceId);
  if (!inv) throw new Error("الفاتورة غير موجودة");
  if (inv.status !== "draft") throw new Error("لا يمكن ترحيل فاتورة بهذه الحالة");
  if (inv.lines.length === 0) throw new Error("الفاتورة لا تحتوي على بنود");

  const customer = await assertCustomerOwned(companyId, inv.customerId);

  // Resolve the CoA codes the JE references in one shot. `storage` exposes
  // accounts already, but we go straight to `accounts` here to keep the
  // CoA id lookup explicit and easy to audit alongside the JE build below.
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

  const subtotal = Number(inv.subtotal);
  const vatAmount = Number(inv.vatAmount);
  const totalAmount = Number(inv.totalAmount);
  const cogsAmount = Number(inv.cogsAmount);

  // Build journal lines:
  //   Dr AR (or Cash if cash sale)               total
  //   Cr Sales Revenue                           subtotal
  //   Cr VAT Payable                             vatAmount   (skipped if 0)
  //   Dr COGS                                    cogsAmount  (skipped if 0)
  //   Cr Inventory                               cogsAmount  (skipped if 0)
  //
  // The COGS pair is only emitted when at least one line has a non-zero
  // cost — service invoices and free-form lines arrive with `cogsAmount=0`
  // and skip the inventory legs entirely.
  const debitTargetCode =
    inv.paymentMethod === "cash" ? CASH_ACCOUNT_CODE : AR_ACCOUNT_CODE;
  const debitDescription =
    inv.paymentMethod === "cash"
      ? `تحصيل نقدي للفاتورة ${inv.number} — ${customer.nameAr}`
      : `فاتورة آجل للعميل ${customer.nameAr}`;

  const journalInput = {
    accountId: idOf(debitTargetCode),
    debit: totalAmount,
    credit: 0,
    description: debitDescription,
  };
  const lines: Array<{
    accountId: number;
    debit: number;
    credit: number;
    description: string;
  }> = [
    journalInput,
    {
      accountId: idOf(SALES_ACCOUNT_CODE),
      debit: 0,
      credit: subtotal,
      description: `إيراد مبيعات — ${inv.number}`,
    },
  ];
  if (vatAmount > 0.0001) {
    lines.push({
      accountId: idOf(VAT_PAYABLE_CODE),
      debit: 0,
      credit: vatAmount,
      description: `ض.ق.م مستحقة على الفاتورة ${inv.number}`,
    });
  }
  if (cogsAmount > 0.0001) {
    lines.push({
      accountId: idOf(COGS_ACCOUNT_CODE),
      debit: cogsAmount,
      credit: 0,
      description: `تكلفة البضاعة المباعة — ${inv.number}`,
    });
    lines.push({
      accountId: idOf(INVENTORY_CODE),
      debit: 0,
      credit: cogsAmount,
      description: `تخفيض مخزون — ${inv.number}`,
    });
  }

  // Sanity-check the JE balances before we even ask the storage layer to
  // accept it. `createJournalEntry` doesn't enforce DR === CR; that
  // invariant is the responsibility of the module that builds the entry.
  const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredits = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new Error(
      `قيد الفاتورة غير متوازن (مدين ${totalDebits.toFixed(2)} ≠ دائن ${totalCredits.toFixed(2)})`,
    );
  }

  const je = await storage.createJournalEntry(
    companyId,
    {
      entryDate: inv.invoiceDate,
      description: `فاتورة مبيعات ${inv.number} — ${customer.nameAr}`,
      source: "manual",
      lines,
    },
    ctx,
  );

  // Inventory adjustments only for goods lines that point at a real product
  // (the storage helper sums them up + decrements stockQty per row in the
  // same tx that links the JE).
  const allProductIds = inv.lines
    .map((l) => l.productId)
    .filter((v): v is number => v != null);
  const productCatalog = allProductIds.length === 0
    ? []
    : await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.companyId, companyId),
            inArray(products.id, allProductIds),
          ),
        );
  const isServiceById = new Map(productCatalog.map((p) => [p.id, p.isService]));
  const inventoryAdjustments: Array<{ productId: number; quantity: number }> = [];
  for (const l of inv.lines) {
    if (l.productId == null) continue;
    if (isServiceById.get(l.productId)) continue;
    const qty = Number(l.quantity);
    if (qty <= 0) continue;
    inventoryAdjustments.push({ productId: l.productId, quantity: qty });
  }

  await storage.markSalesInvoicePosted(
    companyId,
    invoiceId,
    je.id,
    inventoryAdjustments,
    ctx,
  );
  const refreshed = await storage.getSalesInvoice(companyId, invoiceId);
  return refreshed!;
}

/**
 * Cancel a posted invoice: marks `status='cancelled'`, restores stock, and
 * reverses (deletes) the linked JE. The invoice row stays around so the
 * audit thread is preserved and the original `number` is still resolvable.
 */
export async function cancelSalesInvoice(
  companyId: number,
  invoiceId: number,
  ctx?: AuditContext,
): Promise<SalesInvoiceWithLines> {
  const inv = await storage.getSalesInvoice(companyId, invoiceId);
  if (!inv) throw new Error("الفاتورة غير موجودة");
  if (inv.status === "cancelled") return inv;
  if (inv.status !== "posted") {
    throw new Error("يمكن إلغاء الفواتير المرحّلة فقط");
  }
  await storage.reverseSalesInvoicePosting(companyId, invoiceId, "cancel", ctx);
  const refreshed = await storage.getSalesInvoice(companyId, invoiceId);
  return refreshed!;
}

/**
 * Removes an invoice. Drafts and already-cancelled invoices are deleted in
 * place; posted invoices have their JE reversed first (with stock restored)
 * and then the row is deleted in the same transaction.
 */
export async function deleteSalesInvoice(
  companyId: number,
  invoiceId: number,
  ctx?: AuditContext,
): Promise<void> {
  const inv = await storage.getSalesInvoice(companyId, invoiceId);
  if (!inv) return;
  if (inv.status === "posted") {
    await storage.reverseSalesInvoicePosting(companyId, invoiceId, "delete", ctx);
    return;
  }
  await storage.deleteDraftOrCancelledSalesInvoice(companyId, invoiceId, ctx);
}

/**
 * Re-export the payment method discriminator for routes / docs that want to
 * import it from the sales module rather than reaching into `@shared`.
 */
export type { SalesInvoicePaymentMethod };
