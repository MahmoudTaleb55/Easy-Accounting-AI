import { pgTable, text, serial, numeric, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================================
// Chart of Accounts (IFRS-aligned)
// ============================================================================

// IFRS account types
// asset, liability, equity, revenue, expense
// subtype examples: current_asset, non_current_asset, current_liability,
// non_current_liability, capital, retained_earnings, drawings,
// operating_revenue, other_income, cogs, operating_expense, contra_revenue,
// contra_asset
export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // e.g., "1110"
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  type: text("type").notNull(), // asset|liability|equity|revenue|expense
  subtype: text("subtype").notNull(), // see comment above
  parentId: integer("parent_id"),
  isHeader: boolean("is_header").notNull().default(false), // grouping rows have no postings
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAccountSchema = createInsertSchema(accounts).omit({ id: true, createdAt: true });
export type Account = typeof accounts.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;

// ============================================================================
// Journal Entries (double-entry)
// ============================================================================

export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull(), // JE-0001
  entryDate: timestamp("entry_date").notNull().defaultNow(),
  description: text("description").notNull(),
  source: text("source").notNull().default("manual"), // manual|ai|transaction
  sourceTransactionId: integer("source_transaction_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  dateIdx: index("je_date_idx").on(table.entryDate),
}));

export const journalLines = pgTable("journal_lines", {
  id: serial("id").primaryKey(),
  journalEntryId: integer("journal_entry_id").notNull(),
  accountId: integer("account_id").notNull(),
  debit: numeric("debit", { precision: 14, scale: 2 }).notNull().default("0"),
  credit: numeric("credit", { precision: 14, scale: 2 }).notNull().default("0"),
  description: text("description"),
}, (table) => ({
  jeIdx: index("jl_je_idx").on(table.journalEntryId),
  accountIdx: index("jl_account_idx").on(table.accountId),
}));

export const insertJournalEntrySchema = createInsertSchema(journalEntries).omit({
  id: true,
  createdAt: true,
  reference: true,
});
export type JournalEntry = typeof journalEntries.$inferSelect;
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;

export const insertJournalLineSchema = createInsertSchema(journalLines).omit({
  id: true,
  journalEntryId: true,
}).extend({
  debit: z.union([z.string(), z.number()]).default(0),
  credit: z.union([z.string(), z.number()]).default(0),
});
export type JournalLine = typeof journalLines.$inferSelect;
export type InsertJournalLine = z.infer<typeof insertJournalLineSchema>;

// Composite create schema used by /api/journal-entries POST
export const createJournalEntrySchema = z.object({
  entryDate: z.string().or(z.date()).optional(),
  description: z.string().min(1).max(300),
  source: z.enum(["manual", "ai", "transaction"]).default("manual"),
  lines: z
    .array(
      z.object({
        accountId: z.number().int().positive(),
        debit: z.coerce.number().nonnegative().default(0),
        credit: z.coerce.number().nonnegative().default(0),
        description: z.string().max(300).optional(),
      })
    )
    .min(2, "يجب أن يحتوي القيد على سطرين على الأقل")
    .refine((lines) => {
      const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      return Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;
    }, "إجمالي المدين يجب أن يساوي إجمالي الدائن وأكبر من صفر")
    .refine(
      (lines) =>
        lines.every(
          (l) =>
            (Number(l.debit) > 0 && Number(l.credit) === 0) ||
            (Number(l.credit) > 0 && Number(l.debit) === 0)
        ),
      "كل سطر يجب أن يكون إما مدين أو دائن، وليس كلاهما"
    ),
});
export type CreateJournalEntryInput = z.infer<typeof createJournalEntrySchema>;

// ============================================================================
// Simple Transactions (legacy/quick entry — auto-posted to journal)
// ============================================================================

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // 'income' or 'expense'
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  date: timestamp("date").defaultNow(),
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({ id: true, date: true }).extend({
  amount: z.union([z.string(), z.number()]),
});

export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type CreateTransactionRequest = InsertTransaction;

// ============================================================================
// Chat
// ============================================================================

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(), // 'user' or 'assistant'
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
