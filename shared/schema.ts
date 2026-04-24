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
    companyId: integer("company_id").notNull().default(1),
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
  companyId: integer("company_id").notNull().default(1),
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
  companyId: integer("company_id").notNull().default(1),
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

// ============================================================================
// Budgets (per-account monthly budgets for Budget vs Actual)
// ============================================================================

export const budgets = pgTable(
  "budgets",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().default(1),
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
  companyId: integer("company_id").notNull().default(1),
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

export const employees = pgTable(
  "employees",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().default(1),
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
    companyId: integer("company_id").notNull().default(1),
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
    companyId: integer("company_id").notNull().default(1),
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
    companyId: integer("company_id").notNull().default(1),
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
  companyId: integer("company_id").notNull().default(1),
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
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
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
  language: z.enum(["ar", "en", "mixed"]).default("ar"),
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
