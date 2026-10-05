// Country localization packs. The accounting/HR core knows nothing about countries —
// all per-country rules live here and can be edited or replaced.

export type EndOfServiceFormula = "gulf" | "egypt" | "jordan" | "none";

export interface LocalizationPack {
  code: string;
  nameAr: string;
  nameEn: string;
  defaultCurrencyCode: string;
  defaultCurrencySymbol: string;
  defaultVatRate: number; // e.g., 0.15
  zakatApplicable: boolean;
  weekendDays: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  annualLeaveDays: number;
  probationDays: number;
  socialInsurance: {
    label: string;
    employeeRate: number;
    employerRate: number;
    nationalEmployeeRate?: number;
    nationalEmployerRate?: number;
  };
  endOfServiceFormula: EndOfServiceFormula;
}

export const LOCALIZATION_PACKS: Record<string, LocalizationPack> = {
  INTL: {
    code: "INTL",
    nameAr: "عام / دولي (IFRS فقط)",
    nameEn: "International (IFRS only)",
    defaultCurrencyCode: "USD",
    defaultCurrencySymbol: "$",
    defaultVatRate: 0,
    zakatApplicable: false,
    weekendDays: [0, 6], // Sun + Sat
    annualLeaveDays: 20,
    probationDays: 90,
    socialInsurance: { label: "Social Insurance", employeeRate: 0, employerRate: 0 },
    endOfServiceFormula: "none",
  },
  SA: {
    code: "SA",
    nameAr: "السعودية",
    nameEn: "Saudi Arabia",
    defaultCurrencyCode: "SAR",
    defaultCurrencySymbol: "ر.س",
    defaultVatRate: 0.15,
    zakatApplicable: true,
    weekendDays: [5, 6], // Fri + Sat
    annualLeaveDays: 21,
    probationDays: 90,
    socialInsurance: {
      label: "GOSI",
      employeeRate: 0.02,
      employerRate: 0.02,
      nationalEmployeeRate: 0.0975,
      nationalEmployerRate: 0.1175,
    },
    endOfServiceFormula: "gulf",
  },
  AE: {
    code: "AE",
    nameAr: "الإمارات",
    nameEn: "United Arab Emirates",
    defaultCurrencyCode: "AED",
    defaultCurrencySymbol: "د.إ",
    defaultVatRate: 0.05,
    zakatApplicable: false,
    weekendDays: [5, 6],
    annualLeaveDays: 30,
    probationDays: 180,
    socialInsurance: {
      label: "Pension",
      employeeRate: 0,
      employerRate: 0,
      nationalEmployeeRate: 0.05,
      nationalEmployerRate: 0.125,
    },
    endOfServiceFormula: "gulf",
  },
  EG: {
    code: "EG",
    nameAr: "مصر",
    nameEn: "Egypt",
    defaultCurrencyCode: "EGP",
    defaultCurrencySymbol: "ج.م",
    defaultVatRate: 0.14,
    zakatApplicable: false,
    weekendDays: [5, 6],
    annualLeaveDays: 21,
    probationDays: 90,
    socialInsurance: { label: "تأمينات اجتماعية", employeeRate: 0.11, employerRate: 0.1875 },
    endOfServiceFormula: "egypt",
  },
  KW: {
    code: "KW",
    nameAr: "الكويت",
    nameEn: "Kuwait",
    defaultCurrencyCode: "KWD",
    defaultCurrencySymbol: "د.ك",
    defaultVatRate: 0,
    zakatApplicable: true,
    weekendDays: [5, 6],
    annualLeaveDays: 30,
    probationDays: 100,
    socialInsurance: {
      label: "PIFSS",
      employeeRate: 0,
      employerRate: 0,
      nationalEmployeeRate: 0.08,
      nationalEmployerRate: 0.115,
    },
    endOfServiceFormula: "gulf",
  },
  QA: {
    code: "QA",
    nameAr: "قطر",
    nameEn: "Qatar",
    defaultCurrencyCode: "QAR",
    defaultCurrencySymbol: "ر.ق",
    defaultVatRate: 0,
    zakatApplicable: true,
    weekendDays: [5, 6],
    annualLeaveDays: 21,
    probationDays: 180,
    socialInsurance: {
      label: "GRSIA",
      employeeRate: 0,
      employerRate: 0,
      nationalEmployeeRate: 0.05,
      nationalEmployerRate: 0.10,
    },
    endOfServiceFormula: "gulf",
  },
  JO: {
    code: "JO",
    nameAr: "الأردن",
    nameEn: "Jordan",
    defaultCurrencyCode: "JOD",
    defaultCurrencySymbol: "د.أ",
    defaultVatRate: 0.16,
    zakatApplicable: false,
    weekendDays: [5, 6],
    annualLeaveDays: 14,
    probationDays: 90,
    socialInsurance: { label: "SSC", employeeRate: 0.075, employerRate: 0.1425 },
    endOfServiceFormula: "jordan",
  },

  // ── Global packs ──────────────────────────────────────────────────────
  // The most common non-MENA business markets, each carrying its own real
  // tax / weekend / leave / payroll-contribution profile so a company in that
  // country gets locally-correct defaults (mirroring how SA carries ZATCA +
  // GOSI). endOfServiceFormula is "none" for these because their statutory
  // severance is not a monthly IAS-19 gratuity accrual like the Gulf/Egypt/
  // Jordan models — we don't fabricate an accrual we can't verify.
  US: {
    code: "US",
    nameAr: "الولايات المتحدة",
    nameEn: "United States",
    defaultCurrencyCode: "USD",
    defaultCurrencySymbol: "$",
    // No federal VAT; US sales tax is state/locality-specific and is handled
    // per-invoice, not as a single national default rate.
    defaultVatRate: 0,
    zakatApplicable: false,
    weekendDays: [0, 6], // Sun + Sat
    annualLeaveDays: 15,
    probationDays: 90,
    // FICA: Social Security + Medicare employee/employer share (approx).
    socialInsurance: { label: "FICA", employeeRate: 0.0765, employerRate: 0.0765 },
    endOfServiceFormula: "none",
  },
  GB: {
    code: "GB",
    nameAr: "المملكة المتحدة",
    nameEn: "United Kingdom",
    defaultCurrencyCode: "GBP",
    defaultCurrencySymbol: "£",
    defaultVatRate: 0.2, // standard VAT 20%
    zakatApplicable: false,
    weekendDays: [0, 6],
    annualLeaveDays: 28, // statutory minimum incl. bank holidays
    probationDays: 90,
    socialInsurance: { label: "National Insurance", employeeRate: 0.08, employerRate: 0.138 },
    endOfServiceFormula: "none",
  },
  DE: {
    code: "DE",
    nameAr: "ألمانيا",
    nameEn: "Germany",
    defaultCurrencyCode: "EUR",
    defaultCurrencySymbol: "€",
    defaultVatRate: 0.19, // standard VAT 19%
    zakatApplicable: false,
    weekendDays: [0, 6],
    annualLeaveDays: 20, // statutory minimum (5-day week)
    probationDays: 180,
    socialInsurance: { label: "Sozialversicherung", employeeRate: 0.20, employerRate: 0.20 },
    endOfServiceFormula: "none",
  },
  FR: {
    code: "FR",
    nameAr: "فرنسا",
    nameEn: "France",
    defaultCurrencyCode: "EUR",
    defaultCurrencySymbol: "€",
    defaultVatRate: 0.20, // standard VAT 20%
    zakatApplicable: false,
    weekendDays: [0, 6],
    annualLeaveDays: 25,
    probationDays: 90,
    socialInsurance: { label: "Sécurité sociale", employeeRate: 0.22, employerRate: 0.42 },
    endOfServiceFormula: "none",
  },
  IN: {
    code: "IN",
    nameAr: "الهند",
    nameEn: "India",
    defaultCurrencyCode: "INR",
    defaultCurrencySymbol: "₹",
    defaultVatRate: 0.18, // GST standard rate 18%
    zakatApplicable: false,
    weekendDays: [0, 6],
    annualLeaveDays: 18,
    probationDays: 90,
    // EPF: Employees' Provident Fund employee/employer share.
    socialInsurance: { label: "EPF", employeeRate: 0.12, employerRate: 0.12 },
    endOfServiceFormula: "none",
  },
};

export function getPack(code: string | null | undefined): LocalizationPack {
  return LOCALIZATION_PACKS[code || "INTL"] || LOCALIZATION_PACKS.INTL;
}

// Compute monthly accrual for End-of-Service (IAS 19) given monthly base salary
export function monthlyEndOfServiceAccrual(
  formula: EndOfServiceFormula,
  monthlySalary: number,
  yearsOfServiceCompleted: number
): number {
  if (formula === "none") return 0;
  if (formula === "gulf") {
    // 0.5 month per year for first 5 years; 1 month/year after.
    // Smooth transition during year 5 by using a fractional rate.
    let yearlyRate: number;
    if (yearsOfServiceCompleted >= 5) {
      yearlyRate = 1;
    } else if (yearsOfServiceCompleted >= 4) {
      const frac = yearsOfServiceCompleted - 4; // 0..1
      yearlyRate = 0.5 + frac * 0.5; // ramps 0.5 -> 1
    } else {
      yearlyRate = 0.5;
    }
    return (monthlySalary * yearlyRate) / 12;
  }
  if (formula === "egypt" || formula === "jordan") {
    return monthlySalary / 12; // ~1 month per year
  }
  return 0;
}

export function monthlyLeaveAccrual(annualLeaveDays: number, monthlySalary: number): number {
  // Daily rate × leave days / 12 — accrue the value of unused leave each month
  const dailyRate = monthlySalary / 30;
  return (dailyRate * annualLeaveDays) / 12;
}
