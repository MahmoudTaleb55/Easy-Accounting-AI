import { useQuery } from "@tanstack/react-query";

export type BusinessType = "service" | "trading" | "manufacturing";

export interface OrgSettings {
  id: number;
  orgName: string;
  countryCode: string;
  locale: string;
  currencyCode: string;
  currencySymbol: string;
  vatRate: string | number;
  zakatEnabled: boolean;
  fiscalYearStartMonth: number;
  // Drives which sections appear in the income statement. A service workspace
  // hides the COGS block; trading/manufacturing keep it. Defaults to
  // "service" so an unconfigured client never accidentally surfaces a COGS
  // section that the owner did not opt into.
  businessType: BusinessType;
}

const DEFAULTS: OrgSettings = {
  id: 1, orgName: "My Business", countryCode: "INTL", locale: "en",
  currencyCode: "USD", currencySymbol: "$", vatRate: 0, zakatEnabled: false, fiscalYearStartMonth: 1,
  businessType: "service",
};

// Map each supported UI locale to a proper Intl locale tag so numbers format
// correctly per locale (e.g. German/French use "." for thousands and "," for
// decimals). Falls back to en-US for anything unexpected.
const INTL_LOCALE: Record<string, string> = {
  ar: "ar-SA",
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
};

export interface FormatMoneyOptions {
  decimals?: number;
  symbol?: boolean;
}

export function useSettings() {
  const { data } = useQuery<OrgSettings>({ queryKey: ["/api/settings"] });
  return data || DEFAULTS;
}

export function formatMoney(
  n: number | string | null | undefined,
  settings: OrgSettings,
  opts: FormatMoneyOptions = {},
): string {
  const decimals = opts.decimals ?? 0;
  const showSymbol = opts.symbol ?? true;
  const v = Number(n || 0);
  const locale = INTL_LOCALE[settings.locale] ?? "en-US";
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v);
  if (!showSymbol) return formatted;
  return settings.locale === "ar"
    ? `${formatted} ${settings.currencySymbol}`
    : `${settings.currencySymbol} ${formatted}`;
}

export function useFormatMoney() {
  const settings = useSettings();
  return (n: number | string | null | undefined, opts?: FormatMoneyOptions) =>
    formatMoney(n, settings, opts);
}
