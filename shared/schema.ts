import { pgTable, text, serial, numeric, timestamp, integer, boolean, index, jsonb, varchar, unique, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Re-export auth/membership/invitation/session schema so drizzle-kit picks it up.
export * from "./models/auth";

// ============================================================================
// Chart of Accounts (IFRS-aligned)
// ============================================================================

// IFRS account types
// asset, liability, equity, revenue, expense
// subtype examples: current_asset, non_current_asset, current_liability,
// non_current_liability, capital, retained_earnings, drawings,
// operating_revenue, other_income, cogs, operating_expense, contra_revenue,
// contra_asset
export const accounts = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(),
    // Intentionally NO column default: every insert site must supply the
    // active workspace explicitly so a missing companyId fails loudly rather
    // than silently being attributed to workspace 1. Enforced by the
    // generalised regression net in `database-companyid-no-default.spec.ts`.
    companyId: integer("company_id").notNull(),
    code: text("code").notNull(), // e.g., "1110" — unique per workspace; see codeCompanyUq below
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    type: text("type").notNull(), // asset|liability|equity|revenue|expense
    subtype: text("subtype").notNull(), // see comment above
    parentId: integer("parent_id"),
    isHeader: boolean("is_header").notNull().default(false), // grouping rows have no postings
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    // Defense-in-depth: workspace-scoped uniqueness on (id, company_id) so
    // child tables can declare composite FKs that physically refuse cross-
    // tenant writes. See docs/design/workspace-isolation-defense-in-depth.md.
    idCompanyUq: unique("accounts_id_company_uq").on(t.id, t.companyId),
    // Account codes are unique *within* a workspace, not globally. Each
    // workspace seeds its own chart of accounts (cash "1110", revenue
    // "4010", etc.), so the global unique that drizzle would otherwise
    // attach to `code` would block every workspace after the first from
    // owning a "1110" cash account of its own.
    codeCompanyUq: unique("accounts_code_company_uq").on(t.companyId, t.code),
    // A child account's parent must live in the same workspace.
    parentCompanyFk: foreignKey({
      columns: [t.parentId, t.companyId],
      foreignColumns: [t.id, t.companyId],
      name: "accounts_parent_company_fk",
    }),
  }),
);

export const insertAccountSchema = createInsertSchema(accounts).omit({ id: true, createdAt: true, companyId: true });
export type Account = typeof accounts.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;

// ============================================================================
// Journal Entries (double-entry)
// ============================================================================

export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  // No column default — see `accounts.companyId` for the rationale.
  companyId: integer("company_id").notNull(),
  reference: text("reference").notNull(), // JE-0001
  entryDate: timestamp("entry_date").notNull().defaultNow(),
  description: text("description").notNull(),
  source: text("source").notNull().default("manual"), // manual|ai|transaction
  sourceTransactionId: integer("source_transaction_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  dateIdx: index("je_date_idx").on(table.entryDate),
  // Defense-in-depth: enables composite FKs from journal_lines back to a JE
  // in the same workspace.
  idCompanyUq: unique("journal_entries_id_company_uq").on(table.id, table.companyId),
}));

// `journal_lines` carries a denormalised `companyId` (always equal to the
// parent JE's `companyId`) so the database can enforce two composite foreign
// keys: one to the parent journal entry and one to the referenced account,
// both keyed on `(id, company_id)`. This makes cross-tenant writes impossible
// regardless of route code. See docs/design/workspace-isolation-defense-in-depth.md.
//
// Intentionally NO column default: every insert site must supply the active
// workspace explicitly so a missing companyId fails loudly rather than
// silently being attributed to workspace 1. The migration drops the default
// after back-fill for the same reason.
export const journalLines = pgTable("journal_lines", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  journalEntryId: integer("journal_entry_id").notNull(),
  accountId: integer("account_id").notNull(),
  debit: numeric("debit", { precision: 14, scale: 2 }).notNull().default("0"),
  credit: numeric("credit", { precision: 14, scale: 2 }).notNull().default("0"),
  description: text("description"),
}, (table) => ({
  jeIdx: index("jl_je_idx").on(table.journalEntryId),
  accountIdx: index("jl_account_idx").on(table.accountId),
  jeCompanyFk: foreignKey({
    columns: [table.journalEntryId, table.companyId],
    foreignColumns: [journalEntries.id, journalEntries.companyId],
    name: "journal_lines_je_company_fk",
  }),
  accountCompanyFk: foreignKey({
    columns: [table.accountId, table.companyId],
    foreignColumns: [accounts.id, accounts.companyId],
    name: "journal_lines_account_company_fk",
  }),
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
  companyId: true,
}).extend({
  debit: z.union([z.string(), z.number()]).default(0),
  credit: z.union([z.string(), z.number()]).default(0),
});
export type JournalLine = typeof journalLines.$inferSelect;
export type InsertJournalLine = z.infer<typeof insertJournalLineSchema>;

// `JournalEntrySourceLink` is computed at read time by joining the JE id
// against the modules that auto-post to it (payroll runs, depreciation runs,
// fixed-asset events, sales invoices). The link is omitted when no such row
// exists, which naturally hides the badge if the source row was later deleted.
export type JournalEntrySourceKind =
  | "payroll_run"
  | "depreciation_run"
  | "impairment"
  | "revaluation"
  | "disposal"
  | "sales_invoice";

export interface JournalEntrySourceLink {
  kind: JournalEntrySourceKind;
  id: number;
  href: string;
  // Period for runs (payroll/depreciation):
  period?: { year: number; month: number };
  // Asset context for fixed-asset events:
  assetId?: number;
  assetCode?: string;
  assetName?: string;
  eventDate?: string;
}

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

// `source` is intentionally omitted so an edit can't relabel an AI-posted
// entry as manual or vice-versa.
export const updateJournalEntrySchema = z.object({
  entryDate: z.string().or(z.date()).optional(),
  description: z.string().min(1).max(300),
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
export type UpdateJournalEntryInput = z.infer<typeof updateJournalEntrySchema>;

// ============================================================================
// Simple Transactions (legacy/quick entry — auto-posted to journal)
// ============================================================================

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  // No column default — see `accounts.companyId` for the rationale.
  companyId: integer("company_id").notNull(),
  type: text("type").notNull(), // 'income' or 'expense'
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  date: timestamp("date").defaultNow(),
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({ id: true, date: true, companyId: true }).extend({
  amount: z.union([z.string(), z.number()]),
});

export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type CreateTransactionRequest = InsertTransaction;

// Augments the raw Transaction row with the auto-posted journal entry the
// transaction was reflected into. Both fields are optional because:
//  * The JE is created in a try/catch right after the transaction insert and
//    can theoretically fail (e.g. missing CASH account on a brand new
//    workspace), leaving a transaction without a linked JE.
//  * Legacy rows imported before the auto-post bridge existed never had a JE
//    posted in the first place.
// The transaction detail dialog uses these fields to render the
// "Posted as JE-…" deep-link badge and gracefully hides it when absent.
export type TransactionWithJournal = Transaction & {
  journalEntryId?: number | null;
  journalEntryReference?: string | null;
};

// ============================================================================
// Budgets (per-account monthly budgets for Budget vs Actual)
// ============================================================================

export const budgets = pgTable(
  "budgets",
  {
    id: serial("id").primaryKey(),
    // No column default — see `accounts.companyId` for the rationale.
    companyId: integer("company_id").notNull(),
    accountId: integer("account_id").notNull(),
    year: integer("year").notNull(),
    month: integer("month").notNull(), // 1-12
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    // Defense-in-depth: budgeted account must live in the same workspace.
    accountCompanyFk: foreignKey({
      columns: [t.accountId, t.companyId],
      foreignColumns: [accounts.id, accounts.companyId],
      name: "budgets_account_company_fk",
    }),
  }),
);

export const insertBudgetSchema = createInsertSchema(budgets).omit({ id: true, createdAt: true, companyId: true }).extend({
  amount: z.coerce.number().nonnegative(),
});
export type Budget = typeof budgets.$inferSelect;
export type InsertBudget = z.infer<typeof insertBudgetSchema>;

// ============================================================================
// Org Settings (singleton row id=1)
// ============================================================================

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  // No column default — see `accounts.companyId` for the rationale.
  companyId: integer("company_id").notNull(),
  orgName: text("org_name").notNull().default("My Business"),
  countryCode: text("country_code").notNull().default("INTL"),
  locale: text("locale").notNull().default("ar"), // 'ar' | 'en'
  currencyCode: text("currency_code").notNull().default("USD"),
  currencySymbol: text("currency_symbol").notNull().default("$"),
  vatRate: numeric("vat_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  zakatEnabled: boolean("zakat_enabled").notNull().default(false),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
  // Workspace-default costing method for inventory items whose own
  // `products.costingMethod` is null. Added by migration 0023.
  defaultCostingMethod: text("default_costing_method").notNull().default("avg"),
  // Workspace business type drives which sections appear in the IFRS reports.
  // - "service":       no Cost of Goods Sold section (a service company has no
  //                    inventory to consume), so the income statement collapses
  //                    revenue → operating expenses → net profit.
  // - "trading":       buys finished goods and resells them — full COGS section.
  // - "manufacturing": produces goods — full COGS section + (future) WIP.
  // Default "service" is the safest assumption for a brand-new workspace
  // because it never accidentally implies inventory the user doesn't track.
  // See migration 0024_settings_business_type.sql for the column definition.
  businessType: text("business_type").notNull().default("service"),
});

export const upsertSettingsSchema = z.object({
  orgName: z.string().min(1).max(100),
  countryCode: z.string().min(2).max(8),
  locale: z.enum(["ar", "en", "de", "fr"]),
  currencyCode: z.string().min(1),
  currencySymbol: z.string().min(1),
  vatRate: z.coerce.number().min(0).max(0.99),
  zakatEnabled: z.boolean(),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  defaultCostingMethod: z.enum(["fifo", "avg"]).default("avg"),
  businessType: z.enum(["service", "trading", "manufacturing"]).default("service"),
});
export type OrgSettings = typeof settings.$inferSelect;
export type UpsertOrgSettings = z.infer<typeof upsertSettingsSchema>;

// ============================================================================
// HR — Employees, Attendance, Leaves, Payroll
// ============================================================================

export const employees = pgTable(
  "employees",
  {
    id: serial("id").primaryKey(),
    // No column default — see `accounts.companyId` for the rationale.
    companyId: integer("company_id").notNull(),
    fullName: text("full_name").notNull(),
    jobTitle: text("job_title").notNull().default(""),
    hireDate: text("hire_date").notNull(), // YYYY-MM-DD
    baseSalary: numeric("base_salary", { precision: 12, scale: 2 }).notNull(),
    allowances: numeric("allowances", { precision: 12, scale: 2 }).notNull().default("0"),
    isNational: boolean("is_national").notNull().default(true),
    annualLeaveDaysOverride: integer("annual_leave_days_override"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    // Defense-in-depth: lets future child tables (attendance, leaves,
    // payroll_lines) declare composite FKs back to (id, company_id).
    idCompanyUq: unique("employees_id_company_uq").on(t.id, t.companyId),
  }),
);

export const insertEmployeeSchema = createInsertSchema(employees)
  .omit({ id: true, createdAt: true, companyId: true })
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
    // No column default — see `accounts.companyId` for the rationale.
    companyId: integer("company_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    date: text("date").notNull(),
    status: text("status").notNull(), // present|absent|leave|holiday|weekend
    overtimeHours: numeric("overtime_hours", { precision: 5, scale: 2 }).notNull().default("0"),
  },
  (t) => ({
    uniqEmpDate: index("attendance_emp_date_idx").on(t.employeeId, t.date),
    // Defense-in-depth: an attendance row's employee must live in the same
    // workspace. Closes the same gap composite FKs already close on accounts /
    // journal_lines / fixed_assets / etc.
    employeeCompanyFk: foreignKey({
      columns: [t.employeeId, t.companyId],
      foreignColumns: [employees.id, employees.companyId],
      name: "attendance_employee_company_fk",
    }),
  }),
);

export const insertAttendanceSchema = createInsertSchema(attendance)
  .omit({ id: true, companyId: true })
  .extend({ overtimeHours: z.coerce.number().nonnegative().default(0) });
export type Attendance = typeof attendance.$inferSelect;
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;

export const leaves = pgTable(
  "leaves",
  {
    id: serial("id").primaryKey(),
    // No column default — see `accounts.companyId` for the rationale.
    companyId: integer("company_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    days: integer("days").notNull(),
    type: text("type").notNull().default("annual"), // annual|sick|unpaid|other
    status: text("status").notNull().default("approved"), // approved|pending|rejected
    notes: text("notes").default(""),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    // Defense-in-depth: a leave row's employee must live in the same workspace.
    employeeCompanyFk: foreignKey({
      columns: [t.employeeId, t.companyId],
      foreignColumns: [employees.id, employees.companyId],
      name: "leaves_employee_company_fk",
    }),
  }),
);

export const insertLeaveSchema = createInsertSchema(leaves)
  .omit({ id: true, createdAt: true, companyId: true })
  .extend({ days: z.coerce.number().int().positive() });
export type Leave = typeof leaves.$inferSelect;
export type InsertLeave = z.infer<typeof insertLeaveSchema>;

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: serial("id").primaryKey(),
    // No column default — see `accounts.companyId` for the rationale.
    companyId: integer("company_id").notNull(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    status: text("status").notNull().default("draft"), // draft|posted
    totalGross: numeric("total_gross", { precision: 14, scale: 2 }).notNull().default("0"),
    totalNet: numeric("total_net", { precision: 14, scale: 2 }).notNull().default("0"),
    journalEntryId: integer("journal_entry_id"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    // Defense-in-depth: enables a composite FK from payroll_lines back to a
    // run in the same workspace.
    idCompanyUq: unique("payroll_runs_id_company_uq").on(t.id, t.companyId),
  }),
);
export type PayrollRun = typeof payrollRuns.$inferSelect;

// `payroll_lines` carries a denormalised `companyId` (always equal to the
// parent run's `companyId`) so the database can enforce composite foreign
// keys to both `payroll_runs` and `employees`. Same recipe as `journal_lines`
// — see docs/design/workspace-isolation-defense-in-depth.md.
//
// Intentionally NO column default: every insert site must supply the active
// workspace explicitly so a missing companyId fails loudly.
export const payrollLines = pgTable(
  "payroll_lines",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
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
  },
  (t) => ({
    runCompanyFk: foreignKey({
      columns: [t.payrollRunId, t.companyId],
      foreignColumns: [payrollRuns.id, payrollRuns.companyId],
      name: "payroll_lines_run_company_fk",
    }),
    employeeCompanyFk: foreignKey({
      columns: [t.employeeId, t.companyId],
      foreignColumns: [employees.id, employees.companyId],
      name: "payroll_lines_employee_company_fk",
    }),
  }),
);
export type PayrollLine = typeof payrollLines.$inferSelect;

// Returned by GET /api/hr/payroll/runs/:id/lines — every payroll line is
// enriched with the employee's full name (joined server-side) so the Lines
// tab in the payroll-run detail dialog can render a per-employee breakdown
// without firing a second request per row. `employeeName` is nullable to
// account for the (currently impossible, but defensive) case of a payroll
// line whose employee row has been hard-deleted out from under it.
export type PayrollLineWithEmployee = PayrollLine & {
  employeeName: string | null;
};

// ============================================================================
// Multi-company & FX (used by Fixed Assets module)
// ============================================================================

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  functionalCurrency: text("functional_currency").notNull().default("USD"),
  currencySymbol: text("currency_symbol").notNull().default("$"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  // Owner of the workspace (the user that created the company). Nullable for
  // legacy seed rows; the auth bootstrap path back-fills ownership on first sign-up.
  ownerUserId: varchar("owner_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertCompanySchema = createInsertSchema(companies).omit({ id: true, createdAt: true });
export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;

export const fxRates = pgTable("fx_rates", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  fromCurrency: text("from_currency").notNull(),
  toCurrency: text("to_currency").notNull(), // typically the company's functional currency
  rateDate: text("rate_date").notNull(), // YYYY-MM-DD
  rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertFxRateSchema = createInsertSchema(fxRates).omit({ id: true, createdAt: true, companyId: true }).extend({
  rate: z.coerce.number().positive(),
});
export type FxRate = typeof fxRates.$inferSelect;
export type InsertFxRate = z.infer<typeof insertFxRateSchema>;

// ============================================================================
// Fixed Assets (IAS 16 / IAS 36)
// ============================================================================

// Depreciation methods supported by the engine
export const DEPRECIATION_METHODS = [
  "straight_line",
  "declining_balance",
  "double_declining",
  "syd",
  "units_of_production",
  "custom",
] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

export const MEASUREMENT_MODELS = ["cost", "revaluation"] as const;
export type MeasurementModel = (typeof MEASUREMENT_MODELS)[number];

export const assetCategories = pgTable(
  "asset_categories",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    name: text("name").notNull(),
    measurementModel: text("measurement_model").notNull().default("cost"),
    defaultUsefulLifeMonths: integer("default_useful_life_months").notNull().default(60),
    defaultMethod: text("default_method").notNull().default("straight_line"),
    // GL account mappings (account ids)
    assetCostAccountId: integer("asset_cost_account_id").notNull(),
    accumulatedDepAccountId: integer("accumulated_dep_account_id").notNull(),
    depExpenseAccountId: integer("dep_expense_account_id").notNull(),
    accumulatedImpAccountId: integer("accumulated_imp_account_id").notNull(),
    impLossAccountId: integer("imp_loss_account_id").notNull(),
    revalSurplusAccountId: integer("reval_surplus_account_id").notNull(),
    gainLossDisposalAccountId: integer("gain_loss_disposal_account_id").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    // Defense-in-depth: enables a composite FK from fixed_assets back to a
    // category in the same workspace.
    idCompanyUq: unique("asset_categories_id_company_uq").on(t.id, t.companyId),
    // Every account-id pointer on this row must reference an account in the
    // same workspace. Enforced as composite FKs.
    assetCostCompanyFk: foreignKey({
      columns: [t.assetCostAccountId, t.companyId],
      foreignColumns: [accounts.id, accounts.companyId],
      name: "asset_categories_asset_cost_company_fk",
    }),
    accumDepCompanyFk: foreignKey({
      columns: [t.accumulatedDepAccountId, t.companyId],
      foreignColumns: [accounts.id, accounts.companyId],
      name: "asset_categories_accum_dep_company_fk",
    }),
    depExpenseCompanyFk: foreignKey({
      columns: [t.depExpenseAccountId, t.companyId],
      foreignColumns: [accounts.id, accounts.companyId],
      name: "asset_categories_dep_expense_company_fk",
    }),
    accumImpCompanyFk: foreignKey({
      columns: [t.accumulatedImpAccountId, t.companyId],
      foreignColumns: [accounts.id, accounts.companyId],
      name: "asset_categories_accum_imp_company_fk",
    }),
    impLossCompanyFk: foreignKey({
      columns: [t.impLossAccountId, t.companyId],
      foreignColumns: [accounts.id, accounts.companyId],
      name: "asset_categories_imp_loss_company_fk",
    }),
    revalSurplusCompanyFk: foreignKey({
      columns: [t.revalSurplusAccountId, t.companyId],
      foreignColumns: [accounts.id, accounts.companyId],
      name: "asset_categories_reval_surplus_company_fk",
    }),
    gainLossDisposalCompanyFk: foreignKey({
      columns: [t.gainLossDisposalAccountId, t.companyId],
      foreignColumns: [accounts.id, accounts.companyId],
      name: "asset_categories_gain_loss_disposal_company_fk",
    }),
  }),
);
export const insertAssetCategorySchema = createInsertSchema(assetCategories).omit({ id: true, createdAt: true, companyId: true });
export type AssetCategory = typeof assetCategories.$inferSelect;
export type InsertAssetCategory = z.infer<typeof insertAssetCategorySchema>;

export const fixedAssets = pgTable("fixed_assets", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  categoryId: integer("category_id").notNull(),
  // (defense-in-depth FKs declared in the table builder below)
  code: text("code").notNull(),
  name: text("name").notNull(),
  acquisitionDate: text("acquisition_date").notNull(),
  inServiceDate: text("in_service_date").notNull(),
  // Original cost in transaction currency
  currency: text("currency").notNull(),
  txCost: numeric("tx_cost", { precision: 18, scale: 2 }).notNull(),
  fxRate: numeric("fx_rate", { precision: 18, scale: 8 }).notNull().default("1"),
  // Functional-currency cost (cost * fxRate)
  cost: numeric("cost", { precision: 18, scale: 2 }).notNull(),
  residual: numeric("residual", { precision: 18, scale: 2 }).notNull().default("0"),
  usefulLifeMonths: integer("useful_life_months").notNull(),
  method: text("method").notNull().default("straight_line"),
  unitsTotal: numeric("units_total", { precision: 18, scale: 2 }), // for units_of_production
  // For custom-schedule depreciation: JSON-encoded array of monthly amounts
  // in chronological order from inServiceDate.
  customSchedule: text("custom_schedule"),
  measurementModel: text("measurement_model").notNull().default("cost"),
  status: text("status").notNull().default("active"), // active|disposed|fully_depreciated
  location: text("location").default(""),
  custodian: text("custodian").default(""),
  // Cached running balances (functional currency)
  accumDepreciation: numeric("accum_depreciation", { precision: 18, scale: 2 }).notNull().default("0"),
  accumImpairment: numeric("accum_impairment", { precision: 18, scale: 2 }).notNull().default("0"),
  revalSurplus: numeric("reval_surplus", { precision: 18, scale: 2 }).notNull().default("0"),
  // Hypothetical accumulated depreciation as if no impairment had ever occurred
  // (IAS 36: cap on impairment reversal = carrying amount that would have existed
  // had no impairment been recognised, net of depreciation).
  accumDepNoImpairment: numeric("accum_dep_no_impairment", { precision: 18, scale: 2 }).notNull().default("0"),
  // Cumulative revaluation losses charged to P&L (used by IAS 16 to reverse to
  // P&L first on subsequent upward revaluations).
  accumRevalLoss: numeric("accum_reval_loss", { precision: 18, scale: 2 }).notNull().default("0"),
  // Last period the asset was depreciated for: YYYY-MM
  lastDepreciatedPeriod: text("last_depreciated_period"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  // Defense-in-depth: workspace-scoped uniqueness so future child tables
  // (asset_components, depreciation_schedule, …) can declare composite FKs.
  idCompanyUq: unique("fixed_assets_id_company_uq").on(t.id, t.companyId),
  // The category an asset belongs to must live in the same workspace.
  categoryCompanyFk: foreignKey({
    columns: [t.categoryId, t.companyId],
    foreignColumns: [assetCategories.id, assetCategories.companyId],
    name: "fixed_assets_category_company_fk",
  }),
}));
export const insertFixedAssetSchema = createInsertSchema(fixedAssets)
  .omit({ id: true, createdAt: true, accumDepreciation: true, accumImpairment: true, revalSurplus: true, accumDepNoImpairment: true, accumRevalLoss: true, lastDepreciatedPeriod: true, cost: true, customSchedule: true, companyId: true })
  .extend({
    txCost: z.coerce.number().positive(),
    fxRate: z.coerce.number().positive().default(1),
    residual: z.coerce.number().nonnegative().default(0),
    usefulLifeMonths: z.coerce.number().int().positive(),
    unitsTotal: z.coerce.number().positive().optional().nullable(),
    method: z.enum(DEPRECIATION_METHODS),
    measurementModel: z.enum(MEASUREMENT_MODELS).default("cost"),
    customSchedule: z.array(z.coerce.number().nonnegative()).optional().nullable(),
  });
export type FixedAsset = typeof fixedAssets.$inferSelect;
export type InsertFixedAsset = z.infer<typeof insertFixedAssetSchema>;

// `asset_components` carries a denormalised `companyId` (always equal to the
// parent asset's `companyId`) so the database can enforce a composite FK back
// to `fixed_assets` AND act as a parent for further composite FKs from
// depreciation_schedule, depreciation_postings, asset_usage_periods, etc.
//
// Intentionally NO column default: every insert site must supply the active
// workspace explicitly.
export const assetComponents = pgTable(
  "asset_components",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    assetId: integer("asset_id").notNull(),
    name: text("name").notNull(),
    cost: numeric("cost", { precision: 18, scale: 2 }).notNull(),
    residual: numeric("residual", { precision: 18, scale: 2 }).notNull().default("0"),
    usefulLifeMonths: integer("useful_life_months").notNull(),
    method: text("method").notNull().default("straight_line"),
    unitsTotal: numeric("units_total", { precision: 18, scale: 2 }),
    accumDepreciation: numeric("accum_depreciation", { precision: 18, scale: 2 }).notNull().default("0"),
    accumImpairment: numeric("accum_impairment", { precision: 18, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    // Defense-in-depth: the parent asset must live in the same workspace.
    assetCompanyFk: foreignKey({
      columns: [t.assetId, t.companyId],
      foreignColumns: [fixedAssets.id, fixedAssets.companyId],
      name: "asset_components_asset_company_fk",
    }),
    // Lets child tables (depreciation_schedule, depreciation_postings,
    // asset_usage_periods, impairment_events, revaluation_events) declare
    // composite FKs back to a component in the same workspace.
    idCompanyUq: unique("asset_components_id_company_uq").on(t.id, t.companyId),
  }),
);
export const insertAssetComponentSchema = createInsertSchema(assetComponents)
  .omit({ id: true, createdAt: true, accumDepreciation: true, accumImpairment: true, companyId: true })
  .extend({
    cost: z.coerce.number().positive(),
    residual: z.coerce.number().nonnegative().default(0),
    usefulLifeMonths: z.coerce.number().int().positive(),
    unitsTotal: z.coerce.number().positive().optional().nullable(),
    method: z.enum(DEPRECIATION_METHODS),
  });
export type AssetComponent = typeof assetComponents.$inferSelect;
export type InsertAssetComponent = z.infer<typeof insertAssetComponentSchema>;

export const depreciationRuns = pgTable(
  "depreciation_runs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    status: text("status").notNull().default("draft"), // draft|posted
    totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    journalEntryId: integer("journal_entry_id"),
    createdAt: timestamp("created_at").defaultNow(),
    postedAt: timestamp("posted_at"),
  },
  (t) => ({
    // Defense-in-depth: lets depreciation_schedule and depreciation_postings
    // declare composite FKs back to a run in the same workspace.
    idCompanyUq: unique("depreciation_runs_id_company_uq").on(t.id, t.companyId),
  }),
);
export type DepreciationRun = typeof depreciationRuns.$inferSelect;

// `depreciation_schedule` carries a denormalised `companyId` so it can take
// part in composite FKs to its parent asset, parent component (when set), and
// posting run (when set). Intentionally NO column default — every insert
// site must supply the active workspace explicitly.
export const depreciationSchedule = pgTable(
  "depreciation_schedule",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    assetId: integer("asset_id").notNull(),
    componentId: integer("component_id"),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    plannedAmount: numeric("planned_amount", { precision: 18, scale: 2 }).notNull(),
    status: text("status").notNull().default("planned"), // planned|posted
    runId: integer("run_id"),
  },
  (t) => ({
    assetCompanyFk: foreignKey({
      columns: [t.assetId, t.companyId],
      foreignColumns: [fixedAssets.id, fixedAssets.companyId],
      name: "depreciation_schedule_asset_company_fk",
    }),
    // componentId is nullable; Postgres MATCH SIMPLE skips the FK check when
    // any column of the FK is NULL, so component-less rows aren't blocked.
    componentCompanyFk: foreignKey({
      columns: [t.componentId, t.companyId],
      foreignColumns: [assetComponents.id, assetComponents.companyId],
      name: "depreciation_schedule_component_company_fk",
    }),
    // runId is nullable — planned rows have no run yet; posted rows do.
    runCompanyFk: foreignKey({
      columns: [t.runId, t.companyId],
      foreignColumns: [depreciationRuns.id, depreciationRuns.companyId],
      name: "depreciation_schedule_run_company_fk",
    }),
  }),
);
export type DepreciationScheduleRow = typeof depreciationSchedule.$inferSelect;

// `depreciation_postings` carries a denormalised `companyId` so it can FK
// back to its run (in the same workspace) AND to its asset / component.
// Intentionally NO column default.
export const depreciationPostings = pgTable(
  "depreciation_postings",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    runId: integer("run_id").notNull(),
    assetId: integer("asset_id").notNull(),
    componentId: integer("component_id"),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  },
  (t) => ({
    runCompanyFk: foreignKey({
      columns: [t.runId, t.companyId],
      foreignColumns: [depreciationRuns.id, depreciationRuns.companyId],
      name: "depreciation_postings_run_company_fk",
    }),
    assetCompanyFk: foreignKey({
      columns: [t.assetId, t.companyId],
      foreignColumns: [fixedAssets.id, fixedAssets.companyId],
      name: "depreciation_postings_asset_company_fk",
    }),
    componentCompanyFk: foreignKey({
      columns: [t.componentId, t.companyId],
      foreignColumns: [assetComponents.id, assetComponents.companyId],
      name: "depreciation_postings_component_company_fk",
    }),
  }),
);
export type DepreciationPosting = typeof depreciationPostings.$inferSelect;

// Recorded usage for units-of-production assets, per period. Carries a
// denormalised `companyId` so it can FK to its parent asset / component.
// Intentionally NO column default.
export const assetUsagePeriods = pgTable(
  "asset_usage_periods",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    assetId: integer("asset_id").notNull(),
    componentId: integer("component_id"),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    units: numeric("units", { precision: 18, scale: 2 }).notNull(),
  },
  (t) => ({
    assetCompanyFk: foreignKey({
      columns: [t.assetId, t.companyId],
      foreignColumns: [fixedAssets.id, fixedAssets.companyId],
      name: "asset_usage_periods_asset_company_fk",
    }),
    componentCompanyFk: foreignKey({
      columns: [t.componentId, t.companyId],
      foreignColumns: [assetComponents.id, assetComponents.companyId],
      name: "asset_usage_periods_component_company_fk",
    }),
  }),
);
export const insertAssetUsageSchema = createInsertSchema(assetUsagePeriods).omit({ id: true, companyId: true }).extend({
  units: z.coerce.number().nonnegative(),
});
export type AssetUsagePeriod = typeof assetUsagePeriods.$inferSelect;
export type InsertAssetUsagePeriod = z.infer<typeof insertAssetUsageSchema>;

// `impairment_events` / `revaluation_events` / `disposals` all carry a
// denormalised `companyId` so they can FK back to their parent asset (and
// component, where applicable) within the same workspace. Intentionally NO
// column default on companyId.
export const impairmentEvents = pgTable(
  "impairment_events",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    assetId: integer("asset_id").notNull(),
    componentId: integer("component_id"),
    eventDate: text("event_date").notNull(),
    recoverableAmount: numeric("recoverable_amount", { precision: 18, scale: 2 }).notNull(),
    // positive = loss; negative = reversal
    lossAmount: numeric("loss_amount", { precision: 18, scale: 2 }).notNull(),
    journalEntryId: integer("journal_entry_id"),
    notes: text("notes").default(""),
    // Snapshot of the per-asset balance changes this event applied. Used by
    // the matching DELETE route (see server/storage.ts deleteImpairmentEvent)
    // to roll the asset row back precisely. Shape:
    //   { asset?: { accumImpairment?: delta }, components?: [{ id, accumImpairmentDelta }] }
    // Nullable for rows created before task #157 — the delete path falls back
    // to a no-op for those (documented in storage.ts).
    assetBalanceDelta: jsonb("asset_balance_delta"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    assetCompanyFk: foreignKey({
      columns: [t.assetId, t.companyId],
      foreignColumns: [fixedAssets.id, fixedAssets.companyId],
      name: "impairment_events_asset_company_fk",
    }),
    componentCompanyFk: foreignKey({
      columns: [t.componentId, t.companyId],
      foreignColumns: [assetComponents.id, assetComponents.companyId],
      name: "impairment_events_component_company_fk",
    }),
  }),
);
export type ImpairmentEvent = typeof impairmentEvents.$inferSelect;

export const revaluationEvents = pgTable(
  "revaluation_events",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    assetId: integer("asset_id").notNull(),
    componentId: integer("component_id"),
    eventDate: text("event_date").notNull(),
    fairValue: numeric("fair_value", { precision: 18, scale: 2 }).notNull(),
    method: text("method").notNull().default("elimination"), // elimination|proportional
    surplusDelta: numeric("surplus_delta", { precision: 18, scale: 2 }).notNull().default("0"), // change to OCI surplus
    plImpact: numeric("pl_impact", { precision: 18, scale: 2 }).notNull().default("0"), // change recorded in P&L (negative for loss)
    journalEntryId: integer("journal_entry_id"),
    notes: text("notes").default(""),
    // Snapshot of the per-asset balance changes this event applied. Used by
    // deleteRevaluationEvent in server/storage.ts to reverse the asset row.
    // Shape: { asset?: { cost?, accumDepreciation?, accumImpairment?,
    //                    revalSurplus?, accumRevalLoss? } }
    // Nullable for rows created before task #157.
    assetBalanceDelta: jsonb("asset_balance_delta"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    assetCompanyFk: foreignKey({
      columns: [t.assetId, t.companyId],
      foreignColumns: [fixedAssets.id, fixedAssets.companyId],
      name: "revaluation_events_asset_company_fk",
    }),
    componentCompanyFk: foreignKey({
      columns: [t.componentId, t.companyId],
      foreignColumns: [assetComponents.id, assetComponents.companyId],
      name: "revaluation_events_component_company_fk",
    }),
  }),
);
export type RevaluationEvent = typeof revaluationEvents.$inferSelect;

export const disposals = pgTable(
  "disposals",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    assetId: integer("asset_id").notNull(),
    eventDate: text("event_date").notNull(),
    proceeds: numeric("proceeds", { precision: 18, scale: 2 }).notNull().default("0"),
    method: text("method").notNull().default("sale"), // sale|scrap|writeoff
    gainLoss: numeric("gain_loss", { precision: 18, scale: 2 }).notNull().default("0"),
    surplusTransferred: numeric("surplus_transferred", { precision: 18, scale: 2 }).notNull().default("0"),
    journalEntryId: integer("journal_entry_id"),
    notes: text("notes").default(""),
    // Snapshot of the per-asset balance changes this event applied. Used by
    // deleteDisposal in server/storage.ts to reverse the asset row. Shape:
    //   { asset?: { revalSurplus?: delta, statusBefore?: string } }
    // Nullable for rows created before task #157.
    assetBalanceDelta: jsonb("asset_balance_delta"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    assetCompanyFk: foreignKey({
      columns: [t.assetId, t.companyId],
      foreignColumns: [fixedAssets.id, fixedAssets.companyId],
      name: "disposals_asset_company_fk",
    }),
  }),
);
export type Disposal = typeof disposals.$inferSelect;

// ============================================================================
// Workspace members (RBAC mirror)
// ============================================================================

// Re-export the canonical role enum from `shared/models/auth.ts` under the
// historical `WORKSPACE_ROLES` / `WorkspaceRole` names so existing imports
// keep working. There is now a single role vocabulary across the app — see
// `shared/models/auth.ts` for the source of truth.
import { ROLES as _ROLES, type Role as _Role } from "./models/auth";
export const WORKSPACE_ROLES = _ROLES;
export type WorkspaceRole = _Role;

// The legacy `workspace_members` mirror table was retired in 2026-04 (see
// migrations/0006_drop_workspace_members.sql). Identity now lives in a
// single place: the canonical `users` + `memberships` tables. The
// `req.member` shape that backs `/api/auth/me` is now built in memory by
// `resolveCurrentMember` in `server/auth.ts` — see `CurrentMember` there.

// The legacy `workspace_invites` table + its `inviteMemberSchema` /
// `acceptInviteSchema` validators were retired in 2026-04. Real invitations
// live in the `invitations` table (shared/models/auth.ts) and are validated by
// `inviteSchema` from the same module. Migration `0004_drop_workspace_invites.sql`
// drops the obsolete table.

// ============================================================================
// Chat
// ============================================================================

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  // No column default — see `accounts.companyId` for the rationale.
  companyId: integer("company_id").notNull(),
  role: text("role").notNull(), // 'user' or 'assistant'
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true, companyId: true });

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;

// ============================================================================
// Audit Log — tracks who changed what across major entities
// ============================================================================

// entityType: transaction|journal_entry|account|fixed_asset|employee|attendance|leave
// action: create|update|delete|post
// source: user|ai|integration|system
//
// The `companyId` column was backfilled and made NOT NULL by migration
// 0016 so the audit log can come under the same workspace_isolation RLS
// policy as every other workspace-scoped table. Before that, tenant
// ownership of an audit row was implicit through the entity row it
// pointed at — which broke down on "delete" audits whose entity was
// gone, and forced `getJournalEntryAuditWithReversal` to fall back on a
// `companyId` stamp inside the `changes` JSON. See
// docs/design/workspace-isolation-defense-in-depth.md.
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    // No column default — see `accounts.companyId` for the rationale.
    companyId: integer("company_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    action: text("action").notNull(),
    actor: text("actor"),
    source: text("source").notNull().default("user"),
    changes: jsonb("changes").notNull().default(sql`'[]'::jsonb`),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("audit_log_entity_idx").on(t.entityType, t.entityId),
    // Workspace-scoped lookup: the RLS policy already filters to the
    // active workspace, so the `getAuditLog` query (which scans by
    // entity_type + entity_id) benefits from a leading `company_id`
    // index column for the planner.
    companyEntityIdx: index("audit_log_company_entity_idx").on(
      t.companyId,
      t.entityType,
      t.entityId,
    ),
    // Date-aware sibling for the bounded `getAuditLog` (task #251). The
    // `from` / `to` ISO date params on the audit-history endpoint push a
    // `occurred_at >= ? AND occurred_at <= ?` predicate into the SQL on
    // top of the (company_id, entity_type, entity_id) tuple. With only
    // the 3-column composite above, the planner has to read every row
    // matching the entity tuple and filter by `occurred_at` after the
    // fact — fine for a handful of rows, painful for entities with
    // thousands of audit rows. This 4-column variant lets the bounded
    // case do a true index range scan, and because `occurred_at` is
    // indexed DESC the unbounded `ORDER BY occurred_at DESC` is
    // satisfied directly off the index without a sort step. The 3-column
    // sibling is left in place so the planner still has the narrower
    // index for the no-bounds path; either index can serve it and the
    // observable cost should be unchanged.
    companyEntityOccurredIdx: index("audit_log_company_entity_occurred_idx").on(
      t.companyId,
      t.entityType,
      t.entityId,
      t.occurredAt.desc(),
    ),
  }),
);

export type AuditChange = { field: string; from?: unknown; to?: unknown };
export type AuditLogEntry = typeof auditLog.$inferSelect;

// ============================================================================
// AI Document Inbox — receipts and invoices captured by the user, extracted
// by AI vision into structured data, then reviewed and posted as a journal
// entry. The original file is retained on disk for audit attachment.
// ============================================================================

// status: extracting | ready | posting | posted | error
export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storagePath: text("storage_path").notNull(),
    status: text("status").notNull().default("extracting"),
    extractedJson: jsonb("extracted_json"),
    suggestedJournalJson: jsonb("suggested_journal_json"),
    journalEntryId: integer("journal_entry_id"),
    errorMessage: text("error_message"),
    uploadedBy: varchar("uploaded_by"),
    uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
    extractedAt: timestamp("extracted_at"),
    postedAt: timestamp("posted_at"),
  },
  (t) => ({
    companyIdx: index("documents_company_idx").on(t.companyId),
    statusIdx: index("documents_status_idx").on(t.companyId, t.status),
    // Defense-in-depth: when a document is posted, the linked journal entry
    // must live in the same workspace. journalEntryId is nullable, so MATCH
    // SIMPLE skips the check for un-posted documents.
    journalEntryCompanyFk: foreignKey({
      columns: [t.journalEntryId, t.companyId],
      foreignColumns: [journalEntries.id, journalEntries.companyId],
      name: "documents_journal_entry_company_fk",
    }),
  }),
);

export type DocumentRow = typeof documents.$inferSelect;
export type InsertDocument = typeof documents.$inferInsert;

// Strict shape returned by the vision extractor. Frontend & assistant
// downstream both rely on this contract.
export const extractedDocumentSchema = z.object({
  vendor: z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  documentDate: z.string().nullable().optional(), // YYYY-MM-DD
  currency: z.string().nullable().optional(),
  subtotal: z.number().nullable().optional(),
  vatAmount: z.number().nullable().optional(),
  vatRate: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
  paymentMethod: z.enum(["cash", "card", "bank", "credit", "unknown"]).default("unknown"),
  category: z.string().nullable().optional(),
  documentType: z.enum(["receipt", "invoice", "credit_note", "other"]).default("receipt"),
  // "sales" → the workspace issued this to a customer; "purchase" → vendor
  // issued it to the workspace. Defaults to purchase since most uploaded
  // receipts are vendor-side.
  direction: z.enum(["sales", "purchase"]).default("purchase"),
  counterparty: z.string().nullable().optional(),
  // Smart Inbox officially supports four document languages plus a "mixed"
  // bucket for bilingual receipts (very common for GCC VAT invoices that
  // print Arabic and English side-by-side, or Swiss receipts that mix
  // German and French). See task #345.
  language: z.enum(["ar", "en", "de", "fr", "mixed"]).default("en"),
  lineItems: z
    .array(
      z.object({
        description: z.string(),
        quantity: z.number().nullable().optional(),
        unitPrice: z.number().nullable().optional(),
        total: z.number().nullable().optional(),
      }),
    )
    .default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  notes: z.string().nullable().optional(),
});
export type ExtractedDocument = z.infer<typeof extractedDocumentSchema>;

export const suggestedJournalSchema = z.object({
  description: z.string(),
  entryDate: z.string().optional(),
  lines: z.array(
    z.object({
      accountId: z.number().int(),
      accountCode: z.string(),
      accountName: z.string(),
      debit: z.number().default(0),
      credit: z.number().default(0),
      description: z.string().optional(),
    }),
  ),
  reasoning: z.string().optional(),
});
export type SuggestedJournal = z.infer<typeof suggestedJournalSchema>;

// Payload accepted from the client when confirming a document → journal
export const postDocumentSchema = z.object({
  description: z.string().min(1).max(300),
  entryDate: z.string().optional(),
  lines: z
    .array(
      z.object({
        accountId: z.number().int().positive(),
        debit: z.coerce.number().nonnegative().default(0),
        credit: z.coerce.number().nonnegative().default(0),
        description: z.string().max(300).optional(),
      }),
    )
    .min(2),
});
export type PostDocumentInput = z.infer<typeof postDocumentSchema>;

// ============================================================================
// Sales Portal — Customers, Products, Sales Invoices (task #301)
// ============================================================================
//
// Workspace isolation recipe (see docs/design/workspace-isolation-defense-in-depth.md):
//   - Every table carries `companyId NOT NULL` with no column default.
//   - Each parent declares `unique(id, company_id)` so child tables can
//     declare composite FKs that physically refuse cross-tenant writes.
//   - Children carry a denormalised `companyId` equal to the parent's, and
//     point both columns at the parent's composite unique.

export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    code: text("code").notNull(),                 // CUST-0001 — unique per workspace
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    taxNumber: text("tax_number").notNull().default(""),
    address: text("address").notNull().default(""),
    notes: text("notes").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    idCompanyUq: unique("customers_id_company_uq").on(t.id, t.companyId),
    codeCompanyUq: unique("customers_code_company_uq").on(t.companyId, t.code),
  }),
);
export const insertCustomerSchema = createInsertSchema(customers)
  .omit({ id: true, createdAt: true, companyId: true })
  .extend({
    code: z.string().trim().min(1, "كود العميل مطلوب").max(40),
    nameAr: z.string().trim().min(1, "اسم العميل مطلوب").max(160),
    nameEn: z.string().trim().max(160).default(""),
    email: z.string().trim().max(160).default(""),
    phone: z.string().trim().max(40).default(""),
    taxNumber: z.string().trim().max(40).default(""),
    address: z.string().trim().max(400).default(""),
    notes: z.string().trim().max(800).default(""),
    isActive: z.boolean().default(true),
  });
export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    sku: text("sku").notNull(),                   // SKU — unique per workspace
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull().default(""),
    description: text("description").notNull().default(""),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
    unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
    // VAT override: when null, the invoice line falls back to settings.vatRate.
    vatRate: numeric("vat_rate", { precision: 5, scale: 4 }),
    stockQty: numeric("stock_qty", { precision: 14, scale: 4 }).notNull().default("0"),
    // Service-style products (consulting, hours, fees) skip inventory accounting:
    // no COGS leg is posted and no stock decrement runs on invoice posting.
    isService: boolean("is_service").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    // -- Inventory portal (task #346) — added by migration 0023 -----------
    unit: text("unit").notNull().default("pcs"),
    minimumStock: numeric("minimum_stock", { precision: 14, scale: 4 }).notNull().default("0"),
    categoryId: integer("category_id"),                      // FK declared after inventory_categories below
    costingMethod: text("costing_method"),                   // null = use settings.defaultCostingMethod
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    idCompanyUq: unique("products_id_company_uq").on(t.id, t.companyId),
    skuCompanyUq: unique("products_sku_company_uq").on(t.companyId, t.sku),
  }),
);
export const insertProductSchema = createInsertSchema(products)
  .omit({ id: true, createdAt: true, companyId: true })
  .extend({
    sku: z.string().trim().min(1, "كود المنتج مطلوب").max(40),
    nameAr: z.string().trim().min(1, "اسم المنتج مطلوب").max(160),
    nameEn: z.string().trim().max(160).default(""),
    description: z.string().trim().max(400).default(""),
    unitPrice: z.coerce.number().nonnegative().default(0),
    unitCost: z.coerce.number().nonnegative().default(0),
    vatRate: z.coerce.number().min(0).max(0.99).optional().nullable(),
    stockQty: z.coerce.number().default(0),
    isService: z.boolean().default(false),
    isActive: z.boolean().default(true),
    unit: z.string().trim().min(1).max(16).default("pcs"),
    minimumStock: z.coerce.number().nonnegative().default(0),
    categoryId: z.coerce.number().int().positive().optional().nullable(),
    costingMethod: z.enum(["fifo", "avg"]).optional().nullable(),
  });
export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;

export const SALES_INVOICE_STATUSES = ["draft", "posted", "cancelled"] as const;
export type SalesInvoiceStatus = (typeof SALES_INVOICE_STATUSES)[number];

export const SALES_INVOICE_PAYMENT_METHODS = ["credit", "cash"] as const;
export type SalesInvoicePaymentMethod = (typeof SALES_INVOICE_PAYMENT_METHODS)[number];

export const salesInvoices = pgTable(
  "sales_invoices",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    number: text("number").notNull(),             // INV-0001 — unique per workspace
    customerId: integer("customer_id").notNull(),
    invoiceDate: text("invoice_date").notNull(),  // YYYY-MM-DD
    dueDate: text("due_date"),                    // YYYY-MM-DD, nullable
    status: text("status").notNull().default("draft"),                 // draft|posted|cancelled
    paymentMethod: text("payment_method").notNull().default("credit"), // credit|cash
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
    vatAmount: numeric("vat_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    cogsAmount: numeric("cogs_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    notes: text("notes").notNull().default(""),
    journalEntryId: integer("journal_entry_id"),  // set when status=posted
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    idCompanyUq: unique("sales_invoices_id_company_uq").on(t.id, t.companyId),
    numberCompanyUq: unique("sales_invoices_number_company_uq").on(t.companyId, t.number),
    customerCompanyFk: foreignKey({
      columns: [t.customerId, t.companyId],
      foreignColumns: [customers.id, customers.companyId],
      name: "sales_invoices_customer_company_fk",
    }),
    journalEntryCompanyFk: foreignKey({
      columns: [t.journalEntryId, t.companyId],
      foreignColumns: [journalEntries.id, journalEntries.companyId],
      name: "sales_invoices_journal_entry_company_fk",
    }),
    customerIdx: index("sales_invoices_customer_idx").on(t.companyId, t.customerId),
    statusIdx: index("sales_invoices_status_idx").on(t.companyId, t.status),
  }),
);
export const insertSalesInvoiceSchema = createInsertSchema(salesInvoices)
  .omit({
    id: true,
    createdAt: true,
    companyId: true,
    journalEntryId: true,
    subtotal: true,
    vatAmount: true,
    totalAmount: true,
    cogsAmount: true,
    paidAmount: true,
    number: true,
  })
  .extend({
    customerId: z.coerce.number().int().positive(),
    invoiceDate: z.string().min(1, "تاريخ الفاتورة مطلوب"),
    dueDate: z.string().optional().nullable(),
    status: z.enum(SALES_INVOICE_STATUSES).default("draft"),
    paymentMethod: z.enum(SALES_INVOICE_PAYMENT_METHODS).default("credit"),
    notes: z.string().max(800).default(""),
  });
export type SalesInvoice = typeof salesInvoices.$inferSelect;
export type InsertSalesInvoice = z.infer<typeof insertSalesInvoiceSchema>;

export const salesInvoiceLines = pgTable(
  "sales_invoice_lines",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    invoiceId: integer("invoice_id").notNull(),
    productId: integer("product_id"),             // nullable — supports free-form lines
    description: text("description").notNull().default(""),
    quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull().default("1"),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
    vatRate: numeric("vat_rate", { precision: 5, scale: 4 }).notNull().default("0"),
    lineSubtotal: numeric("line_subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
    lineVat: numeric("line_vat", { precision: 14, scale: 2 }).notNull().default("0"),
    lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull().default("0"),
    unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
    costAmount: numeric("cost_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  },
  (t) => ({
    invoiceCompanyFk: foreignKey({
      columns: [t.invoiceId, t.companyId],
      foreignColumns: [salesInvoices.id, salesInvoices.companyId],
      name: "sales_invoice_lines_invoice_company_fk",
    }),
    productCompanyFk: foreignKey({
      columns: [t.productId, t.companyId],
      foreignColumns: [products.id, products.companyId],
      name: "sales_invoice_lines_product_company_fk",
    }),
    invoiceIdx: index("sales_invoice_lines_invoice_idx").on(t.invoiceId),
  }),
);
export const insertSalesInvoiceLineSchema = createInsertSchema(salesInvoiceLines)
  .omit({
    id: true,
    companyId: true,
    invoiceId: true,
    lineSubtotal: true,
    lineVat: true,
    lineTotal: true,
    costAmount: true,
  })
  .extend({
    productId: z.coerce.number().int().positive().optional().nullable(),
    description: z.string().max(300).default(""),
    quantity: z.coerce.number().positive(),
    unitPrice: z.coerce.number().nonnegative(),
    vatRate: z.coerce.number().min(0).max(0.99).default(0),
    unitCost: z.coerce.number().nonnegative().default(0),
  });
export type SalesInvoiceLine = typeof salesInvoiceLines.$inferSelect;
export type InsertSalesInvoiceLine = z.infer<typeof insertSalesInvoiceLineSchema>;

// Composite create payload accepted by POST /api/sales/invoices.
export const createSalesInvoiceSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  invoiceDate: z.string().min(1),
  dueDate: z.string().optional().nullable(),
  status: z.enum(SALES_INVOICE_STATUSES).default("draft"),
  paymentMethod: z.enum(SALES_INVOICE_PAYMENT_METHODS).default("credit"),
  notes: z.string().max(800).default(""),
  lines: z
    .array(insertSalesInvoiceLineSchema)
    .min(1, "يجب إضافة بند واحد على الأقل"),
});
export type CreateSalesInvoiceInput = z.infer<typeof createSalesInvoiceSchema>;

// Update payload (mutates header + replaces lines). Status transitions are
// validated server-side: posted→draft is rejected; posted→cancelled flows
// through the dedicated reverse path.
export const updateSalesInvoiceSchema = createSalesInvoiceSchema.partial({
  customerId: true,
  invoiceDate: true,
  paymentMethod: true,
  lines: true,
});
export type UpdateSalesInvoiceInput = z.infer<typeof updateSalesInvoiceSchema>;

// API response shape for GET /api/sales/invoices/:id and POST/PATCH responses.
export type SalesInvoiceWithLines = SalesInvoice & {
  lines: SalesInvoiceLine[];
  customer?: Pick<Customer, "id" | "code" | "nameAr" | "nameEn"> | null;
  journalEntryReference?: string | null;
};

// ----- Customer Receipt Vouchers (سند قبض) — multi-invoice allocation -----
//
// AR mirror of `purchase_payments` + `purchase_payment_allocations`.
// A single `sales_payments` header (ARRCV-####) can settle several
// posted credit invoices for the same customer in one shot.
// Posting auto-builds a balanced Dr Cash / Cr AR journal entry and
// bumps each allocated invoice's `paidAmount` in lockstep.

export const SALES_PAYMENT_STATUSES = ["posted", "cancelled"] as const;
export type SalesPaymentStatus = (typeof SALES_PAYMENT_STATUSES)[number];

export const salesPayments = pgTable(
  "sales_payments",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    number: text("number").notNull(),             // ARRCV-0001 — unique per workspace
    customerId: integer("customer_id").notNull(),
    paymentDate: text("payment_date").notNull(),  // YYYY-MM-DD
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
    notes: text("notes").notNull().default(""),
    status: text("status").notNull().default("posted"),    // posted|cancelled
    journalEntryId: integer("journal_entry_id"),  // set on post
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    idCompanyUq: unique("sales_payments_id_company_uq").on(t.id, t.companyId),
    numberCompanyUq: unique("sales_payments_number_company_uq").on(t.companyId, t.number),
    customerCompanyFk: foreignKey({
      columns: [t.customerId, t.companyId],
      foreignColumns: [customers.id, customers.companyId],
      name: "sales_payments_customer_company_fk",
    }),
    journalEntryCompanyFk: foreignKey({
      columns: [t.journalEntryId, t.companyId],
      foreignColumns: [journalEntries.id, journalEntries.companyId],
      name: "sales_payments_journal_entry_company_fk",
    }),
    customerIdx: index("sales_payments_customer_idx").on(t.companyId, t.customerId),
  }),
);
export type SalesPayment = typeof salesPayments.$inferSelect;

export const salesPaymentAllocations = pgTable(
  "sales_payment_allocations",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    paymentId: integer("payment_id").notNull(),
    invoiceId: integer("invoice_id").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  },
  (t) => ({
    paymentCompanyFk: foreignKey({
      columns: [t.paymentId, t.companyId],
      foreignColumns: [salesPayments.id, salesPayments.companyId],
      name: "sales_payment_allocations_payment_company_fk",
    }),
    invoiceCompanyFk: foreignKey({
      columns: [t.invoiceId, t.companyId],
      foreignColumns: [salesInvoices.id, salesInvoices.companyId],
      name: "sales_payment_allocations_invoice_company_fk",
    }),
    paymentIdx: index("sales_payment_allocations_payment_idx").on(t.paymentId),
    invoiceIdx: index("sales_payment_allocations_invoice_idx").on(t.invoiceId),
  }),
);
export type SalesPaymentAllocation = typeof salesPaymentAllocations.$inferSelect;

export const createSalesPaymentAllocationSchema = z.object({
  invoiceId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
});

export const createSalesPaymentSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  paymentDate: z.string().min(1),
  notes: z.string().max(400).default(""),
  allocations: z.array(createSalesPaymentAllocationSchema).min(1, "يجب تحديد فاتورة واحدة على الأقل"),
});
export type CreateSalesPaymentInput = z.infer<typeof createSalesPaymentSchema>;

export type SalesPaymentWithAllocations = SalesPayment & {
  allocations: SalesPaymentAllocation[];
  customer?: Pick<Customer, "id" | "code" | "nameAr" | "nameEn"> | null;
  journalEntryReference?: string | null;
};

// ============================================================================
// Purchase Portal — task #368
//
// Mirrors the Sales Portal end-to-end: vendors (VEND-####), purchase
// invoices a.k.a. bills (BILL-####), and AP payments (APPAY-####). Same
// composite-FK / RLS / audit recipe as `customers` and `sales_invoices` so
// the cross-tenant guarantees apply uniformly.
//
// Lifecycle: bills move draft → posted → cancelled (no edits past `posted`,
// the cancel path reverses the auto-posted JE through the same
// `reverseAutoPostedJournalEntry` helper every other auto-posting source
// uses). Posted credit bills credit AP (2110); cash bills credit Cash
// (1110); inventory lines debit Inventory (1300); service lines debit a
// purchases-driven expense account; and a non-zero VAT amount debits
// VAT-Recoverable (1230).
//
// Multi-bill payment allocation: a single `purchase_payments` header may
// settle several bills via `purchase_payment_allocations`. Each
// allocation increments the matching bill's `paid_amount`. Cancelling /
// deleting a payment reverses every allocation in lockstep.
// ============================================================================

export const vendors = pgTable(
  "vendors",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    code: text("code").notNull(),                 // VEND-0001 — unique per workspace
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    taxNumber: text("tax_number").notNull().default(""),
    address: text("address").notNull().default(""),
    notes: text("notes").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    idCompanyUq: unique("vendors_id_company_uq").on(t.id, t.companyId),
    codeCompanyUq: unique("vendors_code_company_uq").on(t.companyId, t.code),
  }),
);
export const insertVendorSchema = createInsertSchema(vendors)
  .omit({ id: true, createdAt: true, companyId: true })
  .extend({
    code: z.string().trim().min(1, "كود المورد مطلوب").max(40),
    nameAr: z.string().trim().min(1, "اسم المورد مطلوب").max(160),
    nameEn: z.string().trim().max(160).default(""),
    email: z.string().trim().max(160).default(""),
    phone: z.string().trim().max(40).default(""),
    taxNumber: z.string().trim().max(40).default(""),
    address: z.string().trim().max(400).default(""),
    notes: z.string().trim().max(800).default(""),
    isActive: z.boolean().default(true),
  });
export type Vendor = typeof vendors.$inferSelect;
export type InsertVendor = z.infer<typeof insertVendorSchema>;

export const PURCHASE_INVOICE_STATUSES = ["draft", "posted", "cancelled"] as const;
export type PurchaseInvoiceStatus = (typeof PURCHASE_INVOICE_STATUSES)[number];

export const PURCHASE_INVOICE_PAYMENT_METHODS = ["credit", "cash"] as const;
export type PurchaseInvoicePaymentMethod = (typeof PURCHASE_INVOICE_PAYMENT_METHODS)[number];

export const purchaseInvoices = pgTable(
  "purchase_invoices",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    number: text("number").notNull(),             // BILL-0001 — unique per workspace
    vendorId: integer("vendor_id").notNull(),
    invoiceDate: text("invoice_date").notNull(),  // YYYY-MM-DD — bill date
    dueDate: text("due_date"),                    // YYYY-MM-DD, nullable
    status: text("status").notNull().default("draft"),                 // draft|posted|cancelled
    paymentMethod: text("payment_method").notNull().default("credit"), // credit|cash
    // Optional reference number on the supplier's paper bill (their invoice
    // number). Useful when reconciling against the vendor statement.
    vendorReference: text("vendor_reference").notNull().default(""),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
    vatAmount: numeric("vat_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    notes: text("notes").notNull().default(""),
    journalEntryId: integer("journal_entry_id"),  // set when status=posted
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    idCompanyUq: unique("purchase_invoices_id_company_uq").on(t.id, t.companyId),
    numberCompanyUq: unique("purchase_invoices_number_company_uq").on(t.companyId, t.number),
    vendorCompanyFk: foreignKey({
      columns: [t.vendorId, t.companyId],
      foreignColumns: [vendors.id, vendors.companyId],
      name: "purchase_invoices_vendor_company_fk",
    }),
    journalEntryCompanyFk: foreignKey({
      columns: [t.journalEntryId, t.companyId],
      foreignColumns: [journalEntries.id, journalEntries.companyId],
      name: "purchase_invoices_journal_entry_company_fk",
    }),
    vendorIdx: index("purchase_invoices_vendor_idx").on(t.companyId, t.vendorId),
    statusIdx: index("purchase_invoices_status_idx").on(t.companyId, t.status),
  }),
);
export type PurchaseInvoice = typeof purchaseInvoices.$inferSelect;

export const purchaseInvoiceLines = pgTable(
  "purchase_invoice_lines",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    invoiceId: integer("invoice_id").notNull(),
    productId: integer("product_id"),             // nullable — supports free-form / service lines
    description: text("description").notNull().default(""),
    quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull().default("1"),
    unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
    vatRate: numeric("vat_rate", { precision: 5, scale: 4 }).notNull().default("0"),
    lineSubtotal: numeric("line_subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
    lineVat: numeric("line_vat", { precision: 14, scale: 2 }).notNull().default("0"),
    lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull().default("0"),
    // Service / expense lines bypass the inventory engine and post to a
    // purchases-driven expense account (e.g. 6210 utilities, 6310 rent).
    // The auto-posting layer in `server/purchases.ts` derives the code
    // from the line description via `pickExpenseAccountCode` when this is
    // empty; an explicit code here wins.
    expenseAccountCode: text("expense_account_code").notNull().default(""),
  },
  (t) => ({
    invoiceCompanyFk: foreignKey({
      columns: [t.invoiceId, t.companyId],
      foreignColumns: [purchaseInvoices.id, purchaseInvoices.companyId],
      name: "purchase_invoice_lines_invoice_company_fk",
    }),
    productCompanyFk: foreignKey({
      columns: [t.productId, t.companyId],
      foreignColumns: [products.id, products.companyId],
      name: "purchase_invoice_lines_product_company_fk",
    }),
    invoiceIdx: index("purchase_invoice_lines_invoice_idx").on(t.invoiceId),
  }),
);
export const insertPurchaseInvoiceLineSchema = createInsertSchema(purchaseInvoiceLines)
  .omit({
    id: true,
    companyId: true,
    invoiceId: true,
    lineSubtotal: true,
    lineVat: true,
    lineTotal: true,
  })
  .extend({
    productId: z.coerce.number().int().positive().optional().nullable(),
    description: z.string().max(300).default(""),
    quantity: z.coerce.number().positive(),
    unitCost: z.coerce.number().nonnegative(),
    vatRate: z.coerce.number().min(0).max(0.99).default(0),
    expenseAccountCode: z.string().trim().max(20).default(""),
  });
export type PurchaseInvoiceLine = typeof purchaseInvoiceLines.$inferSelect;
export type InsertPurchaseInvoiceLine = z.infer<typeof insertPurchaseInvoiceLineSchema>;

// Composite create payload accepted by POST /api/purchases/bills.
export const createPurchaseInvoiceSchema = z.object({
  vendorId: z.coerce.number().int().positive(),
  invoiceDate: z.string().min(1),
  dueDate: z.string().optional().nullable(),
  status: z.enum(PURCHASE_INVOICE_STATUSES).default("draft"),
  paymentMethod: z.enum(PURCHASE_INVOICE_PAYMENT_METHODS).default("credit"),
  vendorReference: z.string().max(80).default(""),
  notes: z.string().max(800).default(""),
  // For credit bills the inventory lines need a target location to inbound
  // into — defaults to the workspace's first active location server-side.
  locationId: z.coerce.number().int().positive().optional().nullable(),
  lines: z
    .array(insertPurchaseInvoiceLineSchema)
    .min(1, "يجب إضافة بند واحد على الأقل"),
});
export type CreatePurchaseInvoiceInput = z.infer<typeof createPurchaseInvoiceSchema>;

// Update payload (mutates header + replaces lines). Same lifecycle rules
// as sales: posted bills are read-only; status `cancelled` flows through
// the dedicated reverse path.
export const updatePurchaseInvoiceSchema = createPurchaseInvoiceSchema.partial({
  vendorId: true,
  invoiceDate: true,
  paymentMethod: true,
  lines: true,
});
export type UpdatePurchaseInvoiceInput = z.infer<typeof updatePurchaseInvoiceSchema>;

export type PurchaseInvoiceWithLines = PurchaseInvoice & {
  lines: PurchaseInvoiceLine[];
  vendor?: Pick<Vendor, "id" | "code" | "nameAr" | "nameEn"> | null;
  journalEntryReference?: string | null;
};

// ----- Purchase payments (multi-bill allocation) -----

export const PURCHASE_PAYMENT_STATUSES = ["posted", "cancelled"] as const;
export type PurchasePaymentStatus = (typeof PURCHASE_PAYMENT_STATUSES)[number];

export const purchasePayments = pgTable(
  "purchase_payments",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    number: text("number").notNull(),             // APPAY-0001 — unique per workspace
    vendorId: integer("vendor_id").notNull(),
    paymentDate: text("payment_date").notNull(),  // YYYY-MM-DD
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
    notes: text("notes").notNull().default(""),
    status: text("status").notNull().default("posted"),    // posted|cancelled
    journalEntryId: integer("journal_entry_id"),  // set on post
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    idCompanyUq: unique("purchase_payments_id_company_uq").on(t.id, t.companyId),
    numberCompanyUq: unique("purchase_payments_number_company_uq").on(t.companyId, t.number),
    vendorCompanyFk: foreignKey({
      columns: [t.vendorId, t.companyId],
      foreignColumns: [vendors.id, vendors.companyId],
      name: "purchase_payments_vendor_company_fk",
    }),
    journalEntryCompanyFk: foreignKey({
      columns: [t.journalEntryId, t.companyId],
      foreignColumns: [journalEntries.id, journalEntries.companyId],
      name: "purchase_payments_journal_entry_company_fk",
    }),
    vendorIdx: index("purchase_payments_vendor_idx").on(t.companyId, t.vendorId),
  }),
);
export type PurchasePayment = typeof purchasePayments.$inferSelect;

export const purchasePaymentAllocations = pgTable(
  "purchase_payment_allocations",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    paymentId: integer("payment_id").notNull(),
    invoiceId: integer("invoice_id").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  },
  (t) => ({
    paymentCompanyFk: foreignKey({
      columns: [t.paymentId, t.companyId],
      foreignColumns: [purchasePayments.id, purchasePayments.companyId],
      name: "purchase_payment_allocations_payment_company_fk",
    }),
    invoiceCompanyFk: foreignKey({
      columns: [t.invoiceId, t.companyId],
      foreignColumns: [purchaseInvoices.id, purchaseInvoices.companyId],
      name: "purchase_payment_allocations_invoice_company_fk",
    }),
    paymentIdx: index("purchase_payment_allocations_payment_idx").on(t.paymentId),
    invoiceIdx: index("purchase_payment_allocations_invoice_idx").on(t.invoiceId),
  }),
);
export type PurchasePaymentAllocation = typeof purchasePaymentAllocations.$inferSelect;

export const createPurchasePaymentAllocationSchema = z.object({
  invoiceId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
});

export const createPurchasePaymentSchema = z.object({
  vendorId: z.coerce.number().int().positive(),
  paymentDate: z.string().min(1),
  notes: z.string().max(400).default(""),
  allocations: z.array(createPurchasePaymentAllocationSchema).min(1, "يجب تحديد فاتورة واحدة على الأقل"),
});
export type CreatePurchasePaymentInput = z.infer<typeof createPurchasePaymentSchema>;

export type PurchasePaymentWithAllocations = PurchasePayment & {
  allocations: PurchasePaymentAllocation[];
  vendor?: Pick<Vendor, "id" | "code" | "nameAr" | "nameEn"> | null;
  journalEntryReference?: string | null;
};

// AP aging report — drilled-down per posted credit bill, then bucketed
// by days-past-due of the open balance. Buckets follow the standard
// 0/1-30/31-60/61-90/90+ presentation accountants expect.
export interface ApAgingRow {
  invoiceId: number;
  invoiceNumber: string;
  vendorId: number;
  vendorCode: string;
  vendorName: string;
  invoiceDate: string;
  dueDate: string | null;
  daysOverdue: number;
  totalAmount: number;
  paidAmount: number;
  openAmount: number;
  bucket: "current" | "1_30" | "31_60" | "61_90" | "over_90";
}

export interface ApAgingReport {
  asOfDate: string;
  rows: ApAgingRow[];
  totals: {
    current: number;
    bucket1_30: number;
    bucket31_60: number;
    bucket61_90: number;
    over90: number;
    total: number;
  };
}

// ============================================================================
// Inventory & Costing Portal — task #346
// ============================================================================
//
// Extends the flat products table with rich item master + per-(item, location)
// stock tracking + a FIFO/Weighted-Average costing engine. The four pre-existing
// product columns (sku, nameAr, nameEn, description, unitPrice, unitCost,
// vatRate, stockQty, isService, isActive) keep their meaning; the additions
// below are append-only:
//   - `unit`              — UoM display label ("pcs", "kg", "hr", …)
//   - `minimumStock`      — re-order threshold the Stock Alerts panel checks
//   - `categoryId`        — FK to inventory_categories (nullable: existing rows
//                           start uncategorised)
//   - `costingMethod`     — per-item override of settings.defaultCostingMethod
//                           ("fifo" | "avg" | null=use workspace default)
//
// The same workspace-isolation recipe used by Sales / Fixed Assets applies:
// every table carries a NOT-NULL companyId with no column default, every
// parent declares unique(id, company_id), every child uses composite FKs.
// New table names are appended to RLS_TABLES so the boot helper installs the
// canonical workspace_isolation policy.

export const INVENTORY_COSTING_METHODS = ["fifo", "avg"] as const;
export type InventoryCostingMethod = (typeof INVENTORY_COSTING_METHODS)[number];

// ---- inventory_categories --------------------------------------------------

export const inventoryCategories = pgTable(
  "inventory_categories",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull().default(""),
    // Optional CoA overrides — when set, items in this category use these
    // accounts instead of the workspace defaults (4100 Sales / 5100 COGS).
    defaultIncomeAccountId: integer("default_income_account_id"),
    defaultCogsAccountId: integer("default_cogs_account_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    idCompanyUq: unique("inventory_categories_id_company_uq").on(t.id, t.companyId),
    nameCompanyUq: unique("inventory_categories_name_company_uq").on(t.companyId, t.nameAr),
    incomeAccountFk: foreignKey({
      columns: [t.defaultIncomeAccountId, t.companyId],
      foreignColumns: [accounts.id, accounts.companyId],
      name: "inventory_categories_income_account_company_fk",
    }),
    cogsAccountFk: foreignKey({
      columns: [t.defaultCogsAccountId, t.companyId],
      foreignColumns: [accounts.id, accounts.companyId],
      name: "inventory_categories_cogs_account_company_fk",
    }),
  }),
);
export const insertInventoryCategorySchema = createInsertSchema(inventoryCategories)
  .omit({ id: true, createdAt: true, companyId: true })
  .extend({
    nameAr: z.string().trim().min(1, "اسم التصنيف مطلوب").max(120),
    nameEn: z.string().trim().max(120).default(""),
    defaultIncomeAccountId: z.coerce.number().int().positive().optional().nullable(),
    defaultCogsAccountId: z.coerce.number().int().positive().optional().nullable(),
    isActive: z.boolean().default(true),
  });
export type InventoryCategory = typeof inventoryCategories.$inferSelect;
export type InsertInventoryCategory = z.infer<typeof insertInventoryCategorySchema>;

// ---- inventory_locations ---------------------------------------------------

export const inventoryLocations = pgTable(
  "inventory_locations",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull().default(""),
    address: text("address").notNull().default(""),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    idCompanyUq: unique("inventory_locations_id_company_uq").on(t.id, t.companyId),
    nameCompanyUq: unique("inventory_locations_name_company_uq").on(t.companyId, t.nameAr),
  }),
);
export const insertInventoryLocationSchema = createInsertSchema(inventoryLocations)
  .omit({ id: true, createdAt: true, companyId: true, isDefault: true })
  .extend({
    nameAr: z.string().trim().min(1, "اسم الموقع مطلوب").max(120),
    nameEn: z.string().trim().max(120).default(""),
    address: z.string().trim().max(400).default(""),
    isActive: z.boolean().default(true),
  });
export type InventoryLocation = typeof inventoryLocations.$inferSelect;
export type InsertInventoryLocation = z.infer<typeof insertInventoryLocationSchema>;

// ---- inventory_stock_levels ------------------------------------------------
// Canonical (qty, avgCost) per (product, location). Maintained for both
// FIFO and WAvg items. For FIFO items, avgCost is a snapshot derived from
// the layer queue (`sum(remainingQty * unitCost) / sum(remainingQty)`) so
// the valuation report doesn't have to re-aggregate layers per row. The
// authoritative cost source for FIFO outbound is `inventory_cost_layers`.

export const inventoryStockLevels = pgTable(
  "inventory_stock_levels",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    productId: integer("product_id").notNull(),
    locationId: integer("location_id").notNull(),
    qty: numeric("qty", { precision: 18, scale: 4 }).notNull().default("0"),
    avgCost: numeric("avg_cost", { precision: 14, scale: 4 }).notNull().default("0"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    pairUq: unique("inventory_stock_levels_pair_uq").on(
      t.companyId, t.productId, t.locationId,
    ),
    productCompanyFk: foreignKey({
      columns: [t.productId, t.companyId],
      foreignColumns: [products.id, products.companyId],
      name: "inventory_stock_levels_product_company_fk",
    }),
    locationCompanyFk: foreignKey({
      columns: [t.locationId, t.companyId],
      foreignColumns: [inventoryLocations.id, inventoryLocations.companyId],
      name: "inventory_stock_levels_location_company_fk",
    }),
    productIdx: index("inventory_stock_levels_product_idx").on(t.companyId, t.productId),
  }),
);
export type InventoryStockLevel = typeof inventoryStockLevels.$inferSelect;

// ---- inventory_transactions ------------------------------------------------

export const INVENTORY_TXN_TYPES = ["purchase", "sale", "adjustment", "transfer"] as const;
export type InventoryTxnType = (typeof INVENTORY_TXN_TYPES)[number];

export const INVENTORY_TXN_STATUSES = ["posted", "reversed"] as const;
export type InventoryTxnStatus = (typeof INVENTORY_TXN_STATUSES)[number];

export const ADJUSTMENT_REASONS = ["shrinkage", "count", "writeoff", "other"] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const inventoryTransactions = pgTable(
  "inventory_transactions",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    number: text("number").notNull(),                     // TXN-PUR-0001, TXN-ADJ-0001, …
    type: text("type").notNull(),                         // purchase|sale|adjustment|transfer
    txnDate: text("txn_date").notNull(),                  // YYYY-MM-DD
    locationId: integer("location_id"),                   // src location for purchase/sale/adjustment/transfer
    destLocationId: integer("dest_location_id"),          // transfer destination
    reference: text("reference").notNull().default(""),   // user-supplied ref (PO #, vendor invoice #)
    vendorName: text("vendor_name").notNull().default(""),// purchase only — free-text (no vendor master)
    reason: text("reason").notNull().default(""),         // adjustment only
    notes: text("notes").notNull().default(""),
    status: text("status").notNull().default("posted"),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    journalEntryId: integer("journal_entry_id"),
    sourceInvoiceId: integer("source_invoice_id"),        // sale: links to sales_invoices.id
    // purchase: links to purchase_invoices.id (task #368). Lets the
    // bill-cancel flow find the inbound it originally created so it can
    // walk it back via `reversePurchaseInbound` without re-deriving from
    // the bill lines (which may have been edited in a re-post cycle).
    sourcePurchaseInvoiceId: integer("source_purchase_invoice_id"),
    reversalOfId: integer("reversal_of_id"),              // self-FK: a 'reversed' txn points at the original
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    idCompanyUq: unique("inventory_transactions_id_company_uq").on(t.id, t.companyId),
    numberCompanyUq: unique("inventory_transactions_number_company_uq").on(t.companyId, t.number),
    locationFk: foreignKey({
      columns: [t.locationId, t.companyId],
      foreignColumns: [inventoryLocations.id, inventoryLocations.companyId],
      name: "inventory_transactions_location_company_fk",
    }),
    destLocationFk: foreignKey({
      columns: [t.destLocationId, t.companyId],
      foreignColumns: [inventoryLocations.id, inventoryLocations.companyId],
      name: "inventory_transactions_dest_location_company_fk",
    }),
    journalEntryFk: foreignKey({
      columns: [t.journalEntryId, t.companyId],
      foreignColumns: [journalEntries.id, journalEntries.companyId],
      name: "inventory_transactions_journal_entry_company_fk",
    }),
    sourceInvoiceFk: foreignKey({
      columns: [t.sourceInvoiceId, t.companyId],
      foreignColumns: [salesInvoices.id, salesInvoices.companyId],
      name: "inventory_transactions_source_invoice_company_fk",
    }),
    sourcePurchaseInvoiceFk: foreignKey({
      columns: [t.sourcePurchaseInvoiceId, t.companyId],
      foreignColumns: [purchaseInvoices.id, purchaseInvoices.companyId],
      name: "inventory_transactions_source_purchase_invoice_company_fk",
    }),
    reversalFk: foreignKey({
      columns: [t.reversalOfId, t.companyId],
      foreignColumns: [t.id, t.companyId],
      name: "inventory_transactions_reversal_company_fk",
    }),
    typeIdx: index("inventory_transactions_type_idx").on(t.companyId, t.type, t.txnDate),
    dateIdx: index("inventory_transactions_date_idx").on(t.companyId, t.txnDate),
  }),
);
export type InventoryTransaction = typeof inventoryTransactions.$inferSelect;

export const inventoryTransactionLines = pgTable(
  "inventory_transaction_lines",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    transactionId: integer("transaction_id").notNull(),
    productId: integer("product_id").notNull(),
    description: text("description").notNull().default(""),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),  // signed: +inbound, -outbound (adjustment may be either)
    unitCost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull().default("0"),
    costAmount: numeric("cost_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  },
  (t) => ({
    transactionFk: foreignKey({
      columns: [t.transactionId, t.companyId],
      foreignColumns: [inventoryTransactions.id, inventoryTransactions.companyId],
      name: "inventory_transaction_lines_txn_company_fk",
    }),
    productFk: foreignKey({
      columns: [t.productId, t.companyId],
      foreignColumns: [products.id, products.companyId],
      name: "inventory_transaction_lines_product_company_fk",
    }),
    transactionIdx: index("inventory_transaction_lines_txn_idx").on(t.transactionId),
  }),
);
export type InventoryTransactionLine = typeof inventoryTransactionLines.$inferSelect;

// ---- inventory_cost_layers -------------------------------------------------
// FIFO layer queue per (product, location). Inbound creates a layer with
// originalQty == remainingQty; outbound walks oldest-first (createdAt ASC,
// id ASC) and decrements remainingQty. WAvg items don't create layers —
// their cost lives in inventory_stock_levels.avgCost only.

export const inventoryCostLayers = pgTable(
  "inventory_cost_layers",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    productId: integer("product_id").notNull(),
    locationId: integer("location_id").notNull(),
    originalQty: numeric("original_qty", { precision: 18, scale: 4 }).notNull(),
    remainingQty: numeric("remaining_qty", { precision: 18, scale: 4 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull(),
    sourceTransactionId: integer("source_transaction_id"),
    sourceTransactionLineId: integer("source_transaction_line_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    productCompanyFk: foreignKey({
      columns: [t.productId, t.companyId],
      foreignColumns: [products.id, products.companyId],
      name: "inventory_cost_layers_product_company_fk",
    }),
    locationCompanyFk: foreignKey({
      columns: [t.locationId, t.companyId],
      foreignColumns: [inventoryLocations.id, inventoryLocations.companyId],
      name: "inventory_cost_layers_location_company_fk",
    }),
    sourceTxnFk: foreignKey({
      columns: [t.sourceTransactionId, t.companyId],
      foreignColumns: [inventoryTransactions.id, inventoryTransactions.companyId],
      name: "inventory_cost_layers_source_txn_company_fk",
    }),
    queueIdx: index("inventory_cost_layers_queue_idx").on(
      t.companyId, t.productId, t.locationId, t.createdAt, t.id,
    ),
  }),
);
export type InventoryCostLayer = typeof inventoryCostLayers.$inferSelect;

// ---- Composite create payloads --------------------------------------------

const inventoryTxnLineInputSchema = z.object({
  productId: z.coerce.number().int().positive(),
  description: z.string().max(300).default(""),
  quantity: z.coerce.number(),         // signed for adjustment; positive for purchase/sale/transfer
  unitCost: z.coerce.number().nonnegative().default(0),
});

export const createInventoryPurchaseSchema = z.object({
  txnDate: z.string().min(1, "التاريخ مطلوب"),
  locationId: z.coerce.number().int().positive(),
  reference: z.string().max(60).default(""),
  vendorName: z.string().max(160).default(""),
  notes: z.string().max(800).default(""),
  paymentMethod: z.enum(["cash", "credit"]).default("credit"),
  lines: z.array(z.object({
    productId: z.coerce.number().int().positive(),
    description: z.string().max(300).default(""),
    quantity: z.coerce.number().positive(),
    unitCost: z.coerce.number().nonnegative(),
  })).min(1, "أضف بنداً واحداً على الأقل"),
});
export type CreateInventoryPurchaseInput = z.infer<typeof createInventoryPurchaseSchema>;

export const createInventoryAdjustmentSchema = z.object({
  txnDate: z.string().min(1),
  locationId: z.coerce.number().int().positive(),
  reason: z.enum(ADJUSTMENT_REASONS).default("other"),
  notes: z.string().max(800).default(""),
  lines: z.array(z.object({
    productId: z.coerce.number().int().positive(),
    description: z.string().max(300).default(""),
    quantity: z.coerce.number().refine((v) => v !== 0, "الكمية لا يمكن أن تكون صفراً"),
    unitCost: z.coerce.number().nonnegative().default(0),  // ignored for negative lines (uses costing engine)
  })).min(1),
});
export type CreateInventoryAdjustmentInput = z.infer<typeof createInventoryAdjustmentSchema>;

export const createInventoryTransferSchema = z.object({
  txnDate: z.string().min(1),
  locationId: z.coerce.number().int().positive(),         // source
  destLocationId: z.coerce.number().int().positive(),     // destination
  notes: z.string().max(800).default(""),
  lines: z.array(z.object({
    productId: z.coerce.number().int().positive(),
    description: z.string().max(300).default(""),
    quantity: z.coerce.number().positive(),
  })).min(1),
}).refine((v) => v.locationId !== v.destLocationId, {
  message: "يجب اختيار موقعين مختلفين",
  path: ["destLocationId"],
});
export type CreateInventoryTransferInput = z.infer<typeof createInventoryTransferSchema>;

// API hydrated views ---------------------------------------------------------

export type InventoryTransactionWithLines = InventoryTransaction & {
  lines: InventoryTransactionLine[];
  location?: { id: number; nameAr: string; nameEn: string } | null;
  destLocation?: { id: number; nameAr: string; nameEn: string } | null;
  journalEntryReference?: string | null;
};

export type StockLevelWithProduct = InventoryStockLevel & {
  product: Pick<Product, "id" | "sku" | "nameAr" | "nameEn" | "unitCost" | "isService"> & {
    unit?: string;
    minimumStock?: string;
    categoryId?: number | null;
    costingMethod?: string | null;
  };
  location: Pick<InventoryLocation, "id" | "nameAr" | "nameEn">;
};

export type StockMovement = {
  id: number;
  txnId: number;
  txnNumber: string;
  txnType: InventoryTxnType;
  txnDate: string;
  locationId: number | null;
  locationName: string | null;
  destLocationId: number | null;
  destLocationName: string | null;
  quantity: string;
  unitCost: string;
  costAmount: string;
  runningBalance: string;
  journalEntryId: number | null;
  journalEntryReference: string | null;
  sourceInvoiceId: number | null;
  reference: string;
  status: InventoryTxnStatus;
};

export type InventoryStockAlert = {
  productId: number;
  sku: string;
  nameAr: string;
  nameEn: string;
  unit: string;
  minimumStock: string;
  totalQty: string;
};

export type InventoryValuationRow = {
  productId: number;
  sku: string;
  nameAr: string;
  nameEn: string;
  unit: string;
  categoryId: number | null;
  categoryNameAr: string | null;
  categoryNameEn: string | null;
  qty: string;
  avgCost: string;
  totalValue: string;
};

// ============================================================================
// Banking Simulation (مزامنة البنك)
// ============================================================================

export const BANK_ACCOUNT_TYPES = ["checking", "savings", "credit"] as const;
export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number];

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    bankName: text("bank_name").notNull(),
    iban: text("iban"),
    accountType: text("account_type").$type<BankAccountType>().notNull().default("checking"),
    currency: text("currency").notNull().default("SAR"),
    openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }).notNull().default("0"),
    linkedAccountId: integer("linked_account_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    idCompanyUq: unique("bank_accounts_id_company_uq").on(t.id, t.companyId),
  }),
);

export const insertBankAccountSchema = createInsertSchema(bankAccounts).omit({
  id: true,
  createdAt: true,
  companyId: true,
});
export type BankAccount = typeof bankAccounts.$inferSelect;
export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;

export const BANK_TXN_TYPES = ["deposit", "withdrawal", "transfer", "fee"] as const;
export type BankTxnType = (typeof BANK_TXN_TYPES)[number];

export const bankTransactions = pgTable(
  "bank_transactions",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    bankAccountId: integer("bank_account_id").notNull(),
    reference: text("reference").notNull(),
    txnType: text("txn_type").$type<BankTxnType>().notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    description: text("description").notNull(),
    counterpartBankAccountId: integer("counterpart_bank_account_id"),
    counterpartAccountId: integer("counterpart_account_id"),
    txnDate: timestamp("txn_date").notNull().defaultNow(),
    journalEntryId: integer("journal_entry_id"),
    status: text("status").notNull().default("posted"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    idCompanyUq: unique("bank_transactions_id_company_uq").on(t.id, t.companyId),
    accountCompanyFk: foreignKey({
      columns: [t.bankAccountId, t.companyId],
      foreignColumns: [bankAccounts.id, bankAccounts.companyId],
      name: "bank_txn_account_company_fk",
    }),
  }),
);

export const insertBankTransactionSchema = createInsertSchema(bankTransactions).omit({
  id: true,
  createdAt: true,
  companyId: true,
  reference: true,
  journalEntryId: true,
  status: true,
});
export type BankTransaction = typeof bankTransactions.$inferSelect;
export type InsertBankTransaction = z.infer<typeof insertBankTransactionSchema>;

export type BankTransactionWithAccount = BankTransaction & {
  bankAccount?: Pick<BankAccount, "id" | "nameAr" | "nameEn" | "bankName" | "currency"> | null;
  counterpartBankAccount?: Pick<BankAccount, "id" | "nameAr" | "nameEn"> | null;
  journalEntryReference?: string | null;
};

// ============================================================================
// ZATCA E-invoicing Configuration (الفوترة الإلكترونية)
// ============================================================================

export const zatcaConfigs = pgTable(
  "zatca_configs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    vatNumber: text("vat_number").notNull(),
    sellerNameAr: text("seller_name_ar").notNull(),
    sellerNameEn: text("seller_name_en").notNull(),
    cityAr: text("city_ar").notNull().default("الرياض"),
    cityEn: text("city_en").notNull().default("Riyadh"),
    environment: text("environment").notNull().default("sandbox"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    companyUq: unique("zatca_configs_company_uq").on(t.companyId),
  }),
);

export const insertZatcaConfigSchema = createInsertSchema(zatcaConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  companyId: true,
});
export type ZatcaConfig = typeof zatcaConfigs.$inferSelect;
export type InsertZatcaConfig = z.infer<typeof insertZatcaConfigSchema>;
