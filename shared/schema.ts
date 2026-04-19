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
// Budgets (per-account monthly budgets for Budget vs Actual)
// ============================================================================

export const budgets = pgTable("budgets", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  year: integer("year").notNull(),
  month: integer("month").notNull(), // 1-12
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBudgetSchema = createInsertSchema(budgets).omit({ id: true, createdAt: true }).extend({
  amount: z.coerce.number().nonnegative(),
});
export type Budget = typeof budgets.$inferSelect;
export type InsertBudget = z.infer<typeof insertBudgetSchema>;

// ============================================================================
// Org Settings (singleton row id=1)
// ============================================================================

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  orgName: text("org_name").notNull().default("My Business"),
  countryCode: text("country_code").notNull().default("INTL"),
  locale: text("locale").notNull().default("ar"), // 'ar' | 'en'
  currencyCode: text("currency_code").notNull().default("USD"),
  currencySymbol: text("currency_symbol").notNull().default("$"),
  vatRate: numeric("vat_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  zakatEnabled: boolean("zakat_enabled").notNull().default(false),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
});

export const upsertSettingsSchema = z.object({
  orgName: z.string().min(1).max(100),
  countryCode: z.string().min(2).max(8),
  locale: z.enum(["ar", "en"]),
  currencyCode: z.string().min(2).max(8),
  currencySymbol: z.string().min(1).max(8),
  vatRate: z.coerce.number().min(0).max(0.99),
  zakatEnabled: z.boolean(),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
});
export type OrgSettings = typeof settings.$inferSelect;
export type UpsertOrgSettings = z.infer<typeof upsertSettingsSchema>;

// ============================================================================
// HR — Employees, Attendance, Leaves, Payroll
// ============================================================================

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  jobTitle: text("job_title").notNull().default(""),
  hireDate: text("hire_date").notNull(), // YYYY-MM-DD
  baseSalary: numeric("base_salary", { precision: 12, scale: 2 }).notNull(),
  allowances: numeric("allowances", { precision: 12, scale: 2 }).notNull().default("0"),
  isNational: boolean("is_national").notNull().default(true),
  annualLeaveDaysOverride: integer("annual_leave_days_override"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEmployeeSchema = createInsertSchema(employees)
  .omit({ id: true, createdAt: true })
  .extend({
    baseSalary: z.coerce.number().nonnegative(),
    allowances: z.coerce.number().nonnegative().default(0),
    fullName: z.string().min(1, "الاسم مطلوب"),
    hireDate: z.string().min(1, "تاريخ التعيين مطلوب"),
  });
export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;

export const attendance = pgTable(
  "attendance",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    date: text("date").notNull(),
    status: text("status").notNull(), // present|absent|leave|holiday|weekend
    overtimeHours: numeric("overtime_hours", { precision: 5, scale: 2 }).notNull().default("0"),
  },
  (t) => ({ uniqEmpDate: index("attendance_emp_date_idx").on(t.employeeId, t.date) }),
);

export const insertAttendanceSchema = createInsertSchema(attendance)
  .omit({ id: true })
  .extend({ overtimeHours: z.coerce.number().nonnegative().default(0) });
export type Attendance = typeof attendance.$inferSelect;
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;

export const leaves = pgTable("leaves", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  days: integer("days").notNull(),
  type: text("type").notNull().default("annual"), // annual|sick|unpaid|other
  status: text("status").notNull().default("approved"), // approved|pending|rejected
  notes: text("notes").default(""),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLeaveSchema = createInsertSchema(leaves)
  .omit({ id: true, createdAt: true })
  .extend({ days: z.coerce.number().int().positive() });
export type Leave = typeof leaves.$inferSelect;
export type InsertLeave = z.infer<typeof insertLeaveSchema>;

export const payrollRuns = pgTable("payroll_runs", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  status: text("status").notNull().default("draft"), // draft|posted
  totalGross: numeric("total_gross", { precision: 14, scale: 2 }).notNull().default("0"),
  totalNet: numeric("total_net", { precision: 14, scale: 2 }).notNull().default("0"),
  journalEntryId: integer("journal_entry_id"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type PayrollRun = typeof payrollRuns.$inferSelect;

export const payrollLines = pgTable("payroll_lines", {
  id: serial("id").primaryKey(),
  payrollRunId: integer("payroll_run_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  baseSalary: numeric("base_salary", { precision: 12, scale: 2 }).notNull(),
  allowances: numeric("allowances", { precision: 12, scale: 2 }).notNull().default("0"),
  overtime: numeric("overtime", { precision: 12, scale: 2 }).notNull().default("0"),
  bonuses: numeric("bonuses", { precision: 12, scale: 2 }).notNull().default("0"),
  absenceDeduction: numeric("absence_deduction", { precision: 12, scale: 2 }).notNull().default("0"),
  advances: numeric("advances", { precision: 12, scale: 2 }).notNull().default("0"),
  socialInsuranceEmployee: numeric("si_employee", { precision: 12, scale: 2 }).notNull().default("0"),
  socialInsuranceEmployer: numeric("si_employer", { precision: 12, scale: 2 }).notNull().default("0"),
  netPay: numeric("net_pay", { precision: 12, scale: 2 }).notNull(),
  endOfServiceAccrual: numeric("eos_accrual", { precision: 12, scale: 2 }).notNull().default("0"),
  leaveAccrual: numeric("leave_accrual", { precision: 12, scale: 2 }).notNull().default("0"),
});
export type PayrollLine = typeof payrollLines.$inferSelect;

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
