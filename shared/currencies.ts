// Authoritative currency catalogue used by both signup flow and any
// backend callers that need to canonicalize a currency code → symbol.
// Keep additions deliberate: this list is the source of truth for what
// workspaces can be denominated in at provisioning time.

export interface CurrencyMeta {
  code: string;
  symbol: string;
  nameEn: string;
  nameAr: string;
}

// Global-first ordering: major international currencies lead, then the MENA
// set the platform also supports. The full list stays available at
// provisioning time; adding a currency to the localization packs should also
// add it here. INR accompanies the India (IN) localization pack.
export const SUPPORTED_CURRENCIES: ReadonlyArray<CurrencyMeta> = [
  { code: "USD", symbol: "$", nameEn: "US Dollar", nameAr: "دولار أمريكي" },
  { code: "EUR", symbol: "€", nameEn: "Euro", nameAr: "يورو" },
  { code: "GBP", symbol: "£", nameEn: "British Pound", nameAr: "جنيه استرليني" },
  { code: "INR", symbol: "₹", nameEn: "Indian Rupee", nameAr: "روبية هندية" },
  { code: "SAR", symbol: "ر.س", nameEn: "Saudi Riyal", nameAr: "ريال سعودي" },
  { code: "AED", symbol: "د.إ", nameEn: "UAE Dirham", nameAr: "درهم إماراتي" },
  { code: "KWD", symbol: "د.ك", nameEn: "Kuwaiti Dinar", nameAr: "دينار كويتي" },
  { code: "QAR", symbol: "ر.ق", nameEn: "Qatari Riyal", nameAr: "ريال قطري" },
  { code: "BHD", symbol: "د.ب", nameEn: "Bahraini Dinar", nameAr: "دينار بحريني" },
  { code: "OMR", symbol: "ر.ع", nameEn: "Omani Rial", nameAr: "ريال عماني" },
  { code: "EGP", symbol: "ج.م", nameEn: "Egyptian Pound", nameAr: "جنيه مصري" },
  { code: "JOD", symbol: "د.أ", nameEn: "Jordanian Dinar", nameAr: "دينار أردني" },
];

export const SUPPORTED_CURRENCY_CODES = SUPPORTED_CURRENCIES.map((c) => c.code) as readonly string[];

// Global-first default currency, used as the fallback by resolveCurrency().
export const DEFAULT_CURRENCY_CODE = "USD";

/** Canonical lookup: returns undefined for unknown codes. */
export function getCurrencyMeta(code: string | undefined | null): CurrencyMeta | undefined {
  if (!code) return undefined;
  const upper = code.toUpperCase();
  return SUPPORTED_CURRENCIES.find((c) => c.code === upper);
}

/** Resolve to a known currency or fall back to the default. Symbols are
 *  always derived server-side — never trusted from client input. */
export function resolveCurrency(code: string | undefined | null): CurrencyMeta {
  return getCurrencyMeta(code) ?? getCurrencyMeta(DEFAULT_CURRENCY_CODE)!;
}
