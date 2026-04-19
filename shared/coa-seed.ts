// IFRS-aligned default Chart of Accounts (Saudi Arabian small business friendly)
// Codes follow the standard 1xxx-5xxx grouping.

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
  // ASSETS
  { code: "1000", nameAr: "الأصول", nameEn: "Assets", type: "asset", subtype: "header", isHeader: true },
  { code: "1100", nameAr: "الأصول المتداولة", nameEn: "Current Assets", type: "asset", subtype: "header", isHeader: true, parentCode: "1000" },
  { code: "1110", nameAr: "النقدية في الصندوق", nameEn: "Cash on Hand", type: "asset", subtype: "current_asset", parentCode: "1100" },
  { code: "1120", nameAr: "البنك", nameEn: "Bank", type: "asset", subtype: "current_asset", parentCode: "1100" },
  { code: "1130", nameAr: "العملاء (المدينون)", nameEn: "Accounts Receivable", type: "asset", subtype: "current_asset", parentCode: "1100" },
  { code: "1140", nameAr: "المخزون", nameEn: "Inventory", type: "asset", subtype: "current_asset", parentCode: "1100" },
  { code: "1150", nameAr: "المصروفات المدفوعة مقدماً", nameEn: "Prepaid Expenses", type: "asset", subtype: "current_asset", parentCode: "1100" },
  { code: "1200", nameAr: "الأصول غير المتداولة", nameEn: "Non-Current Assets", type: "asset", subtype: "header", isHeader: true, parentCode: "1000" },
  { code: "1210", nameAr: "الأثاث والمعدات", nameEn: "Furniture & Equipment", type: "asset", subtype: "non_current_asset", parentCode: "1200" },
  { code: "1220", nameAr: "المركبات", nameEn: "Vehicles", type: "asset", subtype: "non_current_asset", parentCode: "1200" },
  { code: "1230", nameAr: "المباني", nameEn: "Buildings", type: "asset", subtype: "non_current_asset", parentCode: "1200" },
  { code: "1290", nameAr: "مجمع الإهلاك", nameEn: "Accumulated Depreciation", type: "asset", subtype: "contra_asset", parentCode: "1200" },

  // LIABILITIES
  { code: "2000", nameAr: "الخصوم (الالتزامات)", nameEn: "Liabilities", type: "liability", subtype: "header", isHeader: true },
  { code: "2100", nameAr: "الخصوم المتداولة", nameEn: "Current Liabilities", type: "liability", subtype: "header", isHeader: true, parentCode: "2000" },
  { code: "2110", nameAr: "الموردون (الدائنون)", nameEn: "Accounts Payable", type: "liability", subtype: "current_liability", parentCode: "2100" },
  { code: "2120", nameAr: "ضريبة القيمة المضافة المستحقة", nameEn: "VAT Payable", type: "liability", subtype: "current_liability", parentCode: "2100" },
  { code: "2130", nameAr: "الرواتب المستحقة", nameEn: "Salaries Payable", type: "liability", subtype: "current_liability", parentCode: "2100" },
  { code: "2140", nameAr: "إيرادات مقبوضة مقدماً", nameEn: "Unearned Revenue", type: "liability", subtype: "current_liability", parentCode: "2100" },
  { code: "2200", nameAr: "الخصوم غير المتداولة", nameEn: "Non-Current Liabilities", type: "liability", subtype: "header", isHeader: true, parentCode: "2000" },
  { code: "2210", nameAr: "القروض طويلة الأجل", nameEn: "Long-Term Loans", type: "liability", subtype: "non_current_liability", parentCode: "2200" },

  // EQUITY
  { code: "3000", nameAr: "حقوق الملكية", nameEn: "Equity", type: "equity", subtype: "header", isHeader: true },
  { code: "3010", nameAr: "رأس المال", nameEn: "Capital", type: "equity", subtype: "capital", parentCode: "3000" },
  { code: "3020", nameAr: "الأرباح المحتجزة", nameEn: "Retained Earnings", type: "equity", subtype: "retained_earnings", parentCode: "3000" },
  { code: "3030", nameAr: "المسحوبات الشخصية", nameEn: "Owner's Drawings", type: "equity", subtype: "drawings", parentCode: "3000" },

  // REVENUE
  { code: "4000", nameAr: "الإيرادات", nameEn: "Revenue", type: "revenue", subtype: "header", isHeader: true },
  { code: "4010", nameAr: "إيرادات المبيعات", nameEn: "Sales Revenue", type: "revenue", subtype: "operating_revenue", parentCode: "4000" },
  { code: "4020", nameAr: "إيرادات الخدمات", nameEn: "Service Revenue", type: "revenue", subtype: "operating_revenue", parentCode: "4000" },
  { code: "4030", nameAr: "خصم المبيعات", nameEn: "Sales Discounts", type: "revenue", subtype: "contra_revenue", parentCode: "4000" },
  { code: "4090", nameAr: "إيرادات أخرى", nameEn: "Other Income", type: "revenue", subtype: "other_income", parentCode: "4000" },

  // COGS & EXPENSES
  { code: "5000", nameAr: "تكلفة المبيعات", nameEn: "Cost of Sales", type: "expense", subtype: "header", isHeader: true },
  { code: "5010", nameAr: "تكلفة البضاعة المباعة", nameEn: "Cost of Goods Sold", type: "expense", subtype: "cogs", parentCode: "5000" },
  { code: "5020", nameAr: "خصم المشتريات", nameEn: "Purchase Discounts", type: "expense", subtype: "contra_cogs", parentCode: "5000" },

  { code: "6000", nameAr: "المصروفات التشغيلية", nameEn: "Operating Expenses", type: "expense", subtype: "header", isHeader: true },
  { code: "6010", nameAr: "الرواتب والأجور", nameEn: "Salaries & Wages", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6020", nameAr: "الإيجار", nameEn: "Rent", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6030", nameAr: "المرافق (كهرباء/ماء)", nameEn: "Utilities", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6040", nameAr: "الإنترنت والاتصالات", nameEn: "Internet & Telecom", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6050", nameAr: "التسويق والإعلان", nameEn: "Marketing & Advertising", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6060", nameAr: "الصيانة والإصلاح", nameEn: "Repairs & Maintenance", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6070", nameAr: "الشحن والنقل", nameEn: "Shipping & Transport", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6080", nameAr: "العمولات والرسوم البنكية", nameEn: "Bank Fees & Commissions", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6090", nameAr: "الطعام والضيافة", nameEn: "Meals & Entertainment", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6100", nameAr: "المواصلات", nameEn: "Transportation", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6110", nameAr: "مصروفات الإهلاك", nameEn: "Depreciation Expense", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6900", nameAr: "مصروفات عمومية أخرى", nameEn: "Other Operating Expenses", type: "expense", subtype: "operating_expense", parentCode: "6000" },
];

// Map free-text Arabic categories to default account codes (used to auto-classify
// quick transactions into proper IFRS journal entries).
export const CATEGORY_TO_ACCOUNT_CODE: { keywords: string[]; code: string }[] = [
  // Income side
  { keywords: ["مبيعات", "بيع"], code: "4010" },
  { keywords: ["خدمات", "أتعاب"], code: "4020" },
  { keywords: ["خصم مبيعات"], code: "4030" },
  { keywords: ["راتب", "مرتب", "أجر"], code: "4090" }, // personal salary income → other income
  // Expense side
  { keywords: ["تكلفة البضائع", "تكلفة البضاعة", "بضاعة", "مشتريات"], code: "5010" },
  { keywords: ["رواتب", "أجور", "مرتبات"], code: "6010" },
  { keywords: ["إيجار", "ايجار"], code: "6020" },
  { keywords: ["كهرباء", "ماء", "مرافق", "فواتير"], code: "6030" },
  { keywords: ["إنترنت", "انترنت", "اتصالات", "هاتف", "جوال"], code: "6040" },
  { keywords: ["تسويق", "إعلان", "اعلان"], code: "6050" },
  { keywords: ["صيانة", "إصلاح", "اصلاح"], code: "6060" },
  { keywords: ["شحن", "توصيل", "نقل بضاعة"], code: "6070" },
  { keywords: ["عمولة", "بنك", "رسوم"], code: "6080" },
  { keywords: ["طعام", "غداء", "عشاء", "فطور", "قهوة", "مطعم", "بقالة"], code: "6090" },
  { keywords: ["مواصلات", "بنزين", "وقود", "تاكسي", "أوبر", "كريم"], code: "6100" },
  { keywords: ["إهلاك", "اهلاك"], code: "6110" },
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
  return "4010"; // sales revenue default
}

export const CASH_ACCOUNT_CODE = "1110";
