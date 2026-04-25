/**
 * Public-surface currency resolution.
 *
 * The marketing landing + auth shell pages render before the user has a
 * server session, so we can't pull the active org's currency from
 * `/api/settings` (it 401s for guests). To still honour the currency the
 * user has configured for their workspace, the Settings save mutation
 * mirrors the chosen `currencyCode / currencySymbol` to localStorage,
 * and these helpers read that mirror.
 *
 * Resolution order:
 *   1. localStorage["app.currency"] (JSON `{code, symbol}`) — written by
 *      the Settings page on every successful save.
 *   2. Locale-based default — Arabic gets "ر.س", everything else "SAR".
 *      We default to SAR (not the locale's regional currency) because
 *      this app's primary market is MENA and the marketing copy is
 *      written in SAR-denominated examples.
 */
import { useEffect, useState } from "react";
import type { Locale } from "@/contexts/locale-context";

const STORAGE_KEY = "app.currency";

export interface PublicCurrency {
  code: string;
  symbol: string;
}

function defaultFor(locale: Locale): PublicCurrency {
  return locale === "ar"
    ? { code: "SAR", symbol: "ر.س" }
    : { code: "SAR", symbol: "SAR" };
}

function readStorage(): PublicCurrency | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PublicCurrency>;
    if (parsed && typeof parsed.code === "string" && typeof parsed.symbol === "string") {
      return { code: parsed.code, symbol: parsed.symbol };
    }
  } catch {
    /* corrupt storage — ignore */
  }
  return null;
}

/**
 * Persist the currently-saved currency for later guest reads. Called by
 * the Settings page right after a successful PATCH.
 */
export function savePublicCurrency(c: PublicCurrency): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: c.code, symbol: c.symbol }));
    window.dispatchEvent(new CustomEvent("app-currency-change"));
  } catch {
    /* storage may be disabled — no-op */
  }
}

/**
 * Read the currently-displayed public currency. Reactive: re-renders when
 * the Settings page calls `savePublicCurrency`, or another tab updates
 * the same key.
 */
export function usePublicCurrency(locale: Locale): PublicCurrency {
  const [value, setValue] = useState<PublicCurrency>(() => readStorage() ?? defaultFor(locale));
  useEffect(() => {
    setValue(readStorage() ?? defaultFor(locale));
    const onChange = () => setValue(readStorage() ?? defaultFor(locale));
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === STORAGE_KEY) onChange();
    };
    window.addEventListener("app-currency-change", onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("app-currency-change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [locale]);
  return value;
}
