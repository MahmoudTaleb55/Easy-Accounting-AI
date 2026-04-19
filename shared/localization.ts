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
