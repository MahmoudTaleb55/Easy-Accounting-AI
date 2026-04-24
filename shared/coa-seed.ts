// Default Chart of Accounts (شجرة الحسابات).
//
// The base tree below mirrors the customer-supplied workbook
// "شجرة الحسابات - شركة محمد حجاج". The IFRS-required extras the rest
// of the app depends on (per-class accumulated depreciation, accumulated
// impairment, OCI revaluation surplus, gain/loss on disposal, payroll
// liabilities, etc.) are appended via PAYROLL_EXTRA_ACCOUNTS and
// FIXED_ASSETS_EXTRA_ACCOUNTS using codes that fit the same numbering
// scheme so they slot under the right header without overlapping.

export interface SeedAccount {
  code: string;
  nameAr: string;
  nameEn: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  subtype: string;
  isHeader?: boolean;
  parentCode?: string;
}

export const DEFAULT_COA: SeedAccount[] = [
  // ============================================================
  // ASSETS — الأصول
  // ============================================================
  { code: "1000", nameAr: "الأصول", nameEn: "Assets", type: "asset", subtype: "header", isHeader: true },

  { code: "1100", nameAr: "الأصول المتداولة", nameEn: "Current Assets", type: "asset", subtype: "header", isHeader: true, parentCode: "1000" },
  { code: "1110", nameAr: "النقد بالصندوق", nameEn: "Cash on Hand", type: "asset", subtype: "current_asset", parentCode: "1100" },
  { code: "1120", nameAr: "البنوك", nameEn: "Banks", type: "asset", subtype: "header", isHeader: true, parentCode: "1100" },
  { code: "1121", nameAr: "بنك الراجحي - فرع الرياض (22525998)", nameEn: "Al Rajhi Bank — Riyadh (22525998)", type: "asset", subtype: "current_asset", parentCode: "1120" },

  { code: "1200", nameAr: "ذمم مدينة", nameEn: "Receivables", type: "asset", subtype: "header", isHeader: true, parentCode: "1000" },
  { code: "1210", nameAr: "العملاء", nameEn: "Customers (AR)", type: "asset", subtype: "current_asset", parentCode: "1200" },

  { code: "1300", nameAr: "المخزون", nameEn: "Inventory", type: "asset", subtype: "current_asset", parentCode: "1000" },

  { code: "1400", nameAr: "أصول غير متداولة", nameEn: "Non-Current Assets", type: "asset", subtype: "header", isHeader: true, parentCode: "1000" },
  { code: "1410", nameAr: "الأصول الثابتة", nameEn: "Fixed Assets", type: "asset", subtype: "header", isHeader: true, parentCode: "1400" },
  { code: "1411", nameAr: "معدات وأدوات", nameEn: "Equipment & Tools", type: "asset", subtype: "non_current_asset", parentCode: "1410" },
  { code: "1412", nameAr: "أثاث وتجهيزات", nameEn: "Furniture & Fixtures", type: "asset", subtype: "non_current_asset", parentCode: "1410" },
  { code: "1413", nameAr: "مركبات", nameEn: "Vehicles", type: "asset", subtype: "non_current_asset", parentCode: "1410" },

  { code: "1420", nameAr: "مجمع الإهلاك", nameEn: "Accumulated Depreciation", type: "asset", subtype: "header", isHeader: true, parentCode: "1400" },
  { code: "1421", nameAr: "مجمع إهلاك معدات وأدوات", nameEn: "Accum. Dep — Equipment & Tools", type: "asset", subtype: "contra_asset", parentCode: "1420" },
  { code: "1422", nameAr: "مجمع إهلاك أثاث وتجهيزات", nameEn: "Accum. Dep — Furniture & Fixtures", type: "asset", subtype: "contra_asset", parentCode: "1420" },
  { code: "1423", nameAr: "مجمع إهلاك مركبات", nameEn: "Accum. Dep — Vehicles", type: "asset", subtype: "contra_asset", parentCode: "1420" },

  // ============================================================
  // LIABILITIES — الالتزامات
  // ============================================================
  { code: "2000", nameAr: "الالتزامات", nameEn: "Liabilities", type: "liability", subtype: "header", isHeader: true },

  { code: "2100", nameAr: "الالتزامات المتداولة", nameEn: "Current Liabilities", type: "liability", subtype: "header", isHeader: true, parentCode: "2000" },
  { code: "2110", nameAr: "الموردون (ذمم دائنة)", nameEn: "Suppliers (AP)", type: "liability", subtype: "current_liability", parentCode: "2100" },
  { code: "2120", nameAr: "مصروفات مستحقة", nameEn: "Accrued Expenses", type: "liability", subtype: "current_liability", parentCode: "2100" },
  { code: "2130", nameAr: "ضريبة القيمة المضافة المستحقة", nameEn: "VAT Payable", type: "liability", subtype: "current_liability", parentCode: "2100" },

  { code: "2200", nameAr: "التزامات غير متداولة", nameEn: "Non-Current Liabilities", type: "liability", subtype: "header", isHeader: true, parentCode: "2000" },
  { code: "2210", nameAr: "قروض طويلة الأجل", nameEn: "Long-Term Loans", type: "liability", subtype: "non_current_liability", parentCode: "2200" },

  // ============================================================
  // EQUITY — حقوق الملكية
  // ============================================================
  { code: "3000", nameAr: "حقوق الملكية", nameEn: "Equity", type: "equity", subtype: "header", isHeader: true },
  { code: "3100", nameAr: "رأس المال", nameEn: "Capital", type: "equity", subtype: "capital", parentCode: "3000" },
  { code: "3200", nameAr: "الأرباح/الخسائر المرحلة", nameEn: "Retained Earnings (Brought Forward)", type: "equity", subtype: "retained_earnings", parentCode: "3000" },
  { code: "3300", nameAr: "صافي ربح/خسارة الفترة", nameEn: "Net P&L for the Period", type: "equity", subtype: "retained_earnings", parentCode: "3000" },

  // ============================================================
  // REVENUE — الإيرادات
  // ============================================================
  { code: "4000", nameAr: "الإيرادات", nameEn: "Revenue", type: "revenue", subtype: "header", isHeader: true },
  { code: "4100", nameAr: "إيرادات المبيعات", nameEn: "Sales Revenue", type: "revenue", subtype: "operating_revenue", parentCode: "4000" },
  { code: "4200", nameAr: "إيرادات خدمات", nameEn: "Service Revenue", type: "revenue", subtype: "operating_revenue", parentCode: "4000" },

  // ============================================================
  // COGS — تكلفة المبيعات
  // ============================================================
  { code: "5000", nameAr: "تكلفة المبيعات", nameEn: "Cost of Sales", type: "expense", subtype: "header", isHeader: true },
  { code: "5100", nameAr: "تكلفة البضاعة المباعة", nameEn: "Cost of Goods Sold", type: "expense", subtype: "cogs", parentCode: "5000" },

  // ============================================================
  // OPERATING EXPENSES — المصروفات التشغيلية
  // ============================================================
  { code: "6000", nameAr: "المصروفات التشغيلية", nameEn: "Operating Expenses", type: "expense", subtype: "header", isHeader: true },
  { code: "6100", nameAr: "رواتب وأجور", nameEn: "Salaries & Wages", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6200", nameAr: "إيجارات", nameEn: "Rent", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6300", nameAr: "كهرباء ومياه", nameEn: "Utilities", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6400", nameAr: "اتصالات وإنترنت", nameEn: "Telecom & Internet", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6500", nameAr: "مصاريف نقل", nameEn: "Transport & Shipping", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6600", nameAr: "مصاريف تسويق", nameEn: "Marketing", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6700", nameAr: "مصاريف مكتبية", nameEn: "Office Expenses", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6800", nameAr: "مصاريف بنكية", nameEn: "Bank Fees", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6900", nameAr: "مصاريف أخرى", nameEn: "Other Expenses", type: "expense", subtype: "operating_expense", parentCode: "6000" },
];

// Map free-text Arabic categories to default account codes (used to auto-classify
// quick transactions into proper IFRS journal entries).
export const CATEGORY_TO_ACCOUNT_CODE: { keywords: string[]; code: string }[] = [
  // Income side
  { keywords: ["مبيعات", "بيع"], code: "4100" },
  { keywords: ["خدمات", "أتعاب"], code: "4200" },
  { keywords: ["خصم مبيعات"], code: "4300" }, // contra-revenue (added below)
  { keywords: ["راتب", "مرتب", "أجر"], code: "4990" }, // personal salary income → other income
  // Expense side
  { keywords: ["تكلفة البضائع", "تكلفة البضاعة", "بضاعة", "مشتريات"], code: "5100" },
  { keywords: ["رواتب", "أجور", "مرتبات"], code: "6100" },
  { keywords: ["إيجار", "ايجار"], code: "6200" },
  { keywords: ["كهرباء", "ماء", "مرافق", "فواتير"], code: "6300" },
  { keywords: ["إنترنت", "انترنت", "اتصالات", "هاتف", "جوال"], code: "6400" },
  { keywords: ["شحن", "توصيل", "نقل بضاعة", "مواصلات", "بنزين", "وقود", "تاكسي", "أوبر", "كريم"], code: "6500" },
  { keywords: ["تسويق", "إعلان", "اعلان"], code: "6600" },
  { keywords: ["مكتب", "قرطاسية", "أدوات مكتبية"], code: "6700" },
  { keywords: ["عمولة", "بنك", "رسوم"], code: "6800" },
  { keywords: ["إهلاك", "اهلاك"], code: "6150" },
];

export function pickExpenseAccountCode(category: string, description: string): string {
  const haystack = `${category} ${description}`;
  for (const map of CATEGORY_TO_ACCOUNT_CODE) {
    if (map.keywords.some((k) => haystack.includes(k))) return map.code;
  }
  return "6900"; // other operating expense
}

export function pickRevenueAccountCode(category: string, description: string): string {
  const haystack = `${category} ${description}`;
  for (const map of CATEGORY_TO_ACCOUNT_CODE) {
    if (map.code.startsWith("4") && map.keywords.some((k) => haystack.includes(k))) {
      return map.code;
    }
  }
  return "4100"; // sales revenue default
}

// ============================================================================
// Account-code constants used by the rest of the codebase. The numbering
// above leaves dedicated bands free for these IFRS-required extras so the
// HR / fixed-asset / disposal flows don't collide with the customer's
// numbering above.
// ============================================================================

export const CASH_ACCOUNT_CODE = "1110";

// HR / Payroll
export const SALARIES_EXPENSE_CODE = "6100";              // base salaries (in user tree)
export const SOCIAL_INSURANCE_EXPENSE_CODE = "6110";      // added below
export const EOS_EXPENSE_CODE = "6120";                   // added below
export const ACCRUED_SALARIES_CODE = "2140";              // added below — separate from VAT (2130)
export const SOCIAL_INSURANCE_PAYABLE_CODE = "2150";      // added below
export const ACCRUED_LEAVE_LIABILITY_CODE = "2160";       // added below
export const EOS_LIABILITY_CODE = "2220";                 // added below

// Fixed-Asset (IAS 16) account codes — anchored on the user's 14xx PPE band
export const FA_ASSET_COST_CODE = "1411";                 // Equipment & Tools (default class)
export const FA_ACCUM_DEP_CODE = "1421";                  // Accum. Dep — Equipment (default class)
export const FA_ACCUM_IMP_CODE = "1430";                  // added below
export const FA_DEP_EXPENSE_CODE = "6150";                // added below
export const FA_IMP_LOSS_CODE = "6160";                   // added below
export const FA_REVAL_SURPLUS_CODE = "3400";              // added below
export const FA_GAIN_LOSS_DISPOSAL_CODE = "4900";         // added below

// Per-class default cost & contra accounts for category seeding
export const FA_CATEGORY_DEFAULTS: Array<{
  name: string;
  assetCostCode: string;
  accumDepCode: string;
  defaultUsefulLifeMonths: number;
}> = [
  { name: "معدات وأدوات / Equipment & Tools", assetCostCode: "1411", accumDepCode: "1421", defaultUsefulLifeMonths: 60 },
  { name: "أثاث وتجهيزات / Furniture & Fixtures", assetCostCode: "1412", accumDepCode: "1422", defaultUsefulLifeMonths: 60 },
  { name: "مركبات / Vehicles", assetCostCode: "1413", accumDepCode: "1423", defaultUsefulLifeMonths: 60 },
];

// Extra Fixed-Asset accounts to merge into the seed at startup (in init-coa).
export const FIXED_ASSETS_EXTRA_ACCOUNTS: SeedAccount[] = [
  // Single accumulated impairment bucket (sits beside 142x accum dep)
  { code: "1430", nameAr: "مجمع خسائر الانخفاض في القيمة", nameEn: "Accumulated Impairment", type: "asset", subtype: "contra_asset", parentCode: "1400" },
  // Equity / OCI surplus from revaluation model
  { code: "3400", nameAr: "فائض إعادة التقييم (الدخل الشامل الآخر)", nameEn: "Revaluation Surplus (OCI)", type: "equity", subtype: "oci", parentCode: "3000" },
  // Gain/Loss on disposal (parked under Revenue per IAS 1 presentation)
  { code: "4900", nameAr: "أرباح / خسائر بيع أصول ثابتة", nameEn: "Gain/Loss on Disposal of PPE", type: "revenue", subtype: "other_income", parentCode: "4000" },
  // Sales discounts (contra-revenue) — kept for AI auto-classification
  { code: "4300", nameAr: "خصم المبيعات", nameEn: "Sales Discounts", type: "revenue", subtype: "contra_revenue", parentCode: "4000" },
  // Other income catch-all (used when AI sees personal-salary keywords)
  { code: "4990", nameAr: "إيرادات أخرى", nameEn: "Other Income", type: "revenue", subtype: "other_income", parentCode: "4000" },
  // Depreciation expense
  { code: "6150", nameAr: "مصروفات الإهلاك", nameEn: "Depreciation Expense", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  // Impairment loss expense
  { code: "6160", nameAr: "خسائر الانخفاض في قيمة الأصول", nameEn: "Impairment Loss", type: "expense", subtype: "operating_expense", parentCode: "6000" },
];

// Extra payroll-related accounts to merge into the seed at startup (in init-coa).
export const PAYROLL_EXTRA_ACCOUNTS: SeedAccount[] = [
  { code: "6110", nameAr: "اشتراكات التأمينات الاجتماعية", nameEn: "Social Insurance Expense", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6120", nameAr: "مصروف مكافأة نهاية الخدمة", nameEn: "End of Service Expense", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "2140", nameAr: "رواتب مستحقة", nameEn: "Salaries Payable", type: "liability", subtype: "current_liability", parentCode: "2100" },
  { code: "2150", nameAr: "تأمينات اجتماعية مستحقة", nameEn: "Social Insurance Payable", type: "liability", subtype: "current_liability", parentCode: "2100" },
  { code: "2160", nameAr: "إجازات مستحقة للموظفين", nameEn: "Accrued Leave Liability", type: "liability", subtype: "current_liability", parentCode: "2100" },
  { code: "2220", nameAr: "التزامات نهاية الخدمة", nameEn: "End of Service Liability", type: "liability", subtype: "non_current_liability", parentCode: "2200" },
];
