import { useQuery } from "@tanstack/react-query";

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
}

const DEFAULTS: OrgSettings = {
  id: 1, orgName: "My Business", countryCode: "INTL", locale: "ar",
  currencyCode: "USD", currencySymbol: "$", vatRate: 0, zakatEnabled: false, fiscalYearStartMonth: 1,
};

export function useSettings() {
  const { data } = useQuery<OrgSettings>({ queryKey: ["/api/settings"] });
  return data || DEFAULTS;
}

export function formatMoney(n: number | string | null | undefined, settings: OrgSettings): string {
  const v = Number(n || 0);
  const locale = settings.locale === "ar" ? "ar-SA" : "en-US";
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v);
  return settings.locale === "ar"
    ? `${formatted} ${settings.currencySymbol}`
    : `${settings.currencySymbol} ${formatted}`;
}

export function useFormatMoney() {
  const settings = useSettings();
  return (n: number | string | null | undefined) => formatMoney(n, settings);
}
