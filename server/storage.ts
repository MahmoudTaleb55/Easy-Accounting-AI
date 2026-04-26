import { db } from "./db";
import {
  transactions,
  chatMessages,
  accounts,
  journalEntries,
  journalLines,
  budgets,
  settings,
  employees,
  attendance,
  leaves,
  payrollRuns,
  payrollLines,
  customers,
  products,
  salesInvoices,
  salesInvoiceLines,
  type Customer,
  type InsertCustomer,
  type Product,
  type InsertProduct,
  type SalesInvoice,
  type SalesInvoiceLine,
  type SalesInvoiceWithLines,
  type SalesInvoiceStatus,
  type SalesInvoicePaymentMethod,
  companies,
  fxRates,
  assetCategories,
  fixedAssets,
  assetComponents,
  depreciationSchedule,
  depreciationRuns,
  depreciationPostings,
  impairmentEvents,
  revaluationEvents,
  disposals,
  auditLog,
  documents,
  type DocumentRow,
  type InsertDocument,
  type ExtractedDocument,
  type SuggestedJournal,
  type AuditLogEntry,
  type AuditChange,
  type Company,
  type InsertCompany,
  type FxRate,
  type InsertFxRate,
  type AssetCategory,
  type InsertAssetCategory,
  type FixedAsset,
  type InsertFixedAsset,
  type AssetComponent,
  type InsertAssetComponent,
  type DepreciationRun,
  type DepreciationPosting,
  type DepreciationScheduleRow,
  type ImpairmentEvent,
  type RevaluationEvent,
  type Disposal,
  type Transaction,
  type TransactionWithJournal,
  type InsertTransaction,
  type ChatMessage,
  type InsertChatMessage,
  type Account,
  type InsertAccount,
  type JournalEntry,
  type JournalLine,
  type CreateJournalEntryInput,
  type Budget,
  type InsertBudget,
  type OrgSettings,
  type UpsertOrgSettings,
  type Employee,
  type InsertEmployee,
  type Attendance,
  type InsertAttendance,
  type Leave,
  type InsertLeave,
  type PayrollRun,
  type PayrollLineWithEmployee,
  type JournalEntrySourceLink,
} from "@shared/schema";
import {
  CASH_ACCOUNT_CODE,
  pickExpenseAccountCode,
  pickRevenueAccountCode,
} from "@shared/coa-seed";
import { eq, sql, desc, and, inArray, gte, lte, gt, or, ne } from "drizzle-orm";
import type { AnyPgTable, PgColumn } from "drizzle-orm/pg-core";

export interface JournalEntryWithLines extends JournalEntry {
  lines: (JournalLine & { account?: Account })[];
  // When present, indicates the JE was auto-posted by another module (payroll
  // run, depreciation run, or a fixed-asset event). Computed at read time so
  // the badge naturally disappears if the source row is later deleted.
  sourceLink?: JournalEntrySourceLink;
}

// ============================================================================
// Audit log types
// ============================================================================

export type AuditSource = "user" | "ai" | "integration" | "system";

export interface AuditContext {
  source?: AuditSource;
  actor?: string | null;
}

export const AUDIT_ENTITY_TYPES = [
  "transaction",
  "journal_entry",
  "account",
  "fixed_asset",
  "employee",
  "attendance",
  "leave",
  "payroll_run",
  // Sales Portal — task #301. Customers, products, and sales invoices each
  // get their own audit thread; the History drawer keys on these strings.
  // The matching `entityBelongsToCompany` branches below pin the workspace
  // ownership check to the concrete table.
  "customer",
  "product",
  "sales_invoice",
  // Workspace-scoped maintenance actions whose "entity" is the workspace
  // itself rather than a row in a domain table. Today: a single audit row
  // per invocation of `backfillJournalForLegacyTransactions`, with
  // `entity_id = company_id` and a payload of `{ created, skipped,
  // triggered_via: 'admin-route' | 'boot' }`. Lets two owners (or future
  // support) see who re-ran the recovery action and when, without rooting
  // through every per-JE audit row. See task #236.
  "backfill",
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export function isAuditEntityType(value: string): value is AuditEntityType {
  return (AUDIT_ENTITY_TYPES as readonly string[]).includes(value);
}

export interface IStorage {
  // All business-data methods are scoped by `companyId` so that two
  // memberships in different workspaces cannot read or write each other's rows.

  // Legacy quick-entry transactions. The list response augments each row with
  // the auto-posted journal entry (id + reference) so the transaction detail
  // dialog can deep-link back into `/app/journal#je-<id>` without having to
  // issue a second per-row query. Both fields are optional — see
  // `TransactionWithJournal` for the gracefully-hidden cases.
  getTransactions(companyId: number): Promise<TransactionWithJournal[]>;
  createTransaction(companyId: number, tx: InsertTransaction, ctx?: AuditContext): Promise<Transaction>;
  deleteTransaction(companyId: number, id: number, ctx?: AuditContext): Promise<void>;
  /** Look up the auto-posted journal entry id for a quick-entry transaction.
   *  Returns null when the auto-post leg failed (best-effort by design — see
   *  `autoPostFromTransaction`). Used by the chat handler to mirror an
   *  attached receipt into the inbox with `status="posted"` and a working
   *  deep link to the JE the assistant just created via `add_quick_transaction`. */
  getJournalEntryIdByTransactionId(
    companyId: number,
    transactionId: number,
  ): Promise<number | null>;

  // Chat
  getChatMessages(companyId: number): Promise<ChatMessage[]>;
  createChatMessage(msg: InsertChatMessage): Promise<ChatMessage>;

  // Chart of accounts
  getAccounts(companyId: number): Promise<Account[]>;
  createAccount(companyId: number, input: InsertAccount, ctx?: AuditContext): Promise<Account>;
  getAccountByCode(companyId: number, code: string): Promise<Account | undefined>;

  // Journal entries
  getJournalEntries(companyId: number): Promise<JournalEntryWithLines[]>;
  createJournalEntry(companyId: number, input: CreateJournalEntryInput, ctx?: AuditContext): Promise<JournalEntryWithLines>;
  deleteJournalEntry(companyId: number, id: number, ctx?: AuditContext): Promise<void>;
  getAccountBalances(
    companyId: number,
    range?: { from?: Date; to?: Date },
  ): Promise<Map<number, { debit: number; credit: number }>>;

  // Budgets
  getBudgets(companyId: number, year?: number, month?: number): Promise<Budget[]>;
  upsertBudget(companyId: number, input: InsertBudget): Promise<Budget>;
  deleteBudget(companyId: number, id: number): Promise<void>;

  // Settings (per-company singleton)
  getSettings(companyId: number): Promise<OrgSettings>;
  updateSettings(companyId: number, input: UpsertOrgSettings): Promise<OrgSettings>;

  // HR
  getEmployees(companyId: number): Promise<Employee[]>;
  createEmployee(companyId: number, input: InsertEmployee, ctx?: AuditContext): Promise<Employee>;
  updateEmployee(companyId: number, id: number, input: Partial<InsertEmployee>, ctx?: AuditContext): Promise<Employee>;
  deleteEmployee(companyId: number, id: number, ctx?: AuditContext): Promise<void>;

  getAttendance(companyId: number, employeeId?: number, yearMonth?: string): Promise<Attendance[]>;
  upsertAttendance(companyId: number, input: InsertAttendance, ctx?: AuditContext): Promise<Attendance>;

  getLeaves(companyId: number, employeeId?: number): Promise<Leave[]>;
  createLeave(companyId: number, input: InsertLeave, ctx?: AuditContext): Promise<Leave>;
  deleteLeave(companyId: number, id: number, ctx?: AuditContext): Promise<void>;

  // Payroll runs (history list + delete + audit hook used by payroll engine)
  listPayrollRuns(companyId: number): Promise<PayrollRun[]>;
  // Per-employee breakdown for a posted run, joined with employee names so
  // the detail dialog can audit a past run end-to-end without re-running the
  // preview. Workspace-scoped via the run's `companyId`.
  getPayrollRunLines(companyId: number, runId: number): Promise<PayrollLineWithEmployee[]>;
  deletePayrollRun(companyId: number, id: number, ctx?: AuditContext): Promise<void>;
  /**
   * Append a payroll-run audit row inside the caller's existing
   * `db.transaction(async (tx) => …)` block. Task #222: callers must
   * pass the transaction handle so the audit row commits atomically with
   * the payroll-run mutation it describes; a failure on either side rolls
   * the whole unit back, keeping payroll history and audit trail in sync.
   */
  recordPayrollRunAudit(
    tx: AuditWriter,
    input: {
      /**
       * Workspace owning the payroll run. Required since task #169 brought
       * `audit_log` under workspace_isolation RLS.
       */
      companyId: number;
      payrollRunId: number;
      action: "create" | "update" | "delete" | "post";
      changes?: AuditChange[];
      ctx?: AuditContext;
    },
  ): Promise<void>;

  // Audit log — scoped: only returns history when the underlying entity
  // belongs to the caller's active workspace. Cross-workspace lookups return
  // an empty array (the route layer turns that into a 404).
  getAuditLog(
    companyId: number,
    entityType: AuditEntityType,
    entityId: number,
    bounds?: { from?: Date; to?: Date },
  ): Promise<AuditLogEntry[]>;
  entityBelongsToCompany(entityType: AuditEntityType, entityId: number, companyId: number): Promise<boolean>;
  /**
   * Reversal-aware variant for journal entries: returns the audit log even
   * when the JE was cascade-deleted by a `reverseAutoPostedJournalEntry`
   * call. Ownership is verified against the `companyId` stamp written into
   * the JE-side reversal audit row (see `reverseAutoPostedJournalEntry`).
   *
   * Returns `null` when the JE neither belongs to the caller's workspace
   * nor has a verifiable reversal trail in the audit log.
   */
  getJournalEntryAuditWithReversal(
    companyId: number,
    entityId: number,
  ): Promise<AuditLogEntry[] | null>;

  /**
   * Append a `journal_entry/<action>` audit row inside the caller's open
   * transaction. Used by callers that insert journal entries directly via
   * Drizzle (notably `backfillJournalForLegacyTransactions` in init-coa.ts)
   * instead of going through `createJournalEntry`, so every JE in the
   * system carries the same audit-log lineage regardless of which code
   * path posted it. Task #222 / task #236.
   */
  recordJournalEntryAudit(
    tx: AuditWriter,
    input: {
      companyId: number;
      journalEntryId: number;
      action: "create" | "update" | "delete" | "post";
      changes?: AuditChange[];
      ctx?: AuditContext;
    },
  ): Promise<void>;

  /**
   * Append the per-invocation summary audit row written by the
   * journal-entry recovery action (see `backfillJournalForLegacyTransactions`).
   * Stamps `entity_type='backfill'`, `entity_id=companyId`, and a payload of
   * `{ created, skipped, triggered_via }` in the `changes` JSON, so two
   * owners (or future support) can answer "who re-paired the books and
   * when?" without rooting through every per-JE audit row. Caller passes
   * the open transaction handle so the audit row commits atomically with
   * the per-JE writes from the same backfill invocation (task #222 / task #236).
   */
  recordBackfillRunAudit(
    tx: AuditWriter,
    input: {
      companyId: number;
      created: number;
      skipped: number;
      triggeredVia: "admin-route" | "boot";
      ctx?: AuditContext;
    },
  ): Promise<void>;

  /**
   * Most recent backfill audit row for the active workspace, or `null` if
   * the recovery action has never been recorded for this workspace. Powers
   * the "Last run by <owner> on <date>" line under the Re-pair card on
   * /app/settings (task #236).
   */
  getLastBackfillRun(companyId: number): Promise<AuditLogEntry | null>;

  // AI document inbox
  createDocument(companyId: number, input: InsertDocument): Promise<DocumentRow>;
  listDocuments(companyId: number): Promise<DocumentRow[]>;
  getDocument(companyId: number, id: number): Promise<DocumentRow | undefined>;
  updateDocumentExtraction(
    companyId: number,
    id: number,
    patch: {
      status: "ready" | "error" | "posting";
      extractedJson?: ExtractedDocument | null;
      suggestedJournalJson?: SuggestedJournal | null;
      errorMessage?: string | null;
    },
  ): Promise<DocumentRow>;
  /**
   * Atomically post a document: only succeeds if the row is still in `ready`
   * status, otherwise returns null. Prevents two concurrent confirm clicks
   * from creating duplicate journal entries linked to the same source doc.
   */
  claimDocumentForPosting(companyId: number, id: number): Promise<DocumentRow | null>;
  markDocumentPosted(companyId: number, id: number, journalEntryId: number): Promise<DocumentRow>;
  deleteDocument(
    companyId: number,
    id: number,
    ctx?: AuditContext,
  ): Promise<DocumentRow | undefined>;

  // ----- Sales Portal (task #301) -----
  // Customers
  listCustomers(companyId: number): Promise<Customer[]>;
  getCustomer(companyId: number, id: number): Promise<Customer | undefined>;
  createCustomer(companyId: number, input: InsertCustomer, ctx?: AuditContext): Promise<Customer>;
  updateCustomer(companyId: number, id: number, input: Partial<InsertCustomer>, ctx?: AuditContext): Promise<Customer>;
  deleteCustomer(companyId: number, id: number, ctx?: AuditContext): Promise<void>;
  /** Open AR balance for a customer = sum(total_amount - paid_amount) over
   *  posted (non-cancelled) credit invoices. Cash invoices are settled at
   *  posting time and do not contribute. Returns 0 when the customer has
   *  no posted activity. */
  getCustomerBalance(companyId: number, customerId: number): Promise<number>;
  /** Posted invoices for a customer in reverse chronological order. Powers
   *  the "Statement / Recent activity" tab on the customer detail page. */
  getCustomerInvoices(companyId: number, customerId: number): Promise<SalesInvoice[]>;
  // Products
  listProducts(companyId: number): Promise<Product[]>;
  getProduct(companyId: number, id: number): Promise<Product | undefined>;
  createProduct(companyId: number, input: InsertProduct, ctx?: AuditContext): Promise<Product>;
  updateProduct(companyId: number, id: number, input: Partial<InsertProduct>, ctx?: AuditContext): Promise<Product>;
  deleteProduct(companyId: number, id: number, ctx?: AuditContext): Promise<void>;
  // Sales invoices (header + lines + customer + JE-link snapshot)
  listSalesInvoices(
    companyId: number,
    filters?: { status?: SalesInvoiceStatus; customerId?: number },
  ): Promise<SalesInvoiceWithLines[]>;
  getSalesInvoice(companyId: number, id: number): Promise<SalesInvoiceWithLines | undefined>;
  /** Returns the next "INV-####" reference for the workspace; padded to 4
   *  digits and monotonically increasing across the workspace's history.
   *  Used by /api/sales/invoices/next-number for live preview. */
  getNextSalesInvoiceNumber(companyId: number): Promise<string>;
  /** Insert a draft sales invoice (header + lines) and audit. Totals are
   *  expected pre-computed by `server/sales.ts`. The JE is *not* posted
   *  here; that lives in `postSalesInvoice` so the data layer stays free
   *  of CoA / pricing logic. */
  createDraftSalesInvoice(
    companyId: number,
    header: {
      number: string;
      customerId: number;
      invoiceDate: string;
      dueDate?: string | null;
      paymentMethod: SalesInvoicePaymentMethod;
      notes?: string;
      subtotal: number;
      vatAmount: number;
      totalAmount: number;
      cogsAmount: number;
    },
    lines: Array<{
      productId: number | null;
      description: string;
      quantity: number;
      unitPrice: number;
      vatRate: number;
      lineSubtotal: number;
      lineVat: number;
      lineTotal: number;
      unitCost: number;
      costAmount: number;
    }>,
    ctx?: AuditContext,
  ): Promise<SalesInvoiceWithLines>;
  /** Replace the lines and re-compute totals on a draft invoice. Refuses if
   *  the invoice is no longer in `draft`. Audits the diff. */
  updateDraftSalesInvoice(
    companyId: number,
    id: number,
    header: {
      customerId?: number;
      invoiceDate?: string;
      dueDate?: string | null;
      paymentMethod?: SalesInvoicePaymentMethod;
      notes?: string;
      subtotal: number;
      vatAmount: number;
      totalAmount: number;
      cogsAmount: number;
    },
    lines: Array<{
      productId: number | null;
      description: string;
      quantity: number;
      unitPrice: number;
      vatRate: number;
      lineSubtotal: number;
      lineVat: number;
      lineTotal: number;
      unitCost: number;
      costAmount: number;
    }>,
    ctx?: AuditContext,
  ): Promise<SalesInvoiceWithLines>;
  /** Atomically marks an invoice posted: links the JE, sets `paidAmount`
   *  (= total for cash invoices, 0 for credit), decrements stock for the
   *  per-line `inventoryAdjustments`, and writes the "post" audit row.
   *  Throws if the invoice is not in `draft`. */
  markSalesInvoicePosted(
    companyId: number,
    invoiceId: number,
    journalEntryId: number,
    inventoryAdjustments: Array<{ productId: number; quantity: number }>,
    ctx?: AuditContext,
  ): Promise<SalesInvoiceWithLines>;
  /** Reverses a posted invoice. `mode === 'cancel'` keeps the row with
   *  `status='cancelled'` (and `paidAmount=0`); `mode === 'delete'` removes
   *  the lines + header. In both modes the linked JE is cascade-reversed
   *  (via the shared `reverseAutoPostedJournalEntry` helper) and the
   *  per-line stock changes are rolled back inside the same transaction. */
  reverseSalesInvoicePosting(
    companyId: number,
    invoiceId: number,
    mode: "cancel" | "delete",
    ctx?: AuditContext,
  ): Promise<void>;
  /** Hard-delete a draft (or already-cancelled) invoice + its lines + audit.
   *  Posted invoices must go through `reverseSalesInvoicePosting` instead. */
  deleteDraftOrCancelledSalesInvoice(
    companyId: number,
    invoiceId: number,
    ctx?: AuditContext,
  ): Promise<void>;

  // Auto-posting fixed-asset deletes — same JE-orphan guard as payroll runs
  deleteDepreciationRun(
    companyId: number,
    runId: number,
    ctx?: AuditContext,
  ): Promise<void>;
  deleteImpairmentEvent(
    companyId: number,
    eventId: number,
    ctx?: AuditContext,
  ): Promise<void>;
  deleteRevaluationEvent(
    companyId: number,
    eventId: number,
    ctx?: AuditContext,
  ): Promise<void>;
  deleteDisposal(
    companyId: number,
    eventId: number,
    ctx?: AuditContext,
  ): Promise<void>;
  countDocumentsByStoragePath(companyId: number, storagePath: string): Promise<number>;
}

const AUDIT_SKIP_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

function snapshotChanges(snapshot: Record<string, any>): AuditChange[] {
  return Object.entries(snapshot)
    .filter(([k, v]) => !AUDIT_SKIP_FIELDS.has(k) && v !== undefined && v !== null && v !== "")
    .map(([field, to]) => ({ field, to: serializeValue(to) }));
}

function serializeValue(v: any): any {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    try {
      return JSON.parse(JSON.stringify(v));
    } catch {
      return String(v);
    }
  }
  return v;
}

function diffChanges(before: Record<string, any>, after: Record<string, any>): AuditChange[] {
  const changes: AuditChange[] = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of Array.from(keys)) {
    if (AUDIT_SKIP_FIELDS.has(k)) continue;
    if (!(k in after)) continue; // only fields we tried to set
    const a = serializeValue(before?.[k]);
    const b = serializeValue(after?.[k]);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ field: k, from: a, to: b });
    }
  }
  return changes;
}

/**
 * Structural type of "anything you can call `.insert(table)` on" — both the
 * top-level Drizzle handle (`db`) and the per-transaction handle yielded by
 * `db.transaction(async (tx) => …)` satisfy it. The audit writer accepts
 * either, but in practice every call site is required to pass a transaction
 * handle so the audit row commits atomically with the entity write that
 * justifies it (task #222).
 */
export type AuditWriter = Pick<typeof db, "insert">;

/**
 * Append a row to `audit_log`. Task #222: every caller must pass the
 * transaction handle (`tx`) from the same `db.transaction(async (tx) => …)`
 * block that performed the entity write being audited. Splitting the audit
 * insert across its own implicit transaction (the previous behaviour) meant
 * a failed audit write — for any reason: workspace_isolation RLS rejection
 * (task #169 made the policy cover this table too), CHECK constraint
 * violation, or a network blip between two pool checkouts — would leave the
 * underlying mutation already committed and the audit history missing a
 * row. Threading both writes through the same transaction closes that gap:
 * either both rows commit, or neither does.
 *
 * Intentionally not wrapped in try/catch — a failed audit write must
 * propagate so the surrounding `db.transaction` rolls back. Auditability
 * is a first-class success criterion, not best-effort.
 */
async function recordAudit(
  tx: AuditWriter,
  input: {
    /**
     * The workspace the audited entity belongs to. Required since task #169
     * brought `audit_log` under the same workspace_isolation RLS policy as
     * every other workspace-scoped table — an INSERT with the wrong
     * `companyId` would now be rejected by the policy instead of silently
     * leaking. Every call site already has the workspace in scope (it's the
     * same value the caller used to filter the entity row).
     */
    companyId: number;
    entityType: AuditEntityType;
    entityId: number;
    action: "create" | "update" | "delete" | "post";
    changes?: AuditChange[];
    ctx?: AuditContext;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    companyId: input.companyId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actor: input.ctx?.actor ?? null,
    source: input.ctx?.source ?? "user",
    changes: input.changes ?? [],
  });
}

/**
 * Generic ownership guard: returns true iff every id in `ids` exists in
 * `table` AND has `companyId` equal to the active workspace. Use this at the
 * route boundary before passing client-supplied foreign-key ids (accountId,
 * categoryId, employeeId, …) to the storage layer, otherwise a logged-in user
 * could attach rows to or borrow rows from another tenant by guessing ids.
 *
 * The `WorkspaceScopedTable` shape constrains callers to pgTables that expose
 * a numeric `id` column and an `integer companyId` column — every workspace-
 * owned schema in this app does. This keeps the helper strongly typed while
 * staying generic across tables.
 */
export type WorkspaceScopedTable = AnyPgTable & {
  id: PgColumn;
  companyId: PgColumn;
};

export async function assertAllOwnedByCompany(
  table: WorkspaceScopedTable,
  companyId: number,
  ids: Array<number | undefined | null>,
): Promise<boolean> {
  const cleaned = Array.from(
    new Set(ids.filter((v): v is number => typeof v === "number" && Number.isFinite(v))),
  );
  if (cleaned.length === 0) return true;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.companyId, companyId), inArray(table.id, cleaned)));
  return rows.length === cleaned.length;
}

/**
 * Thrown by any *delete* path that auto-posts a journal entry (payroll runs,
 * depreciation runs, impairment / revaluation / disposal events, document
 * inbox posts, …) when the linked JE has been picked up by another module
 * and can no longer be silently reversed alongside its source row. The route
 * layer catches this and surfaces a 409 Conflict with the human message.
 *
 * This used to be `PayrollRunDeleteConflictError`; the alias below preserves
 * the historical export name for any external callers, but new code should
 * use `JournalEntryReferenceConflictError` directly.
 */
export class JournalEntryReferenceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalEntryReferenceConflictError";
  }
}

/** @deprecated Use `JournalEntryReferenceConflictError` — the same class. */
export const PayrollRunDeleteConflictError = JournalEntryReferenceConflictError;

/**
 * Thrown by the impairment / revaluation / disposal delete paths when the
 * row was created before migration 0015 added the `asset_balance_delta`
 * snapshot column (task #157). Without that snapshot the delete path cannot
 * compute exactly which per-asset balances to roll back, so rather than
 * silently reverse the JE while leaving `accumImpairment`, `revalSurplus`,
 * `accumRevalLoss`, or `status` stale on `fixed_assets`, we refuse with a
 * 409 Conflict and ask the user to adjust the asset row by hand.
 *
 * See task #208.
 */
export class LegacyAssetEventBalanceMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyAssetEventBalanceMissingError";
  }
}

/**
 * Thrown by the impairment / revaluation / disposal delete paths (task #209)
 * when the asset has at least one *later* event of any kind. The delta
 * rollback in task #157 only knows how to subtract this event's own snapshot;
 * a later event's posting math used the post-this-event balances, so undoing
 * this row in isolation would leave the later event's snapshot inconsistent
 * (e.g. an impairment posted on top of a revaluation has computed its loss
 * against the revalued cost — undoing the revaluation invalidates that loss).
 *
 * The route layer surfaces this as a 409 Conflict.
 */
export class AssetEventLaterDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetEventLaterDependencyError";
  }
}

/**
 * Per-event snapshot of the per-asset balance changes applied by an
 * impairment / revaluation / disposal posting. The matching DELETE route
 * (see `deleteImpairmentEvent` / `deleteRevaluationEvent` / `deleteDisposal`)
 * subtracts these deltas (or restores `statusBefore`) so the asset row goes
 * back exactly to its pre-event state — provided no other event has touched
 * the same columns in the meantime, which is a documented limitation of the
 * delta-rollback strategy. See task #157 for context.
 */
export interface ImpairmentBalanceDelta {
  asset?: { accumImpairment?: number };
  components?: Array<{ id: number; accumImpairment: number }>;
}
export interface RevaluationBalanceDelta {
  asset?: {
    cost?: number;
    accumDepreciation?: number;
    accumImpairment?: number;
    revalSurplus?: number;
    accumRevalLoss?: number;
  };
}
export interface DisposalBalanceDelta {
  asset?: {
    revalSurplus?: number;
    statusBefore?: string;
    statusAfter?: string;
  };
}

/**
 * The auto-posting source row that "owns" the JE we are about to reverse.
 * Each delete path passes its own kind+id so the guard knows which row to
 * exclude (otherwise the row would always self-reference and every delete
 * would 409).
 */
export type JournalEntrySourceKind =
  | "payroll_run"
  | "depreciation_run"
  | "impairment_event"
  | "revaluation_event"
  | "disposal"
  | "document"
  | "sales_invoice";

/**
 * Returns the human-readable list of modules that point at `journalEntryId`
 * (besides `excludeSource`, which is itself the row being deleted). Used as
 * the "locked / reconciled / otherwise referenced" guard for every delete
 * path that auto-posts a JE.
 *
 * Each branch is intentionally a separate `select` against a tiny indexed
 * table — the totals here are bounded by the number of accounting-impact
 * modules (currently 6), not by row counts, so the cost is fixed.
 */
async function detectJournalEntryReferences(
  journalEntryId: number,
  opts: { excludeSource?: { kind: JournalEntrySourceKind; id: number } } = {},
): Promise<string[]> {
  const conflicts: string[] = [];
  const exclude = (kind: JournalEntrySourceKind, idCol: PgColumn) =>
    opts.excludeSource && opts.excludeSource.kind === kind
      ? sql`${idCol} <> ${opts.excludeSource.id}`
      : sql`true`;

  // Defence-in-depth: one JE per source row is the invariant, but a backfill
  // or a manual SQL fix-up could break it, in which case we should refuse
  // rather than silently reverse.
  const otherPayroll = await db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.journalEntryId, journalEntryId),
        exclude("payroll_run", payrollRuns.id),
      ),
    );
  if (otherPayroll.length > 0) {
    conflicts.push(`كشوفات رواتب (${otherPayroll.length})`);
  }

  const depRuns = await db
    .select({ id: depreciationRuns.id })
    .from(depreciationRuns)
    .where(
      and(
        eq(depreciationRuns.journalEntryId, journalEntryId),
        exclude("depreciation_run", depreciationRuns.id),
      ),
    );
  if (depRuns.length > 0) {
    conflicts.push(`دورة إهلاك (${depRuns.length})`);
  }

  const impair = await db
    .select({ id: impairmentEvents.id })
    .from(impairmentEvents)
    .where(
      and(
        eq(impairmentEvents.journalEntryId, journalEntryId),
        exclude("impairment_event", impairmentEvents.id),
      ),
    );
  if (impair.length > 0) {
    conflicts.push(`خسارة انخفاض قيمة (${impair.length})`);
  }

  const reval = await db
    .select({ id: revaluationEvents.id })
    .from(revaluationEvents)
    .where(
      and(
        eq(revaluationEvents.journalEntryId, journalEntryId),
        exclude("revaluation_event", revaluationEvents.id),
      ),
    );
  if (reval.length > 0) {
    conflicts.push(`إعادة تقييم (${reval.length})`);
  }

  const disp = await db
    .select({ id: disposals.id })
    .from(disposals)
    .where(
      and(
        eq(disposals.journalEntryId, journalEntryId),
        exclude("disposal", disposals.id),
      ),
    );
  if (disp.length > 0) {
    conflicts.push(`استبعاد أصل (${disp.length})`);
  }

  const docs = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.journalEntryId, journalEntryId),
        exclude("document", documents.id),
      ),
    );
  if (docs.length > 0) {
    conflicts.push(`مستند مرفوع (${docs.length})`);
  }

  // Sales invoices (task #301) — same pattern as the other auto-posting
  // sources. Refusing here means a sales-invoice-driven JE that somehow
  // ended up linked to a *different* invoice will not be silently reversed
  // when the originating invoice is deleted.
  const sales = await db
    .select({ id: salesInvoices.id })
    .from(salesInvoices)
    .where(
      and(
        eq(salesInvoices.journalEntryId, journalEntryId),
        exclude("sales_invoice", salesInvoices.id),
      ),
    );
  if (sales.length > 0) {
    conflicts.push(`فواتير مبيعات (${sales.length})`);
  }

  return conflicts;
}

/**
 * Builds a `journal_entry_id -> JournalEntrySourceLink` map for the given JE
 * ids in a single workspace. Each branch issues a tiny indexed lookup against
 * a different module's table (payroll runs, depreciation runs, fixed-asset
 * events). The result is consumed by `getJournalEntries` so the journal
 * entries page can render a "From: Payroll 11/2025" badge that deep-links
 * back to the originating row.
 *
 * If a source row is later deleted but the JE remains, no entry will be put
 * in the map for that id and the badge naturally disappears in the UI — this
 * is exactly the behaviour the task spec calls for.
 */
/**
 * Shared workhorse for "delete the source row + reverse its auto-posted JE
 * atomically, or refuse with a 409 if the JE is otherwise referenced".
 *
 * Each module's delete method is responsible for the side effects that are
 * specific to it (eg payroll lines, depreciation postings, schedule cleanup,
 * audit changes) — this helper only owns the JE part: the conflict guard,
 * the JE/line cascade, and the JE-side audit row stamped with `reversedBy`.
 *
 * `extraDelete` runs inside the same transaction as the JE delete so a
 * failure in either rolls back both.
 */
async function reverseAutoPostedJournalEntry(opts: {
  companyId: number;
  source: { kind: JournalEntrySourceKind; id: number };
  journalEntryId: number | null | undefined;
  /** Built error message when the guard refuses; module-specific wording. */
  conflictMessage: (conflicts: string[]) => string;
  /** Extra deletes that must commit/rollback alongside the JE delete. */
  extraDelete: (tx: typeof db) => Promise<void>;
  ctx?: AuditContext;
}): Promise<void> {
  let linkedJournal: JournalEntry | undefined;
  if (opts.journalEntryId) {
    const [je] = await db
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.id, opts.journalEntryId),
          eq(journalEntries.companyId, opts.companyId),
        ),
      );
    if (je) {
      linkedJournal = je;
      const conflicts = await detectJournalEntryReferences(opts.journalEntryId, {
        excludeSource: opts.source,
      });
      if (conflicts.length > 0) {
        throw new JournalEntryReferenceConflictError(opts.conflictMessage(conflicts));
      }
    }
  }

  await db.transaction(async (tx) => {
    // Delete the source row(s) FIRST, then the JE. Some source tables
    // (eg `documents`) carry a composite FK back to journal_entries, so
    // dropping the JE while the source row still references it would fail
    // with a 23503 foreign-key violation. Source tables that point the
    // other way around (eg payroll_runs FK to JE has no action declared)
    // are unaffected by this ordering.
    await opts.extraDelete(tx as unknown as typeof db);
    if (linkedJournal) {
      await tx
        .delete(journalLines)
        .where(eq(journalLines.journalEntryId, linkedJournal.id));
      await tx
        .delete(journalEntries)
        .where(
          and(
            eq(journalEntries.id, linkedJournal.id),
            eq(journalEntries.companyId, opts.companyId),
          ),
        );
      // Stamp the JE delete on its own audit thread so the History drawer
      // for the journal entry shows the reversal even though it was
      // triggered by a source-row delete. The audit row commits inside the
      // *same* transaction as the JE/line deletes (task #222) so a failed
      // audit insert — including a workspace_isolation RLS rejection on
      // `audit_log` itself (task #169) — rolls back the JE delete instead
      // of silently leaving the JE gone with no record of what removed it.
      //
      // Since task #169 the audit row carries `companyId` as a first-class
      // column under workspace_isolation RLS, so the reversal lookup can
      // be a single workspace-filtered SELECT. The `companyId` field is
      // also kept in the change set as a self-documenting trail of who
      // reversed what (and to remain compatible with audit rows that
      // pre-date the column).
      await recordAudit(tx, {
        companyId: opts.companyId,
        entityType: "journal_entry",
        entityId: linkedJournal.id,
        action: "delete",
        changes: [
          ...snapshotChanges(linkedJournal),
          { field: "reversedBy", to: `${opts.source.kind}#${opts.source.id}` },
          { field: "companyId", to: opts.companyId },
        ],
        ctx: opts.ctx,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Later-event guard for fixed-asset events (task #209)
//
// The delta-rollback in task #157 is a pure subtraction of the snapshot a
// single event captured at posting time. If a later event of any kind has
// since been posted on the same asset, that later event's posting math used
// the post-this-event balances — undoing this event in isolation would
// invalidate the later event's snapshot (e.g. an impairment posted on top of
// a revaluation has computed its loss against the revalued cost).
//
// `assertNoLaterEventsForAsset` runs *before* the JE/delta rollback so a
// 409 short-circuits the whole delete. Ordering uses `created_at` (the
// posting timestamp) — anything strictly after the row being deleted is a
// later event; ties are also treated as later (conservative & rare since
// `defaultNow()` has microsecond resolution). Rows with a null `createdAt`
// (legacy / pre-default rows) cannot be ordered against and are ignored.
// ---------------------------------------------------------------------------
type AssetEventKind = "impairment_event" | "revaluation_event" | "disposal";

function assetEventLabel(kind: AssetEventKind, count: number): string {
  switch (kind) {
    case "impairment_event":
      return `خسارة انخفاض قيمة (${count})`;
    case "revaluation_event":
      return `إعادة تقييم (${count})`;
    case "disposal":
      return `استبعاد أصل (${count})`;
  }
}

async function countLaterEventsInTable(
  table: typeof impairmentEvents | typeof revaluationEvents | typeof disposals,
  companyId: number,
  assetId: number,
  cutoff: Date,
  excludeId: number | null,
): Promise<number> {
  const conds = [
    eq(table.companyId, companyId),
    eq(table.assetId, assetId),
    gte(table.createdAt, cutoff),
  ];
  if (excludeId !== null) {
    conds.push(ne(table.id, excludeId));
  }
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(...conds));
  return rows.length;
}

async function assertNoLaterEventsForAsset(
  companyId: number,
  assetId: number,
  current: { kind: AssetEventKind; id: number; createdAt: Date | null },
  buildMessage: (conflicts: string[]) => string,
): Promise<void> {
  if (!current.createdAt) return;
  const cutoff = current.createdAt;

  const [impCount, revCount, dispCount] = await Promise.all([
    countLaterEventsInTable(
      impairmentEvents,
      companyId,
      assetId,
      cutoff,
      current.kind === "impairment_event" ? current.id : null,
    ),
    countLaterEventsInTable(
      revaluationEvents,
      companyId,
      assetId,
      cutoff,
      current.kind === "revaluation_event" ? current.id : null,
    ),
    countLaterEventsInTable(
      disposals,
      companyId,
      assetId,
      cutoff,
      current.kind === "disposal" ? current.id : null,
    ),
  ]);

  const conflicts: string[] = [];
  if (impCount > 0) conflicts.push(assetEventLabel("impairment_event", impCount));
  if (revCount > 0) conflicts.push(assetEventLabel("revaluation_event", revCount));
  if (dispCount > 0) conflicts.push(assetEventLabel("disposal", dispCount));
  if (conflicts.length > 0) {
    throw new AssetEventLaterDependencyError(buildMessage(conflicts));
  }
}

// ---------------------------------------------------------------------------
// Per-asset balance rollbacks (task #157)
//
// Each fixed-asset event (impairment / revaluation / disposal) stores the
// per-asset deltas it applied in `asset_balance_delta`. The matching delete
// route uses these helpers — inside the same transaction that reverses the
// JE — to subtract the deltas back off `fixed_assets` (and `asset_components`
// for impairments). Round to 2 decimals to keep numeric(18,2) clean.
// ---------------------------------------------------------------------------
const round2 = (n: number) => Math.round(n * 100) / 100;

async function reverseImpairmentBalanceDelta(
  tx: typeof db,
  assetId: number,
  delta: ImpairmentBalanceDelta | null | undefined,
): Promise<void> {
  if (!delta) return;
  if (delta.asset?.accumImpairment !== undefined) {
    const [row] = await tx
      .select({ accumImpairment: fixedAssets.accumImpairment })
      .from(fixedAssets)
      .where(eq(fixedAssets.id, assetId));
    if (row) {
      const next = round2(Number(row.accumImpairment) - Number(delta.asset.accumImpairment));
      await tx
        .update(fixedAssets)
        .set({ accumImpairment: String(next) })
        .where(eq(fixedAssets.id, assetId));
    }
  }
  if (delta.components && delta.components.length > 0) {
    for (const c of delta.components) {
      const [row] = await tx
        .select({ accumImpairment: assetComponents.accumImpairment })
        .from(assetComponents)
        .where(eq(assetComponents.id, c.id));
      if (!row) continue;
      const next = round2(Number(row.accumImpairment) - Number(c.accumImpairment));
      await tx
        .update(assetComponents)
        .set({ accumImpairment: String(next) })
        .where(eq(assetComponents.id, c.id));
    }
  }
}

async function reverseRevaluationBalanceDelta(
  tx: typeof db,
  assetId: number,
  delta: RevaluationBalanceDelta | null | undefined,
): Promise<void> {
  if (!delta?.asset) return;
  const [row] = await tx
    .select({
      cost: fixedAssets.cost,
      accumDepreciation: fixedAssets.accumDepreciation,
      accumImpairment: fixedAssets.accumImpairment,
      revalSurplus: fixedAssets.revalSurplus,
      accumRevalLoss: fixedAssets.accumRevalLoss,
    })
    .from(fixedAssets)
    .where(eq(fixedAssets.id, assetId));
  if (!row) return;
  const set: Record<string, string> = {};
  const a = delta.asset;
  if (a.cost !== undefined) set.cost = String(round2(Number(row.cost) - Number(a.cost)));
  if (a.accumDepreciation !== undefined)
    set.accumDepreciation = String(round2(Number(row.accumDepreciation) - Number(a.accumDepreciation)));
  if (a.accumImpairment !== undefined)
    set.accumImpairment = String(round2(Number(row.accumImpairment) - Number(a.accumImpairment)));
  if (a.revalSurplus !== undefined)
    set.revalSurplus = String(round2(Number(row.revalSurplus) - Number(a.revalSurplus)));
  if (a.accumRevalLoss !== undefined)
    set.accumRevalLoss = String(round2(Number(row.accumRevalLoss) - Number(a.accumRevalLoss)));
  if (Object.keys(set).length === 0) return;
  await tx.update(fixedAssets).set(set).where(eq(fixedAssets.id, assetId));
}

async function reverseDisposalBalanceDelta(
  tx: typeof db,
  assetId: number,
  delta: DisposalBalanceDelta | null | undefined,
): Promise<void> {
  if (!delta?.asset) return;
  const [row] = await tx
    .select({
      revalSurplus: fixedAssets.revalSurplus,
      status: fixedAssets.status,
    })
    .from(fixedAssets)
    .where(eq(fixedAssets.id, assetId));
  if (!row) return;
  const set: Record<string, string> = {};
  const a = delta.asset;
  if (a.revalSurplus !== undefined)
    set.revalSurplus = String(round2(Number(row.revalSurplus) - Number(a.revalSurplus)));
  // Only restore the prior status if the current status still matches what
  // the disposal stamped — guards against another module having moved the
  // asset on (eg manual edit) since the disposal was posted.
  if (a.statusBefore && (!a.statusAfter || row.status === a.statusAfter)) {
    set.status = a.statusBefore;
  }
  if (Object.keys(set).length === 0) return;
  await tx.update(fixedAssets).set(set).where(eq(fixedAssets.id, assetId));
}

async function buildJournalSourceLinkMap(
  companyId: number,
  jeIds: number[],
): Promise<Map<number, JournalEntrySourceLink>> {
  const out = new Map<number, JournalEntrySourceLink>();
  if (jeIds.length === 0) return out;

  // Payroll runs
  const prRows = await db
    .select({
      id: payrollRuns.id,
      year: payrollRuns.year,
      month: payrollRuns.month,
      journalEntryId: payrollRuns.journalEntryId,
    })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.companyId, companyId),
        inArray(payrollRuns.journalEntryId, jeIds),
      ),
    );
  for (const r of prRows) {
    if (r.journalEntryId == null) continue;
    out.set(r.journalEntryId, {
      kind: "payroll_run",
      id: r.id,
      href: `/app/hr#pr-${r.id}`,
      period: { year: r.year, month: r.month },
    });
  }

  // Depreciation runs
  const drRows = await db
    .select({
      id: depreciationRuns.id,
      year: depreciationRuns.year,
      month: depreciationRuns.month,
      journalEntryId: depreciationRuns.journalEntryId,
    })
    .from(depreciationRuns)
    .where(
      and(
        eq(depreciationRuns.companyId, companyId),
        inArray(depreciationRuns.journalEntryId, jeIds),
      ),
    );
  for (const r of drRows) {
    if (r.journalEntryId == null) continue;
    out.set(r.journalEntryId, {
      kind: "depreciation_run",
      id: r.id,
      href: `/app/fixed-assets#dr-${r.id}`,
      period: { year: r.year, month: r.month },
    });
  }

  // Fixed-asset events: impairment, revaluation, disposal. We join the asset
  // row in memory so we can include code/name in the badge label without a
  // second round-trip per event.
  const evtAssetIds = new Set<number>();
  const impRows = await db
    .select({
      id: impairmentEvents.id,
      assetId: impairmentEvents.assetId,
      eventDate: impairmentEvents.eventDate,
      journalEntryId: impairmentEvents.journalEntryId,
    })
    .from(impairmentEvents)
    .where(
      and(
        eq(impairmentEvents.companyId, companyId),
        inArray(impairmentEvents.journalEntryId, jeIds),
      ),
    );
  impRows.forEach((r) => evtAssetIds.add(r.assetId));

  const revRows = await db
    .select({
      id: revaluationEvents.id,
      assetId: revaluationEvents.assetId,
      eventDate: revaluationEvents.eventDate,
      journalEntryId: revaluationEvents.journalEntryId,
    })
    .from(revaluationEvents)
    .where(
      and(
        eq(revaluationEvents.companyId, companyId),
        inArray(revaluationEvents.journalEntryId, jeIds),
      ),
    );
  revRows.forEach((r) => evtAssetIds.add(r.assetId));

  const dispRows = await db
    .select({
      id: disposals.id,
      assetId: disposals.assetId,
      eventDate: disposals.eventDate,
      journalEntryId: disposals.journalEntryId,
    })
    .from(disposals)
    .where(
      and(
        eq(disposals.companyId, companyId),
        inArray(disposals.journalEntryId, jeIds),
      ),
    );
  dispRows.forEach((r) => evtAssetIds.add(r.assetId));

  let assetById = new Map<number, { code: string; name: string }>();
  if (evtAssetIds.size > 0) {
    const assetRows = await db
      .select({ id: fixedAssets.id, code: fixedAssets.code, name: fixedAssets.name })
      .from(fixedAssets)
      .where(
        and(
          eq(fixedAssets.companyId, companyId),
          inArray(fixedAssets.id, Array.from(evtAssetIds)),
        ),
      );
    assetById = new Map(assetRows.map((a) => [a.id, { code: a.code, name: a.name }]));
  }

  const buildAssetLink = (
    kind: "impairment" | "revaluation" | "disposal",
    eventId: number,
    assetId: number,
    eventDate: string,
  ): JournalEntrySourceLink => {
    const asset = assetById.get(assetId);
    return {
      kind,
      id: eventId,
      href: `/app/fixed-assets#asset-${assetId}`,
      assetId,
      assetCode: asset?.code,
      assetName: asset?.name,
      eventDate,
    };
  };

  for (const r of impRows) {
    if (r.journalEntryId == null) continue;
    out.set(r.journalEntryId, buildAssetLink("impairment", r.id, r.assetId, r.eventDate));
  }
  for (const r of revRows) {
    if (r.journalEntryId == null) continue;
    out.set(r.journalEntryId, buildAssetLink("revaluation", r.id, r.assetId, r.eventDate));
  }
  for (const r of dispRows) {
    if (r.journalEntryId == null) continue;
    out.set(r.journalEntryId, buildAssetLink("disposal", r.id, r.assetId, r.eventDate));
  }

  return out;
}

async function nextJournalReference(companyId: number): Promise<string> {
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(eq(journalEntries.companyId, companyId));
  return `JE-${String(c + 1).padStart(5, "0")}`;
}

export class DatabaseStorage implements IStorage {
  // ----- Transactions -----
  async getTransactions(companyId: number): Promise<TransactionWithJournal[]> {
    // Two queries instead of a left-join keeps each transaction at one row in
    // the result even on the (rare) edge case where a transaction has more
    // than one auto-posted JE attached. We pick the smallest JE id so the
    // detail dialog deep-links to the original posting, not a later replay.
    const txRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.companyId, companyId))
      .orderBy(transactions.date);

    if (txRows.length === 0) return [];

    const jeRows = await db
      .select({
        id: journalEntries.id,
        reference: journalEntries.reference,
        sourceTransactionId: journalEntries.sourceTransactionId,
      })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, companyId),
          sql`${journalEntries.sourceTransactionId} is not null`,
        ),
      );

    const jeBySource = new Map<number, { id: number; reference: string }>();
    for (const j of jeRows) {
      if (j.sourceTransactionId == null) continue;
      const existing = jeBySource.get(j.sourceTransactionId);
      if (!existing || j.id < existing.id) {
        jeBySource.set(j.sourceTransactionId, { id: j.id, reference: j.reference });
      }
    }

    return txRows.map((t) => {
      const je = jeBySource.get(t.id);
      return je
        ? { ...t, journalEntryId: je.id, journalEntryReference: je.reference }
        : t;
    });
  }

  async createTransaction(companyId: number, tx: InsertTransaction, ctx?: AuditContext): Promise<Transaction> {
    // Insert + audit share a transaction (task #222) so a failed audit
    // write — most realistically a workspace_isolation RLS rejection on
    // `audit_log` after task #169 brought it under the policy — rolls the
    // legacy quick-entry transaction back instead of leaving it on the
    // books with no history row.
    const transaction = await db.transaction(async (txn) => {
      const [created] = await txn
        .insert(transactions)
        .values({ ...tx, companyId, amount: tx.amount.toString() })
        .returning();

      await recordAudit(txn, {
        companyId,
        entityType: "transaction",
        entityId: created.id,
        action: "create",
        changes: snapshotChanges(created),
        ctx,
      });

      return created;
    });

    // Auto-post double-entry journal entry. Runs in its own transaction
    // (see autoPostFromTransaction) so an auto-post failure does not undo
    // the user-visible transaction; the catch below preserves the prior
    // best-effort behaviour for the JE leg.
    try {
      await this.autoPostFromTransaction(companyId, transaction, ctx);
    } catch (e) {
      console.error("Failed to auto-post journal entry for transaction", transaction.id, e);
    }
    return transaction;
  }

  async getJournalEntryIdByTransactionId(
    companyId: number,
    transactionId: number,
  ): Promise<number | null> {
    // Quick-entry transactions auto-post exactly one journal entry whose
    // `sourceTransactionId` points back at them (see `autoPostFromTransaction`).
    // We scope on `companyId` defensively so a workspace can never resolve
    // another tenant's JE id, even though RLS would already block the read.
    const [row] = await db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.sourceTransactionId, transactionId),
          eq(journalEntries.companyId, companyId),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  async deleteTransaction(companyId: number, id: number, ctx?: AuditContext): Promise<void> {
    const [before] = await db.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.companyId, companyId)));
    // Cascade-delete the auto-posted journal lines + entry atomically.
    // Audit rows for both the transaction delete and each cascaded JE
    // delete commit inside the same transaction (task #222) — a failed
    // audit insert rolls the cascade back so the audit history can never
    // be missing rows for a delete that already happened.
    await db.transaction(async (tx) => {
      const linkedJEs = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(and(eq(journalEntries.sourceTransactionId, id), eq(journalEntries.companyId, companyId)));
      for (const je of linkedJEs) {
        await tx.delete(journalLines).where(eq(journalLines.journalEntryId, je.id));
        await tx.delete(journalEntries).where(eq(journalEntries.id, je.id));
        await recordAudit(tx, {
          companyId,
          entityType: "journal_entry",
          entityId: je.id,
          action: "delete",
          changes: [{ field: "reason", to: `cascade from transaction #${id}` }],
          ctx: { source: "system", actor: ctx?.actor ?? null },
        });
      }
      await tx.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.companyId, companyId)));
      if (before) {
        await recordAudit(tx, {
          companyId,
          entityType: "transaction",
          entityId: id,
          action: "delete",
          changes: snapshotChanges(before),
          ctx,
        });
      }
    });
  }

  private async autoPostFromTransaction(companyId: number, tx: Transaction, ctx?: AuditContext): Promise<void> {
    let cash = await this.getAccountByCode(companyId, CASH_ACCOUNT_CODE);
    if (!cash) {
      // The workspace's `1110` cash account is gone. Today every workspace
      // gets a CoA seeded in the same transaction as the company row, so
      // this branch is mostly defensive — but a future migration, an admin
      // import, or a soft-deleted account could leave it missing. If we
      // silently returned (the previous behaviour), the transaction would
      // post with no offsetting JE, and revenue / expense numbers would
      // double-count exactly the way the regression test for task #97 was
      // added to catch.
      //
      // Self-heal in place: re-running the canonical seed for this single
      // workspace is idempotent (it only touches the rows it needs to), so
      // it will re-create code 1110 without disturbing any other accounts
      // or any prior bookings. Then re-fetch and proceed.
      console.warn(
        `[autoPostFromTransaction] workspace ${companyId} is missing cash account ` +
          `code=${CASH_ACCOUNT_CODE}; re-seeding default chart of accounts before posting tx ${tx.id}`,
      );
      const { seedDefaultCoaForCompany } = await import("./init-coa");
      await seedDefaultCoaForCompany(companyId);
      cash = await this.getAccountByCode(companyId, CASH_ACCOUNT_CODE);
      if (!cash) {
        // Re-seed didn't restore it (e.g. the seed itself was somehow
        // blocked). Surface a loud error instead of silently letting the
        // books drift — `createTransaction` catches and `console.error`s
        // it with the transaction id, which is the admin-visible signal.
        // The admin recovery hatch (`POST /api/admin/backfill-journal-entries`)
        // can be re-run once the cash account is back to balance the books.
        throw new Error(
          `[autoPostFromTransaction] workspace ${companyId} has no cash account ` +
            `(code=${CASH_ACCOUNT_CODE}) even after re-seeding the default CoA; ` +
            `transaction ${tx.id} created without an offsetting JE. Restore the ` +
            `cash account, then re-run POST /api/admin/backfill-journal-entries ` +
            `to balance the books.`,
        );
      }
    }
    // Resolve the revenue/expense leg with the same self-heal posture as the
    // cash branch above. Previously this fell back to `cash.id` whenever the
    // category-mapped revenue/expense account was missing, producing a
    // "balanced" but accounting-meaningless `Dr cash / Cr cash` JE — revenue
    // or expense never hit the GL, and the trial balance, P&L, and dashboard
    // totals were quietly wrong (same shape as the bug task #191 closed for
    // the cash account itself).
    const resolveOrSeed = async (
      code: string,
      leg: "revenue" | "expense",
    ): Promise<Account> => {
      let acct = await this.getAccountByCode(companyId, code);
      if (acct) return acct;
      console.warn(
        `[autoPostFromTransaction] workspace ${companyId} is missing ${leg} account ` +
          `code=${code}; re-seeding default chart of accounts before posting tx ${tx.id}`,
      );
      const { seedDefaultCoaForCompany } = await import("./init-coa");
      await seedDefaultCoaForCompany(companyId);
      acct = await this.getAccountByCode(companyId, code);
      if (!acct) {
        throw new Error(
          `[autoPostFromTransaction] workspace ${companyId} has no ${leg} account ` +
            `(code=${code}) even after re-seeding the default CoA; ` +
            `transaction ${tx.id} created without an offsetting JE. Restore the ` +
            `${leg} account, then re-run POST /api/admin/backfill-journal-entries ` +
            `to balance the books.`,
        );
      }
      return acct;
    };

    const amt = Number(tx.amount);
    let drId: number;
    let crId: number;
    if (tx.type === "income") {
      const rev = await resolveOrSeed(
        pickRevenueAccountCode(tx.category, tx.description),
        "revenue",
      );
      drId = cash.id;
      crId = rev.id;
    } else {
      const exp = await resolveOrSeed(
        pickExpenseAccountCode(tx.category, tx.description),
        "expense",
      );
      drId = exp.id;
      crId = cash.id;
    }
    const reference = await nextJournalReference(companyId);
    // JE header + lines + audit row commit as one atomic unit (task #222) —
    // a failed audit insert (eg `audit_log` workspace_isolation rejection)
    // rolls back the JE rather than leaving the GL posted with no audit
    // history of who/what posted it.
    await db.transaction(async (txn) => {
      const [je] = await txn
        .insert(journalEntries)
        .values({
          companyId,
          reference,
          entryDate: tx.date ?? new Date(),
          description: tx.description,
          source: "transaction",
          sourceTransactionId: tx.id,
        })
        .returning();
      await txn.insert(journalLines).values([
        { companyId, journalEntryId: je.id, accountId: drId, debit: amt.toFixed(2), credit: "0", description: tx.description },
        { companyId, journalEntryId: je.id, accountId: crId, debit: "0", credit: amt.toFixed(2), description: tx.description },
      ]);
      await recordAudit(txn, {
        companyId,
        entityType: "journal_entry",
        entityId: je.id,
        action: "create",
        changes: [
          { field: "reference", to: je.reference },
          { field: "description", to: je.description },
          { field: "source", to: "transaction" },
          { field: "sourceTransactionId", to: tx.id },
          { field: "Dr accountId", to: drId },
          { field: "Cr accountId", to: crId },
          { field: "amount", to: amt.toFixed(2) },
        ],
        // Inherit the calling context's source/actor so that an AI-triggered
        // quick transaction (which calls createTransaction with source="ai")
        // produces an AI-attributed JE audit row, not an anonymous "system"
        // row. Falling back to "system" preserves the previous behaviour for
        // direct-storage callers that don't pass a ctx (e.g. seed scripts).
        ctx: ctx ?? { source: "system", actor: null },
      });
    });
  }

  // ----- Chat -----
  async getChatMessages(companyId: number): Promise<ChatMessage[]> {
    return await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.companyId, companyId))
      .orderBy(chatMessages.createdAt);
  }

  async createChatMessage(msg: InsertChatMessage & { companyId: number }): Promise<ChatMessage> {
    const [message] = await db.insert(chatMessages).values(msg).returning();
    return message;
  }

  // ----- Accounts -----
  async getAccounts(companyId: number): Promise<Account[]> {
    return await db
      .select()
      .from(accounts)
      .where(eq(accounts.companyId, companyId))
      .orderBy(accounts.code);
  }

  async createAccount(companyId: number, input: InsertAccount, ctx?: AuditContext): Promise<Account> {
    // Account row + audit row commit together (task #222) so the chart of
    // accounts cannot grow a row that is missing from the audit history.
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(accounts).values({ ...input, companyId }).returning();
      await recordAudit(tx, { companyId, entityType: "account", entityId: created.id, action: "create", changes: snapshotChanges(created), ctx });
      return created;
    });
  }

  async getAccountByCode(companyId: number, code: string): Promise<Account | undefined> {
    const rows = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)));
    return rows[0];
  }

  // ----- Journal Entries -----
  async getJournalEntries(companyId: number): Promise<JournalEntryWithLines[]> {
    const entries = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.companyId, companyId))
      .orderBy(desc(journalEntries.entryDate), desc(journalEntries.id));
    if (entries.length === 0) return [];

    const ids = entries.map((e) => e.id);
    const allLines = await db
      .select()
      .from(journalLines)
      .where(inArray(journalLines.journalEntryId, ids));
    const allAccounts = await this.getAccounts(companyId);
    const accountById = new Map(allAccounts.map((a) => [a.id, a]));

    const sourceLinkByJeId = await buildJournalSourceLinkMap(companyId, ids);

    return entries.map((e) => ({
      ...e,
      lines: allLines
        .filter((l) => l.journalEntryId === e.id)
        .map((l) => ({ ...l, account: accountById.get(l.accountId) })),
      sourceLink: sourceLinkByJeId.get(e.id),
    }));
  }

  async createJournalEntry(companyId: number, input: CreateJournalEntryInput, ctx?: AuditContext): Promise<JournalEntryWithLines> {
    const reference = await nextJournalReference(companyId);
    // Account name lookup is read-only and stable across the transaction
    // window — fetched outside so the transaction body is the smallest
    // possible window of writes.
    const allAccounts = await this.getAccounts(companyId);
    const accountById = new Map(allAccounts.map((a) => [a.id, a]));
    // JE header + lines + audit commit atomically (task #222). A failed
    // audit row rolls the whole posting back, keeping books and history in
    // lockstep.
    return await db.transaction(async (tx) => {
      const [je] = await tx
        .insert(journalEntries)
        .values({
          companyId,
          reference,
          entryDate: input.entryDate ? new Date(input.entryDate as any) : new Date(),
          description: input.description,
          source: input.source,
        })
        .returning();
      const linesToInsert = input.lines.map((l) => ({
        companyId,
        journalEntryId: je.id,
        accountId: l.accountId,
        debit: Number(l.debit || 0).toFixed(2),
        credit: Number(l.credit || 0).toFixed(2),
        description: l.description,
      }));
      const insertedLines = await tx.insert(journalLines).values(linesToInsert).returning();

      const lineSummary: AuditChange[] = insertedLines.map((l) => {
        const acc = accountById.get(l.accountId);
        const label = acc ? `${acc.code} ${acc.nameAr}` : `account#${l.accountId}`;
        const debit = Number(l.debit);
        const credit = Number(l.credit);
        const value = debit > 0 ? `Dr ${debit.toFixed(2)}` : `Cr ${credit.toFixed(2)}`;
        return { field: label, to: value };
      });
      await recordAudit(tx, {
        companyId,
        entityType: "journal_entry",
        entityId: je.id,
        action: "create",
        changes: [
          { field: "reference", to: je.reference },
          { field: "description", to: je.description },
          { field: "source", to: je.source },
          ...lineSummary,
        ],
        ctx: ctx ?? (input.source === "ai" ? { source: "ai" } : input.source === "transaction" ? { source: "system" } : undefined),
      });

      return {
        ...je,
        lines: insertedLines.map((l) => ({ ...l, account: accountById.get(l.accountId) })),
      };
    });
  }

  async deleteJournalEntry(companyId: number, id: number, ctx?: AuditContext): Promise<void> {
    const [before] = await db.select().from(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.companyId, companyId)));
    if (!before) return;
    // JE delete + audit row in one transaction (task #222) so a failed
    // audit insert doesn't strand a deleted JE without history.
    await db.transaction(async (tx) => {
      await tx.delete(journalLines).where(eq(journalLines.journalEntryId, id));
      await tx.delete(journalEntries).where(eq(journalEntries.id, id));
      await recordAudit(tx, {
        companyId,
        entityType: "journal_entry",
        entityId: id,
        action: "delete",
        changes: snapshotChanges(before),
        ctx,
      });
    });
  }

  // Aggregate posted debits/credits per account for the active workspace,
  // optionally scoped to a date range. Powers the chart-of-accounts trailing
  // balance column without us pulling every JE + line into JS like
  // `getJournalEntries` does. Filtering on `journalLines.companyId` (the
  // de-normalized stamp) keeps the join workspace-scoped even before the
  // entry-side filter, so cross-tenant leaks are impossible.
  async getAccountBalances(
    companyId: number,
    range?: { from?: Date; to?: Date },
  ): Promise<Map<number, { debit: number; credit: number }>> {
    // Belt-and-braces: filter on both the line-level and entry-level
    // companyId. journalLines stamps companyId on insert (defense-in-depth),
    // and the inner join to journalEntries already constrains by entry, but
    // adding the entry-side filter too keeps the query consistent with the
    // rest of storage and survives any future schema drift on either table.
    const conditions = [
      eq(journalLines.companyId, companyId),
      eq(journalEntries.companyId, companyId),
    ];
    if (range?.from) conditions.push(gte(journalEntries.entryDate, range.from));
    if (range?.to) conditions.push(lte(journalEntries.entryDate, range.to));

    const rows = await db
      .select({
        accountId: journalLines.accountId,
        debit: sql<string>`COALESCE(SUM(${journalLines.debit}), 0)`,
        credit: sql<string>`COALESCE(SUM(${journalLines.credit}), 0)`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
      .where(and(...conditions))
      .groupBy(journalLines.accountId);

    const out = new Map<number, { debit: number; credit: number }>();
    for (const r of rows) {
      out.set(r.accountId, { debit: Number(r.debit), credit: Number(r.credit) });
    }
    return out;
  }

  // ----- Budgets -----
  async getBudgets(companyId: number, year?: number, month?: number): Promise<Budget[]> {
    const conds = [eq(budgets.companyId, companyId)];
    if (year && month) {
      conds.push(eq(budgets.year, year));
      conds.push(eq(budgets.month, month));
    }
    return await db.select().from(budgets).where(and(...conds));
  }

  async upsertBudget(companyId: number, input: InsertBudget): Promise<Budget> {
    const existing = await db.select().from(budgets).where(
      and(
        eq(budgets.companyId, companyId),
        eq(budgets.accountId, input.accountId),
        eq(budgets.year, input.year),
        eq(budgets.month, input.month),
      ),
    );
    if (existing[0]) {
      const [updated] = await db
        .update(budgets)
        .set({ amount: String(input.amount) })
        .where(eq(budgets.id, existing[0].id))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(budgets)
      .values({ ...input, companyId, amount: String(input.amount) })
      .returning();
    return created;
  }

  async deleteBudget(companyId: number, id: number): Promise<void> {
    await db.delete(budgets).where(and(eq(budgets.id, id), eq(budgets.companyId, companyId)));
  }

  // ----- Settings (per-company singleton) -----
  async getSettings(companyId: number): Promise<OrgSettings> {
    const rows = await db.select().from(settings).where(eq(settings.companyId, companyId));
    if (rows[0]) return rows[0];
    const [created] = await db.insert(settings).values({ companyId }).returning();
    return created;
  }

  async updateSettings(companyId: number, input: UpsertOrgSettings): Promise<OrgSettings> {
    const existing = await this.getSettings(companyId);
    // Update the workspace settings row and the corresponding company row in a
    // single transaction so the two stored copies of currency (settings.* and
    // companies.*) can never drift after a partial failure. The companies row
    // backs Fixed Assets, the workspace switcher, and the command palette.
    return await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(settings)
        .set({ ...input, vatRate: String(input.vatRate) })
        .where(eq(settings.id, existing.id))
        .returning();
      await tx
        .update(companies)
        .set({
          functionalCurrency: input.currencyCode,
          currencySymbol: input.currencySymbol,
        })
        .where(eq(companies.id, companyId));
      return updated;
    });
  }

  // ----- HR -----
  async getEmployees(companyId: number): Promise<Employee[]> {
    return await db
      .select()
      .from(employees)
      .where(eq(employees.companyId, companyId))
      .orderBy(employees.fullName);
  }

  async createEmployee(companyId: number, input: InsertEmployee, ctx?: AuditContext): Promise<Employee> {
    // Insert + audit in one transaction (task #222) so HR cannot grow an
    // employee row that is missing from the audit history.
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(employees)
        .values({
          ...input,
          companyId,
          baseSalary: String(input.baseSalary),
          allowances: String(input.allowances ?? 0),
        })
        .returning();
      await recordAudit(tx, {
        companyId,
        entityType: "employee",
        entityId: created.id,
        action: "create",
        changes: snapshotChanges(created),
        ctx,
      });
      return created;
    });
  }

  async updateEmployee(companyId: number, id: number, input: Partial<InsertEmployee>, ctx?: AuditContext): Promise<Employee> {
    const patch: any = { ...input };
    if (input.baseSalary !== undefined) patch.baseSalary = String(input.baseSalary);
    if (input.allowances !== undefined) patch.allowances = String(input.allowances);
    // Update + diff-audit commit atomically (task #222). The before-row
    // SELECT moves inside the transaction so the diff is computed against
    // a snapshot the transaction itself observes (and the diff reflects
    // exactly what the transaction is about to commit).
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(employees).where(and(eq(employees.id, id), eq(employees.companyId, companyId)));
      const [updated] = await tx.update(employees).set(patch).where(and(eq(employees.id, id), eq(employees.companyId, companyId))).returning();
      if (before && updated) {
        const changes = diffChanges(before, updated);
        if (changes.length > 0) {
          await recordAudit(tx, { companyId, entityType: "employee", entityId: id, action: "update", changes, ctx });
        }
      }
      return updated;
    });
  }

  async deleteEmployee(companyId: number, id: number, ctx?: AuditContext): Promise<void> {
    // Delete + audit row in one transaction (task #222).
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(employees).where(and(eq(employees.id, id), eq(employees.companyId, companyId)));
      await tx.delete(employees).where(and(eq(employees.id, id), eq(employees.companyId, companyId)));
      if (before) {
        await recordAudit(tx, { companyId, entityType: "employee", entityId: id, action: "delete", changes: snapshotChanges(before), ctx });
      }
    });
  }

  async getAttendance(companyId: number, employeeId?: number, yearMonth?: string): Promise<Attendance[]> {
    const all = await db
      .select()
      .from(attendance)
      .where(eq(attendance.companyId, companyId));
    return all.filter(
      (a) =>
        (!employeeId || a.employeeId === employeeId) &&
        (!yearMonth || a.date.startsWith(yearMonth)),
    );
  }

  async upsertAttendance(companyId: number, input: InsertAttendance, ctx?: AuditContext): Promise<Attendance> {
    // Read existing row + the upsert + the audit row commit together
    // (task #222) — both branches (update vs insert) keep the entity write
    // and its audit atomic.
    return await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(attendance)
        .where(
          and(
            eq(attendance.companyId, companyId),
            eq(attendance.employeeId, input.employeeId),
            eq(attendance.date, input.date),
          ),
        );
      if (existing[0]) {
        const before = existing[0];
        const [u] = await tx
          .update(attendance)
          .set({ status: input.status, overtimeHours: String(input.overtimeHours ?? 0) })
          .where(eq(attendance.id, existing[0].id))
          .returning();
        const changes = diffChanges(before, u);
        if (changes.length > 0) {
          await recordAudit(tx, { companyId, entityType: "attendance", entityId: u.id, action: "update", changes, ctx });
        }
        return u;
      }
      const [c] = await tx
        .insert(attendance)
        .values({ ...input, companyId, overtimeHours: String(input.overtimeHours ?? 0) })
        .returning();
      await recordAudit(tx, {
        companyId,
        entityType: "attendance",
        entityId: c.id,
        action: "create",
        changes: snapshotChanges(c),
        ctx,
      });
      return c;
    });
  }

  async getLeaves(companyId: number, employeeId?: number): Promise<Leave[]> {
    const all = await db
      .select()
      .from(leaves)
      .where(eq(leaves.companyId, companyId))
      .orderBy(desc(leaves.startDate));
    return employeeId ? all.filter((l) => l.employeeId === employeeId) : all;
  }

  async createLeave(companyId: number, input: InsertLeave, ctx?: AuditContext): Promise<Leave> {
    // Insert + audit in one transaction (task #222) so a leave row cannot
    // commit without its corresponding audit history entry.
    return await db.transaction(async (tx) => {
      const [c] = await tx.insert(leaves).values({ ...input, companyId }).returning();
      await recordAudit(tx, { companyId, entityType: "leave", entityId: c.id, action: "create", changes: snapshotChanges(c), ctx });
      return c;
    });
  }

  async deleteLeave(companyId: number, id: number, ctx?: AuditContext): Promise<void> {
    // Delete + audit row in one transaction (task #222). The before-row
    // SELECT moves inside the transaction so the snapshot we audit matches
    // exactly what the transaction is about to delete.
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(leaves).where(and(eq(leaves.id, id), eq(leaves.companyId, companyId)));
      await tx.delete(leaves).where(and(eq(leaves.id, id), eq(leaves.companyId, companyId)));
      if (before) {
        await recordAudit(tx, { companyId, entityType: "leave", entityId: id, action: "delete", changes: snapshotChanges(before), ctx });
      }
    });
  }

  // ----- Sales Portal (task #301) -----
  //
  // CRUD plus a few read-side helpers (`getCustomerBalance`,
  // `getCustomerInvoices`, `getNextSalesInvoiceNumber`). The auto-posting
  // pipeline that turns a draft invoice into a posted JE lives in
  // `server/sales.ts` so this module stays a pure data layer; deleting a
  // posted invoice goes through `reverseAutoPostedJournalEntry` (the same
  // helper payroll/depreciation/asset events use), which is also driven
  // from the sales service.
  //
  // All writes are scoped by `companyId` and audited inside the same
  // transaction as the entity write (task #222) so a failed audit insert
  // — including a workspace_isolation RLS rejection on `audit_log` itself
  // (task #169) — rolls the whole thing back.

  async listCustomers(companyId: number): Promise<Customer[]> {
    return await db
      .select()
      .from(customers)
      .where(eq(customers.companyId, companyId))
      .orderBy(customers.code);
  }

  async getCustomer(companyId: number, id: number): Promise<Customer | undefined> {
    const [row] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.companyId, companyId)));
    return row;
  }

  async createCustomer(companyId: number, input: InsertCustomer, ctx?: AuditContext): Promise<Customer> {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(customers)
        .values({ ...input, companyId })
        .returning();
      await recordAudit(tx, {
        companyId,
        entityType: "customer",
        entityId: created.id,
        action: "create",
        changes: snapshotChanges(created),
        ctx,
      });
      return created;
    });
  }

  async updateCustomer(
    companyId: number,
    id: number,
    input: Partial<InsertCustomer>,
    ctx?: AuditContext,
  ): Promise<Customer> {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.id, id), eq(customers.companyId, companyId)));
      const [updated] = await tx
        .update(customers)
        .set(input)
        .where(and(eq(customers.id, id), eq(customers.companyId, companyId)))
        .returning();
      if (before && updated) {
        const changes = diffChanges(before, updated);
        if (changes.length > 0) {
          await recordAudit(tx, {
            companyId,
            entityType: "customer",
            entityId: id,
            action: "update",
            changes,
            ctx,
          });
        }
      }
      return updated;
    });
  }

  async deleteCustomer(companyId: number, id: number, ctx?: AuditContext): Promise<void> {
    // Refuse to delete a customer that still owns invoices: the composite FK
    // would block the DELETE anyway, but a clear 409 from the route layer
    // is a much nicer UX than a generic Postgres error. The route layer
    // catches `JournalEntryReferenceConflictError` (the same one
    // payroll/asset events use) and turns it into a 409 with this message.
    const [{ count }] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.companyId, companyId), eq(salesInvoices.customerId, id)));
    if (count > 0) {
      throw new JournalEntryReferenceConflictError(
        `لا يمكن حذف عميل لديه فواتير (${count}) — قم بإلغاء الفواتير أولاً.`,
      );
    }
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.id, id), eq(customers.companyId, companyId)));
      await tx
        .delete(customers)
        .where(and(eq(customers.id, id), eq(customers.companyId, companyId)));
      if (before) {
        await recordAudit(tx, {
          companyId,
          entityType: "customer",
          entityId: id,
          action: "delete",
          changes: snapshotChanges(before),
          ctx,
        });
      }
    });
  }

  async getCustomerBalance(companyId: number, customerId: number): Promise<number> {
    // Open AR = posted, non-cancelled, credit invoices' (total - paid).
    // Cash invoices settle at posting time (the posting JE debits Cash
    // instead of AR), so they don't appear here.
    const rows = await db
      .select({
        total: salesInvoices.totalAmount,
        paid: salesInvoices.paidAmount,
      })
      .from(salesInvoices)
      .where(
        and(
          eq(salesInvoices.companyId, companyId),
          eq(salesInvoices.customerId, customerId),
          eq(salesInvoices.status, "posted"),
          eq(salesInvoices.paymentMethod, "credit"),
        ),
      );
    let sum = 0;
    for (const r of rows) {
      sum += Number(r.total) - Number(r.paid);
    }
    // Round to 2dp to keep currency math honest across many invoices.
    return Math.round(sum * 100) / 100;
  }

  async getCustomerInvoices(companyId: number, customerId: number): Promise<SalesInvoice[]> {
    return await db
      .select()
      .from(salesInvoices)
      .where(
        and(
          eq(salesInvoices.companyId, companyId),
          eq(salesInvoices.customerId, customerId),
        ),
      )
      .orderBy(desc(salesInvoices.invoiceDate), desc(salesInvoices.id));
  }

  async listProducts(companyId: number): Promise<Product[]> {
    return await db
      .select()
      .from(products)
      .where(eq(products.companyId, companyId))
      .orderBy(products.sku);
  }

  async getProduct(companyId: number, id: number): Promise<Product | undefined> {
    const [row] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.companyId, companyId)));
    return row;
  }

  async createProduct(companyId: number, input: InsertProduct, ctx?: AuditContext): Promise<Product> {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(products)
        .values({
          ...input,
          companyId,
          unitPrice: String(input.unitPrice ?? 0),
          unitCost: String(input.unitCost ?? 0),
          stockQty: String(input.stockQty ?? 0),
          vatRate: input.vatRate == null ? null : String(input.vatRate),
        })
        .returning();
      await recordAudit(tx, {
        companyId,
        entityType: "product",
        entityId: created.id,
        action: "create",
        changes: snapshotChanges(created),
        ctx,
      });
      return created;
    });
  }

  async updateProduct(
    companyId: number,
    id: number,
    input: Partial<InsertProduct>,
    ctx?: AuditContext,
  ): Promise<Product> {
    const patch: Record<string, unknown> = { ...input };
    if (input.unitPrice !== undefined) patch.unitPrice = String(input.unitPrice);
    if (input.unitCost !== undefined) patch.unitCost = String(input.unitCost);
    if (input.stockQty !== undefined) patch.stockQty = String(input.stockQty);
    if (input.vatRate !== undefined) patch.vatRate = input.vatRate == null ? null : String(input.vatRate);
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, id), eq(products.companyId, companyId)));
      const [updated] = await tx
        .update(products)
        .set(patch)
        .where(and(eq(products.id, id), eq(products.companyId, companyId)))
        .returning();
      if (before && updated) {
        const changes = diffChanges(before, updated);
        if (changes.length > 0) {
          await recordAudit(tx, {
            companyId,
            entityType: "product",
            entityId: id,
            action: "update",
            changes,
            ctx,
          });
        }
      }
      return updated;
    });
  }

  async deleteProduct(companyId: number, id: number, ctx?: AuditContext): Promise<void> {
    // Mirrors the customer guard — the FK on `sales_invoice_lines.product_id`
    // would refuse anyway, but a clean 409 explains *why*.
    const [{ count }] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(salesInvoiceLines)
      .where(
        and(
          eq(salesInvoiceLines.companyId, companyId),
          eq(salesInvoiceLines.productId, id),
        ),
      );
    if (count > 0) {
      throw new JournalEntryReferenceConflictError(
        `لا يمكن حذف منتج مستخدم في بنود فواتير (${count}) — قم بحذف الفواتير المرتبطة أولاً.`,
      );
    }
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, id), eq(products.companyId, companyId)));
      await tx
        .delete(products)
        .where(and(eq(products.id, id), eq(products.companyId, companyId)));
      if (before) {
        await recordAudit(tx, {
          companyId,
          entityType: "product",
          entityId: id,
          action: "delete",
          changes: snapshotChanges(before),
          ctx,
        });
      }
    });
  }

  async listSalesInvoices(
    companyId: number,
    filters: { status?: SalesInvoiceStatus; customerId?: number } = {},
  ): Promise<SalesInvoiceWithLines[]> {
    const predicates = [eq(salesInvoices.companyId, companyId)];
    if (filters.status) predicates.push(eq(salesInvoices.status, filters.status));
    if (filters.customerId) predicates.push(eq(salesInvoices.customerId, filters.customerId));
    const headers = await db
      .select()
      .from(salesInvoices)
      .where(and(...predicates))
      .orderBy(desc(salesInvoices.invoiceDate), desc(salesInvoices.id));
    if (headers.length === 0) return [];
    return await this.hydrateSalesInvoices(companyId, headers);
  }

  async getSalesInvoice(companyId: number, id: number): Promise<SalesInvoiceWithLines | undefined> {
    const [row] = await db
      .select()
      .from(salesInvoices)
      .where(and(eq(salesInvoices.id, id), eq(salesInvoices.companyId, companyId)));
    if (!row) return undefined;
    const [hydrated] = await this.hydrateSalesInvoices(companyId, [row]);
    return hydrated;
  }

  /**
   * Bulk-hydrates a list of sales-invoice headers with their lines, the
   * customer summary, and the linked JE reference. Issued as 3 indexed
   * lookups regardless of how many invoices the caller is paging — the
   * detail page and the list both go through here.
   */
  private async hydrateSalesInvoices(
    companyId: number,
    headers: SalesInvoice[],
  ): Promise<SalesInvoiceWithLines[]> {
    const ids = headers.map((h) => h.id);
    const customerIds = Array.from(new Set(headers.map((h) => h.customerId)));
    const jeIds = Array.from(
      new Set(headers.map((h) => h.journalEntryId).filter((v): v is number => v != null)),
    );

    const [linesRows, customerRows, jeRows] = await Promise.all([
      db
        .select()
        .from(salesInvoiceLines)
        .where(
          and(
            eq(salesInvoiceLines.companyId, companyId),
            inArray(salesInvoiceLines.invoiceId, ids),
          ),
        )
        .orderBy(salesInvoiceLines.id),
      customerIds.length === 0
        ? Promise.resolve([] as Customer[])
        : db
            .select()
            .from(customers)
            .where(
              and(
                eq(customers.companyId, companyId),
                inArray(customers.id, customerIds),
              ),
            ),
      jeIds.length === 0
        ? Promise.resolve([] as { id: number; reference: string }[])
        : db
            .select({ id: journalEntries.id, reference: journalEntries.reference })
            .from(journalEntries)
            .where(
              and(
                eq(journalEntries.companyId, companyId),
                inArray(journalEntries.id, jeIds),
              ),
            ),
    ]);

    const linesByInvoice = new Map<number, SalesInvoiceLine[]>();
    for (const l of linesRows) {
      const arr = linesByInvoice.get(l.invoiceId) ?? [];
      arr.push(l);
      linesByInvoice.set(l.invoiceId, arr);
    }
    const customerById = new Map<number, Customer>(customerRows.map((c) => [c.id, c]));
    const jeRefById = new Map<number, string>(jeRows.map((j) => [j.id, j.reference]));

    return headers.map<SalesInvoiceWithLines>((h) => {
      const c = customerById.get(h.customerId);
      return {
        ...h,
        lines: linesByInvoice.get(h.id) ?? [],
        customer: c
          ? { id: c.id, code: c.code, nameAr: c.nameAr, nameEn: c.nameEn }
          : null,
        journalEntryReference: h.journalEntryId ? jeRefById.get(h.journalEntryId) ?? null : null,
      };
    });
  }

  async getNextSalesInvoiceNumber(companyId: number): Promise<string> {
    // Sequential per-workspace counter. We scan the existing INV-#### refs
    // and pick max+1 instead of relying on a sequence so a recovered /
    // imported workspace continues from where its history left off.
    // Numbers below 1000 are zero-padded to 4 digits ("INV-0001").
    const rows = await db
      .select({ number: salesInvoices.number })
      .from(salesInvoices)
      .where(eq(salesInvoices.companyId, companyId));
    let max = 0;
    for (const r of rows) {
      const m = /^INV-(\d+)$/.exec(r.number);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    const next = max + 1;
    return `INV-${String(next).padStart(4, "0")}`;
  }

  async createDraftSalesInvoice(
    companyId: number,
    header: {
      number: string;
      customerId: number;
      invoiceDate: string;
      dueDate?: string | null;
      paymentMethod: SalesInvoicePaymentMethod;
      notes?: string;
      subtotal: number;
      vatAmount: number;
      totalAmount: number;
      cogsAmount: number;
    },
    lines: Array<{
      productId: number | null;
      description: string;
      quantity: number;
      unitPrice: number;
      vatRate: number;
      lineSubtotal: number;
      lineVat: number;
      lineTotal: number;
      unitCost: number;
      costAmount: number;
    }>,
    ctx?: AuditContext,
  ): Promise<SalesInvoiceWithLines> {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(salesInvoices)
        .values({
          companyId,
          number: header.number,
          customerId: header.customerId,
          invoiceDate: header.invoiceDate,
          dueDate: header.dueDate ?? null,
          status: "draft",
          paymentMethod: header.paymentMethod,
          subtotal: header.subtotal.toFixed(2),
          vatAmount: header.vatAmount.toFixed(2),
          totalAmount: header.totalAmount.toFixed(2),
          cogsAmount: header.cogsAmount.toFixed(2),
          paidAmount: "0",
          notes: header.notes ?? "",
        })
        .returning();
      const insertedLines = lines.length === 0
        ? []
        : await tx
            .insert(salesInvoiceLines)
            .values(
              lines.map((l) => ({
                companyId,
                invoiceId: created.id,
                productId: l.productId ?? null,
                description: l.description,
                quantity: l.quantity.toFixed(4),
                unitPrice: l.unitPrice.toFixed(2),
                vatRate: l.vatRate.toFixed(4),
                lineSubtotal: l.lineSubtotal.toFixed(2),
                lineVat: l.lineVat.toFixed(2),
                lineTotal: l.lineTotal.toFixed(2),
                unitCost: l.unitCost.toFixed(2),
                costAmount: l.costAmount.toFixed(2),
              })),
            )
            .returning();
      await recordAudit(tx, {
        companyId,
        entityType: "sales_invoice",
        entityId: created.id,
        action: "create",
        changes: [
          { field: "number", to: created.number },
          { field: "customerId", to: created.customerId },
          { field: "invoiceDate", to: created.invoiceDate },
          { field: "paymentMethod", to: created.paymentMethod },
          { field: "subtotal", to: created.subtotal },
          { field: "vatAmount", to: created.vatAmount },
          { field: "totalAmount", to: created.totalAmount },
          { field: "lineCount", to: insertedLines.length },
        ],
        ctx,
      });
      // Hydrate using the same shape the list/get endpoints return so the
      // POST /api/sales/invoices response is interchangeable with a GET on
      // the same id (no second round-trip from the create dialog).
      return {
        ...created,
        lines: insertedLines,
        customer: null,
        journalEntryReference: null,
      };
    });
  }

  async updateDraftSalesInvoice(
    companyId: number,
    id: number,
    header: {
      customerId?: number;
      invoiceDate?: string;
      dueDate?: string | null;
      paymentMethod?: SalesInvoicePaymentMethod;
      notes?: string;
      subtotal: number;
      vatAmount: number;
      totalAmount: number;
      cogsAmount: number;
    },
    lines: Array<{
      productId: number | null;
      description: string;
      quantity: number;
      unitPrice: number;
      vatRate: number;
      lineSubtotal: number;
      lineVat: number;
      lineTotal: number;
      unitCost: number;
      costAmount: number;
    }>,
    ctx?: AuditContext,
  ): Promise<SalesInvoiceWithLines> {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(salesInvoices)
        .where(and(eq(salesInvoices.id, id), eq(salesInvoices.companyId, companyId)));
      if (!before) {
        throw new Error("الفاتورة غير موجودة");
      }
      if (before.status !== "draft") {
        throw new Error("لا يمكن تعديل فاتورة بعد ترحيلها");
      }
      const headerPatch: Record<string, unknown> = {
        subtotal: header.subtotal.toFixed(2),
        vatAmount: header.vatAmount.toFixed(2),
        totalAmount: header.totalAmount.toFixed(2),
        cogsAmount: header.cogsAmount.toFixed(2),
      };
      if (header.customerId !== undefined) headerPatch.customerId = header.customerId;
      if (header.invoiceDate !== undefined) headerPatch.invoiceDate = header.invoiceDate;
      if (header.dueDate !== undefined) headerPatch.dueDate = header.dueDate;
      if (header.paymentMethod !== undefined) headerPatch.paymentMethod = header.paymentMethod;
      if (header.notes !== undefined) headerPatch.notes = header.notes;
      const [updated] = await tx
        .update(salesInvoices)
        .set(headerPatch)
        .where(and(eq(salesInvoices.id, id), eq(salesInvoices.companyId, companyId)))
        .returning();
      // Replace-all on lines is cheaper to reason about than per-row diff
      // (drafts are short by definition) and keeps audit trails honest:
      // an update that removes a line shows up as `lineCount` change.
      await tx
        .delete(salesInvoiceLines)
        .where(
          and(
            eq(salesInvoiceLines.companyId, companyId),
            eq(salesInvoiceLines.invoiceId, id),
          ),
        );
      const insertedLines = lines.length === 0
        ? []
        : await tx
            .insert(salesInvoiceLines)
            .values(
              lines.map((l) => ({
                companyId,
                invoiceId: id,
                productId: l.productId ?? null,
                description: l.description,
                quantity: l.quantity.toFixed(4),
                unitPrice: l.unitPrice.toFixed(2),
                vatRate: l.vatRate.toFixed(4),
                lineSubtotal: l.lineSubtotal.toFixed(2),
                lineVat: l.lineVat.toFixed(2),
                lineTotal: l.lineTotal.toFixed(2),
                unitCost: l.unitCost.toFixed(2),
                costAmount: l.costAmount.toFixed(2),
              })),
            )
            .returning();
      const changes = diffChanges(before, updated);
      changes.push({ field: "lineCount", from: undefined, to: insertedLines.length });
      await recordAudit(tx, {
        companyId,
        entityType: "sales_invoice",
        entityId: id,
        action: "update",
        changes,
        ctx,
      });
      return {
        ...updated,
        lines: insertedLines,
        customer: null,
        journalEntryReference: null,
      };
    });
  }

  async markSalesInvoicePosted(
    companyId: number,
    invoiceId: number,
    journalEntryId: number,
    inventoryAdjustments: Array<{ productId: number; quantity: number }>,
    ctx?: AuditContext,
  ): Promise<SalesInvoiceWithLines> {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(salesInvoices)
        .where(
          and(eq(salesInvoices.id, invoiceId), eq(salesInvoices.companyId, companyId)),
        );
      if (!before) throw new Error("الفاتورة غير موجودة");
      if (before.status !== "draft") throw new Error("الفاتورة ليست مسودة");
      const total = Number(before.totalAmount);
      const paidAmount = before.paymentMethod === "cash" ? total : 0;
      const [updated] = await tx
        .update(salesInvoices)
        .set({
          status: "posted",
          journalEntryId,
          paidAmount: paidAmount.toFixed(2),
        })
        .where(
          and(eq(salesInvoices.id, invoiceId), eq(salesInvoices.companyId, companyId)),
        )
        .returning();
      // Decrement inventory for each goods line. Service products / free-form
      // lines arrive here with `productId: null` (the sales service strips
      // them) so we only ever touch real product rows.
      for (const adj of inventoryAdjustments) {
        await tx
          .update(products)
          .set({
            stockQty: sql`${products.stockQty} - ${adj.quantity.toFixed(4)}`,
          })
          .where(
            and(eq(products.id, adj.productId), eq(products.companyId, companyId)),
          );
      }
      await recordAudit(tx, {
        companyId,
        entityType: "sales_invoice",
        entityId: invoiceId,
        action: "post",
        changes: [
          { field: "status", from: "draft", to: "posted" },
          { field: "journalEntryId", to: journalEntryId },
          { field: "paidAmount", to: paidAmount.toFixed(2) },
          { field: "inventoryAdjustments", to: inventoryAdjustments.length },
        ],
        ctx,
      });
      const lineRows = await tx
        .select()
        .from(salesInvoiceLines)
        .where(
          and(
            eq(salesInvoiceLines.companyId, companyId),
            eq(salesInvoiceLines.invoiceId, invoiceId),
          ),
        )
        .orderBy(salesInvoiceLines.id);
      return {
        ...updated,
        lines: lineRows,
        customer: null,
        journalEntryReference: null,
      };
    });
  }

  async reverseSalesInvoicePosting(
    companyId: number,
    invoiceId: number,
    mode: "cancel" | "delete",
    ctx?: AuditContext,
  ): Promise<void> {
    const [before] = await db
      .select()
      .from(salesInvoices)
      .where(
        and(eq(salesInvoices.id, invoiceId), eq(salesInvoices.companyId, companyId)),
      );
    if (!before) return;
    if (before.status !== "posted") {
      throw new Error("الفاتورة ليست مرحّلة");
    }
    const lineRows = await db
      .select()
      .from(salesInvoiceLines)
      .where(
        and(
          eq(salesInvoiceLines.companyId, companyId),
          eq(salesInvoiceLines.invoiceId, invoiceId),
        ),
      );

    await reverseAutoPostedJournalEntry({
      companyId,
      source: { kind: "sales_invoice", id: invoiceId },
      journalEntryId: before.journalEntryId,
      conflictMessage: (conflicts) =>
        `لا يمكن عكس الفاتورة لأن قيدها المحاسبي مرتبط بسجلات أخرى: ${conflicts.join("، ")}`,
      extraDelete: async (tx) => {
        // Restore stock for goods lines (service / free-form lines have
        // `productId === null` and were never decremented at posting time).
        for (const l of lineRows) {
          if (l.productId == null) continue;
          const qty = Number(l.quantity);
          if (qty <= 0) continue;
          await tx
            .update(products)
            .set({
              stockQty: sql`${products.stockQty} + ${qty.toFixed(4)}`,
            })
            .where(
              and(eq(products.id, l.productId), eq(products.companyId, companyId)),
            );
        }
        if (mode === "cancel") {
          await tx
            .update(salesInvoices)
            .set({
              status: "cancelled",
              journalEntryId: null,
              paidAmount: "0",
            })
            .where(
              and(
                eq(salesInvoices.id, invoiceId),
                eq(salesInvoices.companyId, companyId),
              ),
            );
          await recordAudit(tx, {
            companyId,
            entityType: "sales_invoice",
            entityId: invoiceId,
            action: "update",
            changes: [
              { field: "status", from: "posted", to: "cancelled" },
              { field: "journalEntryId", from: before.journalEntryId ?? null, to: null },
            ],
            ctx,
          });
        } else {
          await tx
            .delete(salesInvoiceLines)
            .where(
              and(
                eq(salesInvoiceLines.companyId, companyId),
                eq(salesInvoiceLines.invoiceId, invoiceId),
              ),
            );
          await tx
            .delete(salesInvoices)
            .where(
              and(
                eq(salesInvoices.id, invoiceId),
                eq(salesInvoices.companyId, companyId),
              ),
            );
          await recordAudit(tx, {
            companyId,
            entityType: "sales_invoice",
            entityId: invoiceId,
            action: "delete",
            changes: snapshotChanges(before),
            ctx,
          });
        }
      },
      ctx,
    });
  }

  async deleteDraftOrCancelledSalesInvoice(
    companyId: number,
    invoiceId: number,
    ctx?: AuditContext,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(salesInvoices)
        .where(
          and(eq(salesInvoices.id, invoiceId), eq(salesInvoices.companyId, companyId)),
        );
      if (!before) return;
      if (before.status === "posted") {
        throw new Error("استخدم reverseSalesInvoicePosting لحذف فاتورة مرحّلة");
      }
      await tx
        .delete(salesInvoiceLines)
        .where(
          and(
            eq(salesInvoiceLines.companyId, companyId),
            eq(salesInvoiceLines.invoiceId, invoiceId),
          ),
        );
      await tx
        .delete(salesInvoices)
        .where(
          and(eq(salesInvoices.id, invoiceId), eq(salesInvoices.companyId, companyId)),
        );
      await recordAudit(tx, {
        companyId,
        entityType: "sales_invoice",
        entityId: invoiceId,
        action: "delete",
        changes: snapshotChanges(before),
        ctx,
      });
    });
  }

  // ----- Companies -----
  async getCompanies(): Promise<Company[]> {
    return await db.select().from(companies).orderBy(companies.name);
  }
  async createCompany(
    input: InsertCompany,
    opts?: { ownerMembership?: { userId: string; role?: "owner" | "accountant" | "viewer" } },
  ): Promise<Company> {
    // Creating a new workspace inherently crosses the active workspace's
    // RLS boundary: the seed below writes accounts under the *new* company's
    // id, which never matches `app.current_company_id` when an owner is
    // calling this from inside their existing workspace's scope. Wrap the
    // whole flow in `withWorkspaceCreation` (the named, grep-able helper
    // for "I am about to create a new workspace") so the seed inserts are
    // not rejected by the workspace_isolation policy. The lint at
    // tests/e2e/db-isolation-allowlist.spec.ts statically requires that
    // every `insert(companies)` sits inside one of these blocks. See
    // docs/design/workspace-isolation-defense-in-depth.md → "Bypass paths".
    //
    // The company write, the chart-of-accounts seed, AND the optional
    // owner-membership wire-up all share a single transaction so the
    // workspace cannot commit without a fully seeded chart of accounts and
    // (when the caller asked for it) without its owner membership in
    // place. Without this, a failed membership insert would leave the
    // company + CoA committed but invisible to its creator (the
    // `/api/companies` list is filtered by membership) and effectively
    // orphan the accounts in the database. See task #218.
    const { withWorkspaceCreation } = await import("./db");
    const { seedDefaultCoaInTx } = await import("./init-coa");
    const { memberships: membershipsTable } = await import("@shared/schema");
    return withWorkspaceCreation(async () => {
      if (input.isDefault) {
        await db.update(companies).set({ isDefault: false });
      }
      return await db.transaction(async (tx) => {
        const [c] = await tx.insert(companies).values(input).returning();
        await seedDefaultCoaInTx(tx, c.id);
        if (opts?.ownerMembership) {
          await tx.insert(membershipsTable).values({
            userId: opts.ownerMembership.userId,
            companyId: c.id,
            role: opts.ownerMembership.role ?? "owner",
          });
        }
        return c;
      });
    });
  }
  async updateCompany(id: number, input: Partial<InsertCompany>): Promise<Company> {
    if (input.isDefault) {
      await db.update(companies).set({ isDefault: false });
    }
    const [u] = await db.update(companies).set(input).where(eq(companies.id, id)).returning();
    return u;
  }

  // ----- FX Rates -----
  async getFxRates(companyId?: number): Promise<FxRate[]> {
    if (companyId) {
      return await db.select().from(fxRates).where(eq(fxRates.companyId, companyId)).orderBy(desc(fxRates.rateDate));
    }
    return await db.select().from(fxRates).orderBy(desc(fxRates.rateDate));
  }
  async createFxRate(input: InsertFxRate & { companyId: number }): Promise<FxRate> {
    const [c] = await db.insert(fxRates).values({ ...input, rate: String(input.rate) }).returning();
    return c;
  }
  async deleteFxRate(id: number): Promise<void> {
    await db.delete(fxRates).where(eq(fxRates.id, id));
  }

  // ----- Asset Categories -----
  async getAssetCategories(companyId?: number): Promise<AssetCategory[]> {
    if (companyId) {
      return await db.select().from(assetCategories).where(eq(assetCategories.companyId, companyId)).orderBy(assetCategories.name);
    }
    return await db.select().from(assetCategories).orderBy(assetCategories.name);
  }
  async createAssetCategory(input: InsertAssetCategory & { companyId: number }): Promise<AssetCategory> {
    const [c] = await db.insert(assetCategories).values(input).returning();
    return c;
  }
  async updateAssetCategory(id: number, input: Partial<InsertAssetCategory>): Promise<AssetCategory> {
    const [u] = await db.update(assetCategories).set(input).where(eq(assetCategories.id, id)).returning();
    return u;
  }

  // ----- Fixed Assets -----
  async getFixedAssets(companyId?: number): Promise<FixedAsset[]> {
    if (companyId) {
      return await db.select().from(fixedAssets).where(eq(fixedAssets.companyId, companyId)).orderBy(fixedAssets.code);
    }
    return await db.select().from(fixedAssets).orderBy(fixedAssets.code);
  }
  async getFixedAsset(id: number): Promise<FixedAsset | undefined> {
    const [a] = await db.select().from(fixedAssets).where(eq(fixedAssets.id, id));
    return a;
  }
  async createFixedAsset(input: Omit<InsertFixedAsset, "customSchedule"> & { cost: number; companyId: number; customSchedule?: string | null }, ctx?: AuditContext): Promise<FixedAsset> {
    // Insert + audit in one transaction (task #222) so a fixed-asset row
    // cannot exist in the books without a "create" entry in its history.
    return await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(fixedAssets)
        .values({
          ...input,
          txCost: String(input.txCost),
          fxRate: String(input.fxRate ?? 1),
          residual: String(input.residual ?? 0),
          cost: String(input.cost),
          unitsTotal: input.unitsTotal != null ? String(input.unitsTotal) : null,
          customSchedule: input.customSchedule ?? null,
        })
        .returning();
      await recordAudit(tx, {
        companyId: c.companyId,
        entityType: "fixed_asset",
        entityId: c.id,
        action: "create",
        changes: snapshotChanges(c),
        ctx,
      });
      return c;
    });
  }
  async updateFixedAssetBalances(
    id: number,
    patch: Partial<{
      cost: number;
      accumDepreciation: number;
      accumImpairment: number;
      revalSurplus: number;
      accumDepNoImpairment: number;
      accumRevalLoss: number;
      lastDepreciatedPeriod: string;
      status: string;
    }>,
    ctx?: AuditContext,
  ): Promise<FixedAsset> {
    const set: Record<string, string | undefined> = {};
    if (patch.cost !== undefined) set.cost = String(patch.cost);
    if (patch.accumDepreciation !== undefined) set.accumDepreciation = String(patch.accumDepreciation);
    if (patch.accumImpairment !== undefined) set.accumImpairment = String(patch.accumImpairment);
    if (patch.revalSurplus !== undefined) set.revalSurplus = String(patch.revalSurplus);
    if (patch.accumDepNoImpairment !== undefined) set.accumDepNoImpairment = String(patch.accumDepNoImpairment);
    if (patch.accumRevalLoss !== undefined) set.accumRevalLoss = String(patch.accumRevalLoss);
    if (patch.lastDepreciatedPeriod !== undefined) set.lastDepreciatedPeriod = patch.lastDepreciatedPeriod;
    if (patch.status !== undefined) set.status = patch.status;
    // Read before-row + balance update + diff-audit in one transaction
    // (task #222) so the snapshot we audit matches the row the transaction
    // writes — no chance of an audit row pointing at a balance that
    // never committed.
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(fixedAssets).where(eq(fixedAssets.id, id));
      const [u] = await tx.update(fixedAssets).set(set).where(eq(fixedAssets.id, id)).returning();
      if (before && u) {
        const changes = diffChanges(before, u).filter((c) => set[c.field as string] !== undefined);
        if (changes.length > 0) {
          await recordAudit(tx, { companyId: before.companyId, entityType: "fixed_asset", entityId: id, action: "update", changes, ctx });
        }
      }
      return u;
    });
  }
  async deleteFixedAsset(id: number, ctx?: AuditContext): Promise<void> {
    // Cascade delete + audit row commit together (task #222) so the audit
    // row cannot exist for an asset that was never deleted, nor can the
    // asset+children disappear silently with no "delete" entry.
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(fixedAssets).where(eq(fixedAssets.id, id));
      await tx.delete(assetComponents).where(eq(assetComponents.assetId, id));
      await tx.delete(depreciationSchedule).where(eq(depreciationSchedule.assetId, id));
      await tx.delete(depreciationPostings).where(eq(depreciationPostings.assetId, id));
      await tx.delete(impairmentEvents).where(eq(impairmentEvents.assetId, id));
      await tx.delete(revaluationEvents).where(eq(revaluationEvents.assetId, id));
      await tx.delete(disposals).where(eq(disposals.assetId, id));
      await tx.delete(fixedAssets).where(eq(fixedAssets.id, id));
      if (before) {
        await recordAudit(tx, {
          companyId: before.companyId,
          entityType: "fixed_asset",
          entityId: id,
          action: "delete",
          changes: snapshotChanges(before),
          ctx,
        });
      }
    });
  }

  // ----- Asset Components -----
  async getAssetComponents(assetId: number): Promise<AssetComponent[]> {
    return await db.select().from(assetComponents).where(eq(assetComponents.assetId, assetId));
  }
  async createAssetComponent(
    input: InsertAssetComponent & { companyId: number },
  ): Promise<AssetComponent> {
    // companyId is required so the composite FK to fixed_assets(id, companyId)
    // is satisfied — see migration 0007 / docs/design/workspace-isolation-defense-in-depth.md.
    const [c] = await db
      .insert(assetComponents)
      .values({
        ...input,
        companyId: input.companyId,
        cost: String(input.cost),
        residual: String(input.residual ?? 0),
        unitsTotal: input.unitsTotal != null ? String(input.unitsTotal) : null,
      })
      .returning();
    return c;
  }

  // ----- Depreciation -----
  async getDepreciationRuns(companyId?: number): Promise<DepreciationRun[]> {
    if (companyId) {
      return await db.select().from(depreciationRuns).where(eq(depreciationRuns.companyId, companyId)).orderBy(desc(depreciationRuns.year), desc(depreciationRuns.month));
    }
    return await db.select().from(depreciationRuns).orderBy(desc(depreciationRuns.year), desc(depreciationRuns.month));
  }
  async getDepreciationRun(id: number): Promise<DepreciationRun | undefined> {
    const [r] = await db.select().from(depreciationRuns).where(eq(depreciationRuns.id, id));
    return r;
  }
  async findPostedRun(companyId: number, year: number, month: number): Promise<DepreciationRun | undefined> {
    const rows = await db
      .select()
      .from(depreciationRuns)
      .where(
        and(
          eq(depreciationRuns.companyId, companyId),
          eq(depreciationRuns.year, year),
          eq(depreciationRuns.month, month),
          eq(depreciationRuns.status, "posted")
        )
      );
    return rows[0];
  }
  async createDepreciationRun(input: { companyId: number; year: number; month: number; postings: { assetId: number; componentId?: number | null; amount: number }[] }): Promise<DepreciationRun> {
    const total = input.postings.reduce((s, p) => s + p.amount, 0);
    const [run] = await db.insert(depreciationRuns).values({
      companyId: input.companyId, year: input.year, month: input.month,
      status: "draft", totalAmount: String(total),
    }).returning();
    if (input.postings.length > 0) {
      // companyId on each posting must match the run — composite FKs to
      // depreciation_runs and fixed_assets enforce this at the DB layer.
      await db.insert(depreciationPostings).values(input.postings.map((p) => ({
        companyId: input.companyId,
        runId: run.id,
        assetId: p.assetId,
        componentId: p.componentId ?? null,
        amount: String(p.amount),
      })));
    }
    return run;
  }
  async getDepreciationPostings(runId: number): Promise<DepreciationPosting[]> {
    return await db.select().from(depreciationPostings).where(eq(depreciationPostings.runId, runId));
  }
  async markRunPosted(runId: number, journalEntryId: number): Promise<DepreciationRun> {
    const [u] = await db.update(depreciationRuns)
      .set({ status: "posted", journalEntryId, postedAt: new Date() })
      .where(eq(depreciationRuns.id, runId))
      .returning();
    return u;
  }
  async deleteDepreciationRun(
    companyId: number,
    runId: number,
    ctx?: AuditContext,
  ): Promise<void> {
    const [before] = await db
      .select()
      .from(depreciationRuns)
      .where(
        and(eq(depreciationRuns.id, runId), eq(depreciationRuns.companyId, companyId)),
      );
    if (!before) return;

    // Snapshot postings BEFORE the cascade so we can roll back the per-asset
    // accumDepreciation deltas this run had stamped on each fixed asset. We
    // intentionally do NOT touch `accumDepNoImpairment` — the noImp delta is
    // not stored per posting, and leaving the running counter slightly higher
    // is the conservative side for the IAS 36 reversal cap.
    const postings = await db
      .select()
      .from(depreciationPostings)
      .where(eq(depreciationPostings.runId, runId));
    const perAssetReversal = new Map<number, number>();
    for (const p of postings) {
      perAssetReversal.set(
        p.assetId,
        (perAssetReversal.get(p.assetId) ?? 0) + Number(p.amount),
      );
    }

    await reverseAutoPostedJournalEntry({
      companyId,
      source: { kind: "depreciation_run", id: runId },
      journalEntryId: before.journalEntryId,
      conflictMessage: (conflicts) =>
        `لا يمكن حذف دورة الإهلاك لأن قيدها المحاسبي مرتبط بسجلات أخرى: ${conflicts.join("، ")}`,
      extraDelete: async (tx) => {
        // Schedule rows posted by this run point at it via a composite FK
        // (run_id, company_id) → depreciation_runs(id, company_id). Reset
        // them to "planned" so the FK is satisfied and a future re-post can
        // pick them up again.
        await tx
          .update(depreciationSchedule)
          .set({ status: "planned", runId: null })
          .where(eq(depreciationSchedule.runId, runId));
        await tx
          .delete(depreciationPostings)
          .where(eq(depreciationPostings.runId, runId));
        await tx
          .delete(depreciationRuns)
          .where(
            and(eq(depreciationRuns.id, runId), eq(depreciationRuns.companyId, companyId)),
          );
      },
      ctx,
    });

    // Roll back the per-asset accumDepreciation this run added. Done outside
    // the JE transaction so a slow update doesn't hold the audit-log row;
    // the run + JE are already gone, so partial failure here merely leaves a
    // stale balance that an admin can correct (rather than orphaning a JE).
    for (const [assetId, amount] of Array.from(perAssetReversal.entries())) {
      const [asset] = await db
        .select()
        .from(fixedAssets)
        .where(and(eq(fixedAssets.id, assetId), eq(fixedAssets.companyId, companyId)));
      if (!asset) continue;
      await db
        .update(fixedAssets)
        .set({ accumDepreciation: String(Math.max(0, Number(asset.accumDepreciation) - amount)) })
        .where(and(eq(fixedAssets.id, assetId), eq(fixedAssets.companyId, companyId)));
    }
  }

  // ----- Schedule (planned rows) -----
  async getSchedule(assetId: number): Promise<DepreciationScheduleRow[]> {
    return await db.select().from(depreciationSchedule).where(eq(depreciationSchedule.assetId, assetId));
  }
  async replaceSchedule(
    companyId: number,
    assetId: number,
    rows: { periodYear: number; periodMonth: number; plannedAmount: number; componentId?: number | null }[],
  ): Promise<void> {
    // companyId is required so the inserted schedule rows satisfy the
    // composite FK back to fixed_assets(id, companyId).
    await db.delete(depreciationSchedule).where(and(eq(depreciationSchedule.assetId, assetId), eq(depreciationSchedule.status, "planned")));
    if (rows.length === 0) return;
    await db.insert(depreciationSchedule).values(rows.map((r) => ({
      companyId,
      assetId,
      componentId: r.componentId ?? null,
      periodYear: r.periodYear,
      periodMonth: r.periodMonth,
      plannedAmount: String(r.plannedAmount),
      status: "planned",
    })));
  }
  async markScheduledPosted(
    companyId: number,
    runId: number,
    period: { year: number; month: number },
    items: { assetId: number; componentId?: number | null; amount: number }[],
  ): Promise<void> {
    for (const it of items) {
      const compCond = it.componentId == null
        ? sql`${depreciationSchedule.componentId} is null`
        : eq(depreciationSchedule.componentId, it.componentId);
      const existing = await db.select().from(depreciationSchedule).where(
        and(
          eq(depreciationSchedule.assetId, it.assetId),
          eq(depreciationSchedule.periodYear, period.year),
          eq(depreciationSchedule.periodMonth, period.month),
          compCond,
        ),
      );
      if (existing.length > 0) {
        await db.update(depreciationSchedule).set({
          status: "posted",
          runId,
          plannedAmount: String(it.amount),
        }).where(eq(depreciationSchedule.id, existing[0].id));
      } else {
        await db.insert(depreciationSchedule).values({
          companyId,
          assetId: it.assetId,
          componentId: it.componentId ?? null,
          periodYear: period.year,
          periodMonth: period.month,
          plannedAmount: String(it.amount),
          status: "posted",
          runId,
        });
      }
    }
  }
  async getDepreciationPostingsByAsset(assetId: number): Promise<Array<{ runId: number; year: number; month: number; amount: number; journalEntryId: number | null }>> {
    const rows = await db
      .select({
        runId: depreciationPostings.runId,
        amount: depreciationPostings.amount,
        year: depreciationRuns.year,
        month: depreciationRuns.month,
        journalEntryId: depreciationRuns.journalEntryId,
      })
      .from(depreciationPostings)
      .innerJoin(depreciationRuns, eq(depreciationPostings.runId, depreciationRuns.id))
      .where(eq(depreciationPostings.assetId, assetId));
    return rows.map((r) => ({ runId: r.runId, year: r.year, month: r.month, amount: Number(r.amount), journalEntryId: r.journalEntryId }));
  }

  // ----- Impairment / Revaluation / Disposal events -----
  async getImpairmentEvents(assetId?: number): Promise<ImpairmentEvent[]> {
    if (assetId) return await db.select().from(impairmentEvents).where(eq(impairmentEvents.assetId, assetId)).orderBy(desc(impairmentEvents.eventDate));
    return await db.select().from(impairmentEvents).orderBy(desc(impairmentEvents.eventDate));
  }
  async createImpairmentEvent(input: {
    companyId: number;
    assetId: number;
    componentId?: number | null;
    eventDate: string;
    recoverableAmount: number;
    lossAmount: number;
    journalEntryId?: number | null;
    notes?: string;
    /** See task #157: per-event snapshot of the per-asset balance changes the
     *  posting handler is about to apply. The matching delete subtracts these
     *  deltas to roll the asset (and its components) back precisely. */
    assetBalanceDelta?: ImpairmentBalanceDelta | null;
  }): Promise<ImpairmentEvent> {
    // companyId is required so the composite FK to fixed_assets(id, companyId)
    // (and asset_components(id, companyId) when componentId is set) holds.
    const [c] = await db.insert(impairmentEvents).values({
      companyId: input.companyId,
      assetId: input.assetId,
      componentId: input.componentId ?? null,
      eventDate: input.eventDate,
      recoverableAmount: String(input.recoverableAmount),
      lossAmount: String(input.lossAmount),
      journalEntryId: input.journalEntryId ?? null,
      notes: input.notes ?? "",
      assetBalanceDelta: input.assetBalanceDelta ?? null,
    }).returning();
    return c;
  }

  async getRevaluationEvents(assetId?: number): Promise<RevaluationEvent[]> {
    if (assetId) return await db.select().from(revaluationEvents).where(eq(revaluationEvents.assetId, assetId)).orderBy(desc(revaluationEvents.eventDate));
    return await db.select().from(revaluationEvents).orderBy(desc(revaluationEvents.eventDate));
  }
  async createRevaluationEvent(input: {
    companyId: number;
    assetId: number;
    eventDate: string;
    fairValue: number;
    method: string;
    surplusDelta: number;
    plImpact: number;
    journalEntryId?: number | null;
    notes?: string;
    /** See task #157. */
    assetBalanceDelta?: RevaluationBalanceDelta | null;
  }): Promise<RevaluationEvent> {
    // companyId is required so the composite FK to fixed_assets(id, companyId)
    // holds.
    const [c] = await db.insert(revaluationEvents).values({
      companyId: input.companyId,
      assetId: input.assetId,
      eventDate: input.eventDate,
      fairValue: String(input.fairValue),
      method: input.method,
      surplusDelta: String(input.surplusDelta),
      plImpact: String(input.plImpact),
      journalEntryId: input.journalEntryId ?? null,
      notes: input.notes ?? "",
      assetBalanceDelta: input.assetBalanceDelta ?? null,
    }).returning();
    return c;
  }

  async getDisposals(assetId?: number): Promise<Disposal[]> {
    if (assetId) return await db.select().from(disposals).where(eq(disposals.assetId, assetId)).orderBy(desc(disposals.eventDate));
    return await db.select().from(disposals).orderBy(desc(disposals.eventDate));
  }
  async createDisposal(input: {
    companyId: number;
    assetId: number;
    eventDate: string;
    proceeds: number;
    method: string;
    gainLoss: number;
    surplusTransferred: number;
    journalEntryId?: number | null;
    notes?: string;
    /** See task #157. */
    assetBalanceDelta?: DisposalBalanceDelta | null;
  }): Promise<Disposal> {
    // companyId is required so the composite FK to fixed_assets(id, companyId)
    // holds.
    const [c] = await db.insert(disposals).values({
      companyId: input.companyId,
      assetId: input.assetId,
      eventDate: input.eventDate,
      proceeds: String(input.proceeds),
      method: input.method,
      gainLoss: String(input.gainLoss),
      surplusTransferred: String(input.surplusTransferred),
      journalEntryId: input.journalEntryId ?? null,
      notes: input.notes ?? "",
      assetBalanceDelta: input.assetBalanceDelta ?? null,
    }).returning();
    return c;
  }

  // ----- Fixed-asset event deletes (mirror payroll-run JE-orphan guard) -----
  //
  // Each of these reverses the auto-posted journal entry alongside the event
  // row OR refuses with a JournalEntryReferenceConflictError when the JE has
  // been picked up by another module.
  //
  // They ALSO undo the per-asset balance changes the original posting handler
  // stamped on `fixed_assets` (and on `asset_components` for impairments) by
  // subtracting the deltas the create handler captured in
  // `assetBalanceDelta` (task #157).
  //
  // Rows created BEFORE migration 0015 added that column carry a `null`
  // snapshot. Earlier the delete path simply skipped the balance roll-back
  // for those, but that left `accumImpairment`, `revalSurplus`,
  // `accumRevalLoss`, and `status` stale on the asset row while still
  // reversing the JE — silently desynchronising the GL from the asset
  // sub-ledger. To close the gap the delete now refuses any legacy row with
  // a `LegacyAssetEventBalanceMissingError` (surfaced as 409) so the user
  // can repair the asset row by hand instead. See task #208.

  async deleteImpairmentEvent(
    companyId: number,
    eventId: number,
    ctx?: AuditContext,
  ): Promise<void> {
    const [before] = await db
      .select()
      .from(impairmentEvents)
      .where(and(eq(impairmentEvents.id, eventId), eq(impairmentEvents.companyId, companyId)));
    if (!before) return;
    if (before.assetBalanceDelta == null) {
      throw new LegacyAssetEventBalanceMissingError(
        "لا يمكن حذف خسارة الانخفاض لأنها مُسجَّلة قبل تحديث تتبّع الأرصدة (task #157). يرجى تعديل أرصدة الأصل يدوياً.",
      );
    }

    await assertNoLaterEventsForAsset(
      companyId,
      before.assetId,
      { kind: "impairment_event", id: eventId, createdAt: before.createdAt },
      (conflicts) =>
        `لا يمكن حذف خسارة الانخفاض لأن الأصل لديه أحداث لاحقة تعتمد عليها: ${conflicts.join("، ")}`,
    );

    await reverseAutoPostedJournalEntry({
      companyId,
      source: { kind: "impairment_event", id: eventId },
      journalEntryId: before.journalEntryId,
      conflictMessage: (conflicts) =>
        `لا يمكن حذف خسارة الانخفاض لأن قيدها المحاسبي مرتبط بسجلات أخرى: ${conflicts.join("، ")}`,
      extraDelete: async (tx) => {
        await tx
          .delete(impairmentEvents)
          .where(
            and(
              eq(impairmentEvents.id, eventId),
              eq(impairmentEvents.companyId, companyId),
            ),
          );
        await reverseImpairmentBalanceDelta(
          tx,
          before.assetId,
          before.assetBalanceDelta as ImpairmentBalanceDelta | null,
        );
      },
      ctx,
    });
  }

  async deleteRevaluationEvent(
    companyId: number,
    eventId: number,
    ctx?: AuditContext,
  ): Promise<void> {
    const [before] = await db
      .select()
      .from(revaluationEvents)
      .where(and(eq(revaluationEvents.id, eventId), eq(revaluationEvents.companyId, companyId)));
    if (!before) return;
    if (before.assetBalanceDelta == null) {
      throw new LegacyAssetEventBalanceMissingError(
        "لا يمكن حذف إعادة التقييم لأنها مُسجَّلة قبل تحديث تتبّع الأرصدة (task #157). يرجى تعديل أرصدة الأصل يدوياً.",
      );
    }

    await assertNoLaterEventsForAsset(
      companyId,
      before.assetId,
      { kind: "revaluation_event", id: eventId, createdAt: before.createdAt },
      (conflicts) =>
        `لا يمكن حذف إعادة التقييم لأن الأصل لديه أحداث لاحقة تعتمد عليها: ${conflicts.join("، ")}`,
    );

    await reverseAutoPostedJournalEntry({
      companyId,
      source: { kind: "revaluation_event", id: eventId },
      journalEntryId: before.journalEntryId,
      conflictMessage: (conflicts) =>
        `لا يمكن حذف إعادة التقييم لأن قيدها المحاسبي مرتبط بسجلات أخرى: ${conflicts.join("، ")}`,
      extraDelete: async (tx) => {
        await tx
          .delete(revaluationEvents)
          .where(
            and(
              eq(revaluationEvents.id, eventId),
              eq(revaluationEvents.companyId, companyId),
            ),
          );
        await reverseRevaluationBalanceDelta(
          tx,
          before.assetId,
          before.assetBalanceDelta as RevaluationBalanceDelta | null,
        );
      },
      ctx,
    });
  }

  async deleteDisposal(
    companyId: number,
    eventId: number,
    ctx?: AuditContext,
  ): Promise<void> {
    const [before] = await db
      .select()
      .from(disposals)
      .where(and(eq(disposals.id, eventId), eq(disposals.companyId, companyId)));
    if (!before) return;
    if (before.assetBalanceDelta == null) {
      throw new LegacyAssetEventBalanceMissingError(
        "لا يمكن حذف الاستبعاد لأنه مُسجَّل قبل تحديث تتبّع الأرصدة (task #157). يرجى تعديل حالة الأصل وأرصدته يدوياً.",
      );
    }

    await assertNoLaterEventsForAsset(
      companyId,
      before.assetId,
      { kind: "disposal", id: eventId, createdAt: before.createdAt },
      (conflicts) =>
        `لا يمكن حذف الاستبعاد لأن الأصل لديه أحداث لاحقة تعتمد عليه: ${conflicts.join("، ")}`,
    );

    await reverseAutoPostedJournalEntry({
      companyId,
      source: { kind: "disposal", id: eventId },
      journalEntryId: before.journalEntryId,
      conflictMessage: (conflicts) =>
        `لا يمكن حذف الاستبعاد لأن قيده المحاسبي مرتبط بسجلات أخرى: ${conflicts.join("، ")}`,
      extraDelete: async (tx) => {
        await tx
          .delete(disposals)
          .where(
            and(eq(disposals.id, eventId), eq(disposals.companyId, companyId)),
          );
        await reverseDisposalBalanceDelta(
          tx,
          before.assetId,
          before.assetBalanceDelta as DisposalBalanceDelta | null,
        );
      },
      ctx,
    });
  }

  // ----- Payroll runs -----
  async listPayrollRuns(companyId: number): Promise<PayrollRun[]> {
    return await db
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.companyId, companyId))
      .orderBy(desc(payrollRuns.year), desc(payrollRuns.month), desc(payrollRuns.id));
  }

  async getPayrollRunLines(
    companyId: number,
    runId: number,
  ): Promise<PayrollLineWithEmployee[]> {
    // Filter on payroll_lines.companyId (denormalised from the parent run, see
    // schema notes) so the query is satisfiable directly from the index even
    // before the join. Left-join employees so a hard-deleted employee row
    // (currently impossible thanks to FK constraints, but guarded for safety)
    // doesn't make the line vanish from the audit view.
    const rows = await db
      .select({
        id: payrollLines.id,
        companyId: payrollLines.companyId,
        payrollRunId: payrollLines.payrollRunId,
        employeeId: payrollLines.employeeId,
        baseSalary: payrollLines.baseSalary,
        allowances: payrollLines.allowances,
        overtime: payrollLines.overtime,
        bonuses: payrollLines.bonuses,
        absenceDeduction: payrollLines.absenceDeduction,
        advances: payrollLines.advances,
        socialInsuranceEmployee: payrollLines.socialInsuranceEmployee,
        socialInsuranceEmployer: payrollLines.socialInsuranceEmployer,
        netPay: payrollLines.netPay,
        endOfServiceAccrual: payrollLines.endOfServiceAccrual,
        leaveAccrual: payrollLines.leaveAccrual,
        employeeName: employees.fullName,
      })
      .from(payrollLines)
      .leftJoin(employees, eq(employees.id, payrollLines.employeeId))
      .where(
        and(
          eq(payrollLines.companyId, companyId),
          eq(payrollLines.payrollRunId, runId),
        ),
      )
      .orderBy(payrollLines.id);
    return rows;
  }

  async deletePayrollRun(companyId: number, id: number, ctx?: AuditContext): Promise<void> {
    const [before] = await db
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.id, id), eq(payrollRuns.companyId, companyId)));
    if (!before) return;

    // The auto-posted journal entry is the GL twin of the payroll run. To keep
    // HR history and the GL in sync we either reverse it alongside the run
    // (preferred) or refuse the delete with a clear conflict error if the JE
    // has been picked up by another module — i.e. it is "locked / reconciled
    // / otherwise referenced" from outside the payroll subsystem.
    await reverseAutoPostedJournalEntry({
      companyId,
      source: { kind: "payroll_run", id },
      journalEntryId: before.journalEntryId,
      conflictMessage: (conflicts) =>
        `لا يمكن حذف كشف الرواتب لأن قيده المحاسبي مرتبط بسجلات أخرى: ${conflicts.join("، ")}`,
      extraDelete: async (tx) => {
        await tx.delete(payrollLines).where(eq(payrollLines.payrollRunId, id));
        await tx
          .delete(payrollRuns)
          .where(and(eq(payrollRuns.id, id), eq(payrollRuns.companyId, companyId)));
        // Audit row commits inside the same transaction as the
        // payroll-run + lines + JE deletes (task #222) so a failed audit
        // insert rolls back the whole reversal — rather than leaving HR
        // history with a deleted run that has no record of being deleted.
        await recordAudit(tx, {
          companyId,
          entityType: "payroll_run",
          entityId: id,
          action: "delete",
          changes: snapshotChanges(before),
          ctx,
        });
      },
      ctx,
    });
  }

  async recordPayrollRunAudit(
    tx: AuditWriter,
    input: {
      /**
       * Workspace owning the payroll run. Required since task #169 brought
       * `audit_log` under workspace_isolation RLS — see the `recordAudit`
       * doc-comment for the full rationale.
       */
      companyId: number;
      payrollRunId: number;
      action: "create" | "update" | "delete" | "post";
      changes?: AuditChange[];
      ctx?: AuditContext;
    },
  ): Promise<void> {
    // Task #222: caller passes the open transaction handle so the audit
    // row commits atomically with the payroll-run insert/update it
    // describes. Forwarding `tx` straight into `recordAudit` keeps the
    // single-transaction guarantee end-to-end.
    await recordAudit(tx, {
      companyId: input.companyId,
      entityType: "payroll_run",
      entityId: input.payrollRunId,
      action: input.action,
      changes: input.changes,
      ctx: input.ctx,
    });
  }

  async recordJournalEntryAudit(
    tx: AuditWriter,
    input: {
      companyId: number;
      journalEntryId: number;
      action: "create" | "update" | "delete" | "post";
      changes?: AuditChange[];
      ctx?: AuditContext;
    },
  ): Promise<void> {
    // Same single-transaction guarantee as `recordPayrollRunAudit` —
    // forwarding `tx` straight into `recordAudit` keeps the JE write and
    // its audit row atomic. Used by the journal-entry recovery action
    // (`backfillJournalForLegacyTransactions`) so backfilled JEs carry
    // the same audit lineage as manually-posted ones (task #236).
    await recordAudit(tx, {
      companyId: input.companyId,
      entityType: "journal_entry",
      entityId: input.journalEntryId,
      action: input.action,
      changes: input.changes,
      ctx: input.ctx,
    });
  }

  async recordBackfillRunAudit(
    tx: AuditWriter,
    input: {
      companyId: number;
      created: number;
      skipped: number;
      triggeredVia: "admin-route" | "boot";
      ctx?: AuditContext;
    },
  ): Promise<void> {
    // Task #236: per-invocation summary of the journal-entry recovery
    // action. Stamps `entity_id = company_id` so the row is naturally
    // workspace-scoped and the existing
    // `audit_log_company_entity_idx (company_id, entity_type, entity_id)`
    // composite index covers `getLastBackfillRun`'s lookup. The payload
    // lives in the `changes` JSON as three field rows so the History
    // drawer can render it the same way it renders any other audit row,
    // and so a future report can pivot on `triggered_via`.
    await recordAudit(tx, {
      companyId: input.companyId,
      entityType: "backfill",
      entityId: input.companyId,
      action: "create",
      changes: [
        { field: "created", to: input.created },
        { field: "skipped", to: input.skipped },
        { field: "triggered_via", to: input.triggeredVia },
      ],
      ctx: input.ctx,
    });
  }

  async getLastBackfillRun(companyId: number): Promise<AuditLogEntry | null> {
    // The `companyId` predicate is redundant under the audit_log
    // workspace_isolation RLS (task #169) but is left in place as
    // defense-in-depth and as a planner hint for the
    // `audit_log_company_entity_idx` composite index. Bounding by
    // `entityId = companyId` matches the stamp written by
    // `recordBackfillRunAudit`.
    const [row] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.companyId, companyId),
          eq(auditLog.entityType, "backfill"),
          eq(auditLog.entityId, companyId),
        ),
      )
      .orderBy(desc(auditLog.occurredAt))
      .limit(1);
    return row ?? null;
  }

  // ----- Audit log (workspace-scoped) -----
  async entityBelongsToCompany(
    entityType: AuditEntityType,
    entityId: number,
    companyId: number,
  ): Promise<boolean> {
    // Strongly-typed per-entity ownership check. Each branch references the
    // concrete table so Drizzle's column types are preserved end to end —
    // critical because this function is the gate for the audit history API.
    switch (entityType) {
      case "transaction": {
        const rows = await db
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.id, entityId), eq(transactions.companyId, companyId)))
          .limit(1);
        return rows.length > 0;
      }
      case "journal_entry": {
        const rows = await db
          .select({ id: journalEntries.id })
          .from(journalEntries)
          .where(and(eq(journalEntries.id, entityId), eq(journalEntries.companyId, companyId)))
          .limit(1);
        return rows.length > 0;
      }
      case "account": {
        const rows = await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.id, entityId), eq(accounts.companyId, companyId)))
          .limit(1);
        return rows.length > 0;
      }
      case "fixed_asset": {
        const rows = await db
          .select({ id: fixedAssets.id })
          .from(fixedAssets)
          .where(and(eq(fixedAssets.id, entityId), eq(fixedAssets.companyId, companyId)))
          .limit(1);
        return rows.length > 0;
      }
      case "employee": {
        const rows = await db
          .select({ id: employees.id })
          .from(employees)
          .where(and(eq(employees.id, entityId), eq(employees.companyId, companyId)))
          .limit(1);
        return rows.length > 0;
      }
      case "attendance": {
        const rows = await db
          .select({ id: attendance.id })
          .from(attendance)
          .where(and(eq(attendance.id, entityId), eq(attendance.companyId, companyId)))
          .limit(1);
        return rows.length > 0;
      }
      case "leave": {
        const rows = await db
          .select({ id: leaves.id })
          .from(leaves)
          .where(and(eq(leaves.id, entityId), eq(leaves.companyId, companyId)))
          .limit(1);
        return rows.length > 0;
      }
      case "payroll_run": {
        const rows = await db
          .select({ id: payrollRuns.id })
          .from(payrollRuns)
          .where(and(eq(payrollRuns.id, entityId), eq(payrollRuns.companyId, companyId)))
          .limit(1);
        return rows.length > 0;
      }
      case "customer": {
        const rows = await db
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.id, entityId), eq(customers.companyId, companyId)))
          .limit(1);
        return rows.length > 0;
      }
      case "product": {
        const rows = await db
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.id, entityId), eq(products.companyId, companyId)))
          .limit(1);
        return rows.length > 0;
      }
      case "sales_invoice": {
        const rows = await db
          .select({ id: salesInvoices.id })
          .from(salesInvoices)
          .where(and(eq(salesInvoices.id, entityId), eq(salesInvoices.companyId, companyId)))
          .limit(1);
        return rows.length > 0;
      }
      case "backfill": {
        // Backfill audit rows have no per-row entity table; the "entity"
        // is the workspace itself and we stamp `entity_id = company_id`
        // when writing the row (see `recordBackfillRunAudit` below).
        // Ownership is therefore exactly identity on the active workspace.
        return entityId === companyId;
      }
      default: {
        const _exhaustive: never = entityType;
        void _exhaustive;
        return false;
      }
    }
  }

  async getAuditLog(
    companyId: number,
    entityType: AuditEntityType,
    entityId: number,
    bounds?: { from?: Date; to?: Date },
  ): Promise<AuditLogEntry[]> {
    const owned = await this.entityBelongsToCompany(entityType, entityId, companyId);
    if (!owned) return [];
    // The `companyId` predicate is redundant given the workspace_isolation
    // RLS policy on `audit_log` (task #169) — but it is left in place as
    // defense-in-depth and as a planner hint for the
    // `audit_log_company_entity_idx` composite index.
    //
    // Optional `bounds.from` / `bounds.to` push the period filter (rendered
    // by `HistoryTimeline`'s preset dropdown) down to the database so very
    // large per-entity histories don't have to be paged into the client and
    // discarded after the fact. With no bounds the query is unchanged.
    const predicates = [
      eq(auditLog.companyId, companyId),
      eq(auditLog.entityType, entityType),
      eq(auditLog.entityId, entityId),
    ];
    if (bounds?.from) predicates.push(gte(auditLog.occurredAt, bounds.from));
    if (bounds?.to) predicates.push(lte(auditLog.occurredAt, bounds.to));
    return await db
      .select()
      .from(auditLog)
      .where(and(...predicates))
      .orderBy(desc(auditLog.occurredAt));
  }

  async getJournalEntryAuditWithReversal(
    companyId: number,
    entityId: number,
  ): Promise<AuditLogEntry[] | null> {
    // Single workspace-scoped SELECT covers both the live and the
    // cascade-deleted JE cases since task #169 brought `audit_log` under
    // the workspace_isolation RLS policy with a first-class `company_id`
    // column. Before that, the deleted-JE branch had to walk the
    // `companyId` stamp inside the `changes` JSON to verify ownership of
    // an audit row whose owning entity was already gone — that fallback
    // is no longer needed because the column itself carries the answer.
    //
    // The `companyId` predicate is redundant under RLS but is left in
    // place as defense-in-depth and to let the planner use the
    // `audit_log_company_entity_idx` composite index.
    const rows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.companyId, companyId),
          eq(auditLog.entityType, "journal_entry"),
          eq(auditLog.entityId, entityId),
        ),
      )
      .orderBy(desc(auditLog.occurredAt));
    if (rows.length > 0) return rows;

    // No audit rows visible to this workspace. Distinguish "live JE in
    // this workspace that somehow has no audit history" (200 with `[]`)
    // from "JE never existed here / belonged to another tenant" (404).
    // The first case is essentially unreachable in production — every
    // JE create writes an audit row in the same transaction — but the
    // distinction is worth preserving for parity with `getAuditLog`.
    const owned = await this.entityBelongsToCompany(
      "journal_entry",
      entityId,
      companyId,
    );
    return owned ? [] : null;
  }

  // ----- AI Document Inbox -----
  async createDocument(companyId: number, input: InsertDocument): Promise<DocumentRow> {
    const [row] = await db.insert(documents).values({ ...input, companyId }).returning();
    return row;
  }

  async listDocuments(companyId: number): Promise<DocumentRow[]> {
    return await db
      .select()
      .from(documents)
      .where(eq(documents.companyId, companyId))
      .orderBy(desc(documents.uploadedAt));
  }

  async getDocument(companyId: number, id: number): Promise<DocumentRow | undefined> {
    const [row] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.companyId, companyId), eq(documents.id, id)));
    return row;
  }

  async updateDocumentExtraction(
    companyId: number,
    id: number,
    patch: {
      status: "ready" | "error" | "posting";
      extractedJson?: ExtractedDocument | null;
      suggestedJournalJson?: SuggestedJournal | null;
      errorMessage?: string | null;
    },
  ): Promise<DocumentRow> {
    const [row] = await db
      .update(documents)
      .set({
        status: patch.status,
        extractedJson: patch.extractedJson ?? null,
        suggestedJournalJson: patch.suggestedJournalJson ?? null,
        errorMessage: patch.errorMessage ?? null,
        extractedAt: new Date(),
      })
      .where(and(eq(documents.companyId, companyId), eq(documents.id, id)))
      .returning();
    return row;
  }

  async claimDocumentForPosting(
    companyId: number,
    id: number,
  ): Promise<DocumentRow | null> {
    // Atomic transition: ready → posting. If another request already claimed
    // it (or it's still extracting / errored / posted), this returns no row
    // and the caller must surface a 409.
    const [row] = await db
      .update(documents)
      .set({ status: "posting" })
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.id, id),
          eq(documents.status, "ready"),
        ),
      )
      .returning();
    return row ?? null;
  }

  async markDocumentPosted(
    companyId: number,
    id: number,
    journalEntryId: number,
  ): Promise<DocumentRow> {
    const [row] = await db
      .update(documents)
      .set({ status: "posted", journalEntryId, postedAt: new Date() })
      .where(and(eq(documents.companyId, companyId), eq(documents.id, id)))
      .returning();
    return row;
  }

  async countDocumentsByStoragePath(
    companyId: number,
    storagePath: string,
  ): Promise<number> {
    const rows = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(eq(documents.companyId, companyId), eq(documents.storagePath, storagePath)),
      );
    return rows.length;
  }

  async deleteDocument(
    companyId: number,
    id: number,
    ctx?: AuditContext,
  ): Promise<DocumentRow | undefined> {
    const [before] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.companyId, companyId), eq(documents.id, id)));
    if (!before) return undefined;

    // Apply the same JE-orphan guard as payroll-run delete: if the inbox
    // document was posted (it owns a journalEntryId) we either reverse the
    // JE alongside the row or refuse with a clear conflict if the JE has
    // been picked up by another module. Un-posted documents (journalEntryId
    // null) skip the guard entirely.
    await reverseAutoPostedJournalEntry({
      companyId,
      source: { kind: "document", id },
      journalEntryId: before.journalEntryId,
      conflictMessage: (conflicts) =>
        `لا يمكن حذف المستند لأن قيده المحاسبي مرتبط بسجلات أخرى: ${conflicts.join("، ")}`,
      extraDelete: async (tx) => {
        await tx
          .delete(documents)
          .where(and(eq(documents.companyId, companyId), eq(documents.id, id)));
      },
      ctx,
    });

    return before;
  }
}

export const storage = new DatabaseStorage();
