import { db } from "./db";
import {
  transactions,
  chatMessages,
  accounts,
  journalEntries,
  journalLines,
  budgets,
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
} from "@shared/schema";
import {
  CASH_ACCOUNT_CODE,
  pickExpenseAccountCode,
  pickRevenueAccountCode,
} from "@shared/coa-seed";
import { eq, sql, desc, and } from "drizzle-orm";

export interface JournalEntryWithLines extends JournalEntry {
  lines: (JournalLine & { account?: Account })[];
}

export interface IStorage {
  // Legacy quick-entry transactions
  getTransactions(): Promise<Transaction[]>;
  createTransaction(tx: InsertTransaction): Promise<Transaction>;
  deleteTransaction(id: number): Promise<void>;

  // Chat
  getChatMessages(): Promise<ChatMessage[]>;
  createChatMessage(msg: InsertChatMessage): Promise<ChatMessage>;

  // Chart of accounts
  getAccounts(): Promise<Account[]>;
  createAccount(input: InsertAccount): Promise<Account>;
  getAccountByCode(code: string): Promise<Account | undefined>;

  // Journal entries
  getJournalEntries(): Promise<JournalEntryWithLines[]>;
  createJournalEntry(input: CreateJournalEntryInput): Promise<JournalEntryWithLines>;
  deleteJournalEntry(id: number): Promise<void>;

  // Budgets
  getBudgets(year?: number, month?: number): Promise<Budget[]>;
  upsertBudget(input: InsertBudget): Promise<Budget>;
  deleteBudget(id: number): Promise<void>;
}

async function nextJournalReference(): Promise<string> {
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(journalEntries);
  return `JE-${String(c + 1).padStart(5, "0")}`;
}

export class DatabaseStorage implements IStorage {
  // ----- Transactions -----
  async getTransactions(): Promise<Transaction[]> {
    return await db.select().from(transactions).orderBy(transactions.date);
  }

  async createTransaction(tx: InsertTransaction): Promise<Transaction> {
    const [transaction] = await db
      .insert(transactions)
      .values({ ...tx, amount: tx.amount.toString() })
      .returning();

    // Auto-post double-entry journal entry
    try {
      await this.autoPostFromTransaction(transaction);
    } catch (e) {
      console.error("Failed to auto-post journal entry for transaction", transaction.id, e);
    }
    return transaction;
  }

  async deleteTransaction(id: number): Promise<void> {
    // Cascade-delete the auto-posted journal lines + entry atomically
    await db.transaction(async (tx) => {
      const linkedJEs = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(eq(journalEntries.sourceTransactionId, id));
      for (const je of linkedJEs) {
        await tx.delete(journalLines).where(eq(journalLines.journalEntryId, je.id));
        await tx.delete(journalEntries).where(eq(journalEntries.id, je.id));
      }
      await tx.delete(transactions).where(eq(transactions.id, id));
    });
  }

  private async autoPostFromTransaction(tx: Transaction): Promise<void> {
    const cash = await this.getAccountByCode(CASH_ACCOUNT_CODE);
    if (!cash) return;
    const amt = Number(tx.amount);
    let drId: number;
    let crId: number;
    if (tx.type === "income") {
      const rev = await this.getAccountByCode(
        pickRevenueAccountCode(tx.category, tx.description)
      );
      drId = cash.id;
      crId = rev?.id ?? cash.id;
    } else {
      const exp = await this.getAccountByCode(
        pickExpenseAccountCode(tx.category, tx.description)
      );
      drId = exp?.id ?? cash.id;
      crId = cash.id;
    }
    const reference = await nextJournalReference();
    const [je] = await db
      .insert(journalEntries)
      .values({
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
  }

  // ----- Chat -----
  async getChatMessages(): Promise<ChatMessage[]> {
    return await db.select().from(chatMessages).orderBy(chatMessages.createdAt);
  }

  async createChatMessage(msg: InsertChatMessage): Promise<ChatMessage> {
    const [message] = await db.insert(chatMessages).values(msg).returning();
    return message;
  }

  // ----- Accounts -----
  async getAccounts(): Promise<Account[]> {
    return await db.select().from(accounts).orderBy(accounts.code);
  }

  async createAccount(input: InsertAccount): Promise<Account> {
    const [created] = await db.insert(accounts).values(input).returning();
    return created;
  }

  async getAccountByCode(code: string): Promise<Account | undefined> {
    const rows = await db.select().from(accounts).where(eq(accounts.code, code));
    return rows[0];
  }

  // ----- Journal Entries -----
  async getJournalEntries(): Promise<JournalEntryWithLines[]> {
    const entries = await db
      .select()
      .from(journalEntries)
      .orderBy(desc(journalEntries.entryDate), desc(journalEntries.id));
    if (entries.length === 0) return [];

    const allLines = await db.select().from(journalLines);
    const allAccounts = await db.select().from(accounts);
    const accountById = new Map(allAccounts.map((a) => [a.id, a]));

    return entries.map((e) => ({
      ...e,
      lines: allLines
        .filter((l) => l.journalEntryId === e.id)
        .map((l) => ({ ...l, account: accountById.get(l.accountId) })),
    }));
  }

  async createJournalEntry(input: CreateJournalEntryInput): Promise<JournalEntryWithLines> {
    const reference = await nextJournalReference();
    const [je] = await db
      .insert(journalEntries)
      .values({
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
    const allAccounts = await db.select().from(accounts);
    const accountById = new Map(allAccounts.map((a) => [a.id, a]));
    return {
      ...je,
      lines: insertedLines.map((l) => ({ ...l, account: accountById.get(l.accountId) })),
    };
  }

  async deleteJournalEntry(id: number): Promise<void> {
    await db.delete(journalLines).where(eq(journalLines.journalEntryId, id));
    await db.delete(journalEntries).where(eq(journalEntries.id, id));
  }

  // ----- Budgets -----
  async getBudgets(year?: number, month?: number): Promise<Budget[]> {
    if (year && month) {
      return await db.select().from(budgets).where(
        and(eq(budgets.year, year), eq(budgets.month, month))
      );
    }
    return await db.select().from(budgets);
  }

  async upsertBudget(input: InsertBudget): Promise<Budget> {
    const existing = await db.select().from(budgets).where(
      and(
        eq(budgets.accountId, input.accountId),
        eq(budgets.year, input.year),
        eq(budgets.month, input.month),
      )
    );
    if (existing[0]) {
      const [updated] = await db
        .update(budgets)
        .set({ amount: String(input.amount) })
        .where(eq(budgets.id, existing[0].id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(budgets).values({ ...input, amount: String(input.amount) }).returning();
    return created;
  }

  async deleteBudget(id: number): Promise<void> {
    await db.delete(budgets).where(eq(budgets.id, id));
  }
}

export const storage = new DatabaseStorage();
