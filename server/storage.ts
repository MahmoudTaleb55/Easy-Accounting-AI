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
} from "@shared/schema";
import {
  CASH_ACCOUNT_CODE,
  pickExpenseAccountCode,
  pickRevenueAccountCode,
} from "@shared/coa-seed";
import { eq, sql, desc, and, inArray } from "drizzle-orm";
import type { AnyPgTable, PgColumn } from "drizzle-orm/pg-core";

export interface JournalEntryWithLines extends JournalEntry {
  lines: (JournalLine & { account?: Account })[];
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
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export function isAuditEntityType(value: string): value is AuditEntityType {
  return (AUDIT_ENTITY_TYPES as readonly string[]).includes(value);
}

export interface IStorage {
  // All business-data methods are scoped by `companyId` so that two
  // memberships in different workspaces cannot read or write each other's rows.

  // Legacy quick-entry transactions
  getTransactions(companyId: number): Promise<Transaction[]>;
  createTransaction(companyId: number, tx: InsertTransaction, ctx?: AuditContext): Promise<Transaction>;
  deleteTransaction(companyId: number, id: number, ctx?: AuditContext): Promise<void>;

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

  // Audit log — scoped: only returns history when the underlying entity
  // belongs to the caller's active workspace. Cross-workspace lookups return
  // an empty array (the route layer turns that into a 404).
  getAuditLog(companyId: number, entityType: AuditEntityType, entityId: number): Promise<AuditLogEntry[]>;
  entityBelongsToCompany(entityType: AuditEntityType, entityId: number, companyId: number): Promise<boolean>;

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
  deleteDocument(companyId: number, id: number): Promise<DocumentRow | undefined>;
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

async function recordAudit(input: {
  entityType: AuditEntityType;
  entityId: number;
  action: "create" | "update" | "delete" | "post";
  changes?: AuditChange[];
  ctx?: AuditContext;
}): Promise<void> {
  // Intentionally not wrapped in try/catch: a failed audit write must surface
  // so the calling mutation rolls back / errors out. Auditability is a
  // first-class success criterion, not best-effort.
  await db.insert(auditLog).values({
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

async function nextJournalReference(companyId: number): Promise<string> {
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(eq(journalEntries.companyId, companyId));
  return `JE-${String(c + 1).padStart(5, "0")}`;
}

export class DatabaseStorage implements IStorage {
  // ----- Transactions -----
  async getTransactions(companyId: number): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .where(eq(transactions.companyId, companyId))
      .orderBy(transactions.date);
  }

  async createTransaction(companyId: number, tx: InsertTransaction, ctx?: AuditContext): Promise<Transaction> {
    const [transaction] = await db
      .insert(transactions)
      .values({ ...tx, companyId, amount: tx.amount.toString() })
      .returning();

    await recordAudit({
      entityType: "transaction",
      entityId: transaction.id,
      action: "create",
      changes: snapshotChanges(transaction),
      ctx,
    });

    // Auto-post double-entry journal entry
    try {
      await this.autoPostFromTransaction(companyId, transaction, ctx);
    } catch (e) {
      console.error("Failed to auto-post journal entry for transaction", transaction.id, e);
    }
    return transaction;
  }

  async deleteTransaction(companyId: number, id: number, ctx?: AuditContext): Promise<void> {
    const [before] = await db.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.companyId, companyId)));
    // Cascade-delete the auto-posted journal lines + entry atomically
    const linkedIds: number[] = [];
    await db.transaction(async (tx) => {
      const linkedJEs = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(and(eq(journalEntries.sourceTransactionId, id), eq(journalEntries.companyId, companyId)));
      for (const je of linkedJEs) {
        linkedIds.push(je.id);
        await tx.delete(journalLines).where(eq(journalLines.journalEntryId, je.id));
        await tx.delete(journalEntries).where(eq(journalEntries.id, je.id));
      }
      await tx.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.companyId, companyId)));
    });
    if (before) {
      await recordAudit({
        entityType: "transaction",
        entityId: id,
        action: "delete",
        changes: snapshotChanges(before),
        ctx,
      });
    }
    for (const jeId of linkedIds) {
      await recordAudit({
        entityType: "journal_entry",
        entityId: jeId,
        action: "delete",
        changes: [{ field: "reason", to: `cascade from transaction #${id}` }],
        ctx: { source: "system", actor: ctx?.actor ?? null },
      });
    }
  }

  private async autoPostFromTransaction(companyId: number, tx: Transaction, ctx?: AuditContext): Promise<void> {
    if (!cash) return;
    const amt = Number(tx.amount);
    let drId: number;
    let crId: number;
    if (tx.type === "income") {
      const rev = await this.getAccountByCode(
        companyId,
        pickRevenueAccountCode(tx.category, tx.description),
      );
      drId = cash.id;
      crId = rev?.id ?? cash.id;
    } else {
      const exp = await this.getAccountByCode(
        companyId,
        pickExpenseAccountCode(tx.category, tx.description),
      );
      drId = exp?.id ?? cash.id;
      crId = cash.id;
    }
    const reference = await nextJournalReference(companyId);
    const [je] = await db
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
    await db.insert(journalLines).values([
      { journalEntryId: je.id, accountId: drId, debit: amt.toFixed(2), credit: "0", description: tx.description },
      { journalEntryId: je.id, accountId: crId, debit: "0", credit: amt.toFixed(2), description: tx.description },
    ]);
    await recordAudit({
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
      ctx: { source: "system", actor: ctx?.actor ?? null },
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
    const [created] = await db.insert(accounts).values({ ...input, companyId }).returning();
    await recordAudit({ entityType: "account", entityId: created.id, action: "create", changes: snapshotChanges(created), ctx });
    return created;
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

    return entries.map((e) => ({
      ...e,
      lines: allLines
        .filter((l) => l.journalEntryId === e.id)
        .map((l) => ({ ...l, account: accountById.get(l.accountId) })),
    }));
  }

  async createJournalEntry(companyId: number, input: CreateJournalEntryInput, ctx?: AuditContext): Promise<JournalEntryWithLines> {
    const reference = await nextJournalReference(companyId);
    const [je] = await db
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
      journalEntryId: je.id,
      accountId: l.accountId,
      debit: Number(l.debit || 0).toFixed(2),
      credit: Number(l.credit || 0).toFixed(2),
      description: l.description,
    }));
    const insertedLines = await db.insert(journalLines).values(linesToInsert).returning();
    const allAccounts = await this.getAccounts(companyId);
    const accountById = new Map(allAccounts.map((a) => [a.id, a]));

    const lineSummary: AuditChange[] = insertedLines.map((l) => {
      const acc = accountById.get(l.accountId);
      const label = acc ? `${acc.code} ${acc.nameAr}` : `account#${l.accountId}`;
      const debit = Number(l.debit);
      const credit = Number(l.credit);
      const value = debit > 0 ? `Dr ${debit.toFixed(2)}` : `Cr ${credit.toFixed(2)}`;
      return { field: label, to: value };
    });
    await recordAudit({
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
  }

  async deleteJournalEntry(companyId: number, id: number, ctx?: AuditContext): Promise<void> {
    const [before] = await db.select().from(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.companyId, companyId)));
    if (!before) return;
    await db.delete(journalLines).where(eq(journalLines.journalEntryId, id));
    await db.delete(journalEntries).where(eq(journalEntries.id, id));
    if (before) {
      await recordAudit({
        entityType: "journal_entry",
        entityId: id,
        action: "delete",
        changes: snapshotChanges(before),
        ctx,
      });
    }
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
    const [updated] = await db
      .update(settings)
      .set({ ...input, vatRate: String(input.vatRate) })
      .where(eq(settings.id, existing.id))
      .returning();
    return updated;
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
    const [created] = await db
      .insert(employees)
      .values({
        ...input,
        companyId,
        baseSalary: String(input.baseSalary),
        allowances: String(input.allowances ?? 0),
      })
      .returning();
    await recordAudit({
      entityType: "employee",
      entityId: created.id,
      action: "create",
      changes: snapshotChanges(created),
      ctx,
    });
    return created;
  }

  async updateEmployee(companyId: number, id: number, input: Partial<InsertEmployee>, ctx?: AuditContext): Promise<Employee> {
    const [before] = await db.select().from(employees).where(and(eq(employees.id, id), eq(employees.companyId, companyId)));
    const patch: any = { ...input };
    if (input.baseSalary !== undefined) patch.baseSalary = String(input.baseSalary);
    if (input.allowances !== undefined) patch.allowances = String(input.allowances);
    const [updated] = await db.update(employees).set(patch).where(and(eq(employees.id, id), eq(employees.companyId, companyId))).returning();
    if (before && updated) {
      const changes = diffChanges(before, updated);
      if (changes.length > 0) {
        await recordAudit({ entityType: "employee", entityId: id, action: "update", changes, ctx });
      }
    }
    return updated;
  }

  async deleteEmployee(companyId: number, id: number, ctx?: AuditContext): Promise<void> {
    const [before] = await db.select().from(employees).where(and(eq(employees.id, id), eq(employees.companyId, companyId)));
    await db.delete(employees).where(and(eq(employees.id, id), eq(employees.companyId, companyId)));
    if (before) {
      await recordAudit({ entityType: "employee", entityId: id, action: "delete", changes: snapshotChanges(before), ctx });
    }
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
    const existing = await db
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
      const [u] = await db
        .update(attendance)
        .set({ status: input.status, overtimeHours: String(input.overtimeHours ?? 0) })
        .where(eq(attendance.id, existing[0].id))
        .returning();
      const changes = diffChanges(before, u);
      if (changes.length > 0) {
        await recordAudit({ entityType: "attendance", entityId: u.id, action: "update", changes, ctx });
      }
      return u;
    }
    const [c] = await db
      .insert(attendance)
      .values({ ...input, companyId, overtimeHours: String(input.overtimeHours ?? 0) })
      .returning();
    await recordAudit({
      entityType: "attendance",
      entityId: c.id,
      action: "create",
      changes: snapshotChanges(c),
      ctx,
    });
    return c;
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
    const [c] = await db.insert(leaves).values({ ...input, companyId }).returning();
    await recordAudit({ entityType: "leave", entityId: c.id, action: "create", changes: snapshotChanges(c), ctx });
    return c;
  }

  async deleteLeave(companyId: number, id: number, ctx?: AuditContext): Promise<void> {
    const [before] = await db.select().from(leaves).where(and(eq(leaves.id, id), eq(leaves.companyId, companyId)));
    await db.delete(leaves).where(and(eq(leaves.id, id), eq(leaves.companyId, companyId)));
    if (before) {
      await recordAudit({ entityType: "leave", entityId: id, action: "delete", changes: snapshotChanges(before), ctx });
    }
  }

  // ----- Companies -----
  async getCompanies(): Promise<Company[]> {
    return await db.select().from(companies).orderBy(companies.name);
  }
  async createCompany(input: InsertCompany): Promise<Company> {
    if (input.isDefault) {
      await db.update(companies).set({ isDefault: false });
    }
    const [c] = await db.insert(companies).values(input).returning();
    return c;
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
    const [c] = await db
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
    await recordAudit({
      entityType: "fixed_asset",
      entityId: c.id,
      action: "create",
      changes: snapshotChanges(c),
      ctx,
    });
    return c;
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
    const [before] = await db.select().from(fixedAssets).where(eq(fixedAssets.id, id));
    const [u] = await db.update(fixedAssets).set(set).where(eq(fixedAssets.id, id)).returning();
    if (before && u) {
      const changes = diffChanges(before, u).filter((c) => set[c.field as string] !== undefined);
      if (changes.length > 0) {
        await recordAudit({ entityType: "fixed_asset", entityId: id, action: "update", changes, ctx });
      }
    }
    return u;
  }
  async deleteFixedAsset(id: number, ctx?: AuditContext): Promise<void> {
    const [before] = await db.select().from(fixedAssets).where(eq(fixedAssets.id, id));
    await db.delete(assetComponents).where(eq(assetComponents.assetId, id));
    await db.delete(depreciationSchedule).where(eq(depreciationSchedule.assetId, id));
    await db.delete(depreciationPostings).where(eq(depreciationPostings.assetId, id));
    await db.delete(impairmentEvents).where(eq(impairmentEvents.assetId, id));
    await db.delete(revaluationEvents).where(eq(revaluationEvents.assetId, id));
    await db.delete(disposals).where(eq(disposals.assetId, id));
    await db.delete(fixedAssets).where(eq(fixedAssets.id, id));
    if (before) {
      await recordAudit({
        entityType: "fixed_asset",
        entityId: id,
        action: "delete",
        changes: snapshotChanges(before),
        ctx,
      });
    }
  }

  // ----- Asset Components -----
  async getAssetComponents(assetId: number): Promise<AssetComponent[]> {
    return await db.select().from(assetComponents).where(eq(assetComponents.assetId, assetId));
  }
  async createAssetComponent(input: InsertAssetComponent): Promise<AssetComponent> {
    const [c] = await db
      .insert(assetComponents)
      .values({
        ...input,
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
      await db.insert(depreciationPostings).values(input.postings.map((p) => ({
        runId: run.id, assetId: p.assetId, componentId: p.componentId ?? null, amount: String(p.amount),
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
  async deleteDepreciationRun(runId: number): Promise<void> {
    await db.delete(depreciationPostings).where(eq(depreciationPostings.runId, runId));
    await db.delete(depreciationRuns).where(eq(depreciationRuns.id, runId));
  }

  // ----- Schedule (planned rows) -----
  async getSchedule(assetId: number): Promise<DepreciationScheduleRow[]> {
    return await db.select().from(depreciationSchedule).where(eq(depreciationSchedule.assetId, assetId));
  }
  async replaceSchedule(assetId: number, rows: { periodYear: number; periodMonth: number; plannedAmount: number; componentId?: number | null }[]): Promise<void> {
    await db.delete(depreciationSchedule).where(and(eq(depreciationSchedule.assetId, assetId), eq(depreciationSchedule.status, "planned")));
    if (rows.length === 0) return;
    await db.insert(depreciationSchedule).values(rows.map((r) => ({
      assetId,
      componentId: r.componentId ?? null,
      periodYear: r.periodYear,
      periodMonth: r.periodMonth,
      plannedAmount: String(r.plannedAmount),
      status: "planned",
    })));
  }
  async markScheduledPosted(
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
  async createImpairmentEvent(input: { assetId: number; componentId?: number | null; eventDate: string; recoverableAmount: number; lossAmount: number; journalEntryId?: number | null; notes?: string }): Promise<ImpairmentEvent> {
    const [c] = await db.insert(impairmentEvents).values({
      assetId: input.assetId,
      componentId: input.componentId ?? null,
      eventDate: input.eventDate,
      recoverableAmount: String(input.recoverableAmount),
      lossAmount: String(input.lossAmount),
      journalEntryId: input.journalEntryId ?? null,
      notes: input.notes ?? "",
    }).returning();
    return c;
  }

  async getRevaluationEvents(assetId?: number): Promise<RevaluationEvent[]> {
    if (assetId) return await db.select().from(revaluationEvents).where(eq(revaluationEvents.assetId, assetId)).orderBy(desc(revaluationEvents.eventDate));
    return await db.select().from(revaluationEvents).orderBy(desc(revaluationEvents.eventDate));
  }
  async createRevaluationEvent(input: { assetId: number; eventDate: string; fairValue: number; method: string; surplusDelta: number; plImpact: number; journalEntryId?: number | null; notes?: string }): Promise<RevaluationEvent> {
    const [c] = await db.insert(revaluationEvents).values({
      assetId: input.assetId,
      eventDate: input.eventDate,
      fairValue: String(input.fairValue),
      method: input.method,
      surplusDelta: String(input.surplusDelta),
      plImpact: String(input.plImpact),
      journalEntryId: input.journalEntryId ?? null,
      notes: input.notes ?? "",
    }).returning();
    return c;
  }

  async getDisposals(assetId?: number): Promise<Disposal[]> {
    if (assetId) return await db.select().from(disposals).where(eq(disposals.assetId, assetId)).orderBy(desc(disposals.eventDate));
    return await db.select().from(disposals).orderBy(desc(disposals.eventDate));
  }
  async createDisposal(input: { assetId: number; eventDate: string; proceeds: number; method: string; gainLoss: number; surplusTransferred: number; journalEntryId?: number | null; notes?: string }): Promise<Disposal> {
    const [c] = await db.insert(disposals).values({
      assetId: input.assetId,
      eventDate: input.eventDate,
      proceeds: String(input.proceeds),
      method: input.method,
      gainLoss: String(input.gainLoss),
      surplusTransferred: String(input.surplusTransferred),
      journalEntryId: input.journalEntryId ?? null,
      notes: input.notes ?? "",
    }).returning();
    return c;
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
  ): Promise<AuditLogEntry[]> {
    const owned = await this.entityBelongsToCompany(entityType, entityId, companyId);
    if (!owned) return [];
    return await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
      .orderBy(desc(auditLog.occurredAt));
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

  async deleteDocument(companyId: number, id: number): Promise<DocumentRow | undefined> {
    const [row] = await db
      .delete(documents)
      .where(and(eq(documents.companyId, companyId), eq(documents.id, id)))
      .returning();
    return row;
  }
}

export const storage = new DatabaseStorage();
