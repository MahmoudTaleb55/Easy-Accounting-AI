/**
 * PDF translation tables.
 *
 * Every label that used to be hard-coded as bilingual Arabic+English
 * (e.g. "فاتورة مبيعات / Sales Invoice") lives here, in all four
 * supported locales (ar / en / de / fr). Each PDF renderer takes a
 * `Locale` parameter and pulls every label through `t(locale, key)`.
 *
 * Adding a new label? Add it to PDF_STRINGS with all four translations.
 * `pdf-strings.test.ts` enforces exhaustive coverage.
 */

export type Locale = "ar" | "en" | "de" | "fr";

export const PDF_LOCALES: Locale[] = ["ar", "en", "de", "fr"];

export function isLocale(v: unknown): v is Locale {
  return v === "ar" || v === "en" || v === "de" || v === "fr";
}

/** Direction the renderer should default to for a given locale. Only Arabic
 *  is RTL among the four supported languages. */
export function dirFor(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Label dictionary                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

type LocalizedString = Record<Locale, string>;

const PDF_STRINGS = {
  // Sales invoice ─────────────────────────────────────────────
  "invoice.title":          { ar: "فاتورة مبيعات", en: "Sales Invoice",   de: "Verkaufsrechnung",       fr: "Facture de vente" },
  "invoice.billTo":         { ar: "بيانات العميل", en: "Bill To",         de: "Rechnungsempfänger",     fr: "Facturé à" },
  "invoice.customerCode":   { ar: "كود",           en: "Code",            de: "Code",                   fr: "Code" },
  "invoice.number":         { ar: "رقم الفاتورة",   en: "Invoice #",       de: "Rechnungs-Nr.",          fr: "N° de facture" },
  "invoice.date":           { ar: "التاريخ",        en: "Date",            de: "Datum",                  fr: "Date" },
  "invoice.due":            { ar: "الاستحقاق",      en: "Due",             de: "Fällig",                 fr: "Échéance" },
  "invoice.status":         { ar: "الحالة",         en: "Status",          de: "Status",                 fr: "Statut" },
  "invoice.payment":        { ar: "طريقة الدفع",    en: "Payment",         de: "Zahlungsart",            fr: "Paiement" },
  "invoice.col.description":{ ar: "الوصف",          en: "Description",     de: "Beschreibung",           fr: "Description" },
  "invoice.col.qty":        { ar: "الكمية",         en: "Qty",             de: "Menge",                  fr: "Qté" },
  "invoice.col.price":      { ar: "السعر",          en: "Price",           de: "Preis",                  fr: "Prix" },
  "invoice.col.vat":        { ar: "ض.ق.م",          en: "VAT",             de: "USt.",                   fr: "TVA" },
  "invoice.col.total":      { ar: "الإجمالي",       en: "Total",           de: "Gesamt",                 fr: "Total" },
  "invoice.subtotal":       { ar: "الإجمالي قبل الضريبة", en: "Subtotal",  de: "Zwischensumme",          fr: "Sous-total" },
  "invoice.vatAmount":      { ar: "ضريبة القيمة المضافة", en: "VAT",       de: "Umsatzsteuer",           fr: "TVA" },
  "invoice.total":          { ar: "الإجمالي",       en: "Total",           de: "Gesamtbetrag",           fr: "Total" },
  "invoice.notes":          { ar: "ملاحظات",        en: "Notes",           de: "Anmerkungen",            fr: "Notes" },
  "invoice.linkedJE":       { ar: "قيد اليومية المرتبط", en: "Linked Journal Entry", de: "Verknüpfte Buchung", fr: "Écriture comptable liée" },

  // Reports — common ─────────────────────────────────────────
  "report.asOf":            { ar: "حتى",           en: "As of",            de: "Stand",                  fr: "Au" },
  "report.currency":        { ar: "العملة",         en: "Currency",         de: "Währung",                fr: "Devise" },
  "report.code":            { ar: "الكود",          en: "Code",             de: "Code",                   fr: "Code" },
  "report.account":         { ar: "الحساب",         en: "Account",          de: "Konto",                  fr: "Compte" },
  "report.type":            { ar: "النوع",          en: "Type",             de: "Typ",                    fr: "Type" },
  "report.debit":           { ar: "مدين",           en: "Debit",            de: "Soll",                   fr: "Débit" },
  "report.credit":          { ar: "دائن",           en: "Credit",           de: "Haben",                  fr: "Crédit" },
  "report.total":           { ar: "الإجمالي",       en: "TOTAL",            de: "GESAMT",                 fr: "TOTAL" },

  // Trial Balance ─────────────────────────────────────────────
  "report.tb.title":        { ar: "ميزان المراجعة",  en: "Trial Balance",   de: "Rohbilanz",              fr: "Balance générale" },

  // Profit & Loss ─────────────────────────────────────────────
  "report.pl.title":        { ar: "قائمة الأرباح والخسائر", en: "Profit & Loss Statement", de: "Gewinn- und Verlustrechnung", fr: "Compte de résultat" },
  "report.pl.revenue":      { ar: "الإيرادات",       en: "Revenue",          de: "Erlöse",                 fr: "Produits" },
  "report.pl.expenses":     { ar: "المصروفات",       en: "Expenses",         de: "Aufwendungen",           fr: "Charges" },
  "report.pl.totalRevenue": { ar: "إجمالي الإيرادات", en: "Total Revenue",   de: "Gesamterlöse",           fr: "Total des produits" },
  "report.pl.totalExpenses":{ ar: "إجمالي المصروفات", en: "Total Expenses", de: "Gesamtaufwendungen",     fr: "Total des charges" },
  "report.pl.netIncome":    { ar: "صافي الربح",      en: "NET INCOME",       de: "JAHRESERGEBNIS",         fr: "RÉSULTAT NET" },

  // Balance Sheet ─────────────────────────────────────────────
  "report.bs.title":        { ar: "قائمة المركز المالي", en: "Balance Sheet", de: "Bilanz",               fr: "Bilan" },
  "report.bs.assets":       { ar: "الأصول",          en: "Assets",           de: "Aktiva",                 fr: "Actif" },
  "report.bs.liabilities":  { ar: "الالتزامات",      en: "Liabilities",      de: "Passiva (Verbindlichkeiten)", fr: "Passif" },
  "report.bs.equity":       { ar: "حقوق الملكية",    en: "Equity",           de: "Eigenkapital",           fr: "Capitaux propres" },
  "report.bs.totalAssets":  { ar: "إجمالي الأصول",   en: "Total Assets",     de: "Summe Aktiva",           fr: "Total de l'actif" },
  "report.bs.totalLiab":    { ar: "إجمالي الالتزامات", en: "Total Liabilities", de: "Summe Verbindlichkeiten", fr: "Total du passif" },
  "report.bs.totalEquity":  { ar: "إجمالي حقوق الملكية", en: "Total Equity", de: "Summe Eigenkapital",     fr: "Total des capitaux propres" },
  "report.bs.netIncomePeriod": { ar: "صافي الربح للفترة", en: "Net Income (period)", de: "Periodenergebnis", fr: "Résultat net (période)" },
  "report.bs.balanced":     { ar: "متوازنة",         en: "Balanced",         de: "Ausgeglichen",           fr: "Équilibré" },
  "report.bs.imbalance":    { ar: "غير متوازنة",     en: "Imbalance",        de: "Unausgeglichen",         fr: "Déséquilibré" },
  "report.bs.diff":         { ar: "الفرق",           en: "Diff",             de: "Differenz",              fr: "Écart" },
} as const satisfies Record<string, LocalizedString>;

export type PdfStringKey = keyof typeof PDF_STRINGS;

/** Look up a localized PDF label. Falls back to Arabic (the legacy
 *  baseline) only if a downstream key is somehow missing — the test
 *  suite enforces exhaustive coverage so this fallback should never
 *  trigger in production. */
export function t(locale: Locale, key: PdfStringKey): string {
  const row = PDF_STRINGS[key];
  return row?.[locale] ?? row?.ar ?? String(key);
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Enumerated value labels                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

const STATUS_LABELS: Record<string, LocalizedString> = {
  draft:     { ar: "مسودة",   en: "Draft",     de: "Entwurf",     fr: "Brouillon" },
  posted:    { ar: "مُرحَّلة",  en: "Posted",    de: "Gebucht",     fr: "Comptabilisée" },
  cancelled: { ar: "ملغاة",   en: "Cancelled", de: "Storniert",   fr: "Annulée" },
};

export function invoiceStatus(locale: Locale, status: string): string {
  return STATUS_LABELS[status]?.[locale] ?? status;
}

const PAYMENT_LABELS: Record<string, LocalizedString> = {
  cash:   { ar: "نقد",  en: "Cash",   de: "Bar",          fr: "Espèces" },
  credit: { ar: "آجل",  en: "Credit", de: "Auf Rechnung", fr: "À crédit" },
  bank:   { ar: "بنك",  en: "Bank",   de: "Bank",         fr: "Virement" },
};

export function paymentMethod(locale: Locale, method: string): string {
  return PAYMENT_LABELS[method]?.[locale] ?? method;
}

const ACCOUNT_TYPE_LABELS: Record<string, LocalizedString> = {
  asset:     { ar: "أصل",      en: "Asset",     de: "Aktivum",       fr: "Actif" },
  liability: { ar: "التزام",   en: "Liability", de: "Verbindlichkeit", fr: "Passif" },
  equity:    { ar: "حقوق",     en: "Equity",    de: "Eigenkapital",  fr: "Capitaux propres" },
  revenue:   { ar: "إيراد",    en: "Revenue",   de: "Ertrag",        fr: "Produit" },
  expense:   { ar: "مصروف",    en: "Expense",   de: "Aufwand",       fr: "Charge" },
};

export function accountType(locale: Locale, type: string): string {
  return ACCOUNT_TYPE_LABELS[type]?.[locale] ?? type;
}

/** Pick the right account/customer name for a locale.
 *
 *  The data model only stores `nameAr` (mandatory) and `nameEn` (optional).
 *  For non-Arabic locales we prefer the English name when present and fall
 *  back to the Arabic name; an English-fluent reader will recognise it
 *  even if their UI is in German or French, which is better than rendering
 *  nothing or a placeholder. */
export function pickName(
  locale: Locale,
  nameAr: string | null | undefined,
  nameEn?: string | null,
): string {
  if (locale === "ar") return (nameAr || nameEn || "").toString();
  return (nameEn || nameAr || "").toString();
}

/** Locale-correct date formatter. Using Intl.DateTimeFormat keeps month
 *  names and ordering culturally appropriate without us shipping our own
 *  month tables. Falls back to ISO if the input isn't a parsable date. */
export function formatLocaleDate(locale: Locale, value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const tag = locale === "ar" ? "ar-EG" : locale === "de" ? "de-DE" : locale === "fr" ? "fr-FR" : "en-US";
  return new Intl.DateTimeFormat(tag, { year: "numeric", month: "short", day: "numeric" }).format(d);
}
