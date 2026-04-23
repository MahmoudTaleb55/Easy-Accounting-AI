import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Locale = "ar" | "en" | "de" | "fr";
export type Direction = "rtl" | "ltr";

export const LOCALES: Locale[] = ["ar", "en", "de", "fr"];

export const LOCALE_LABELS: Record<Locale, { native: string; en: string }> = {
  ar: { native: "العربية", en: "Arabic" },
  en: { native: "English", en: "English" },
  de: { native: "Deutsch", en: "German" },
  fr: { native: "Français", en: "French" },
};

type LocaleContextValue = {
  locale: Locale;
  dir: Direction;
  setLocale: (l: Locale) => void;
  toggleLocale: () => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

const STORAGE_KEY = "app.locale";

function dirFor(locale: Locale): Direction {
  // Only Arabic is RTL among the four supported languages.
  return locale === "ar" ? "rtl" : "ltr";
}

function isLocale(v: unknown): v is Locale {
  return v === "ar" || v === "en" || v === "de" || v === "fr";
}

export function LocaleProvider({ children, defaultLocale = "ar" as Locale }: { children: React.ReactNode; defaultLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") return defaultLocale;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : defaultLocale;
  });

  const dir = dirFor(locale);

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("dir", dir);
    html.setAttribute("lang", locale);
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {}
  }, [locale, dir]);

  const setLocale = useCallback((l: Locale) => setLocaleState(l), []);
  const toggleLocale = useCallback(
    () =>
      setLocaleState((p) => {
        const idx = LOCALES.indexOf(p);
        return LOCALES[(idx + 1) % LOCALES.length];
      }),
    [],
  );

  const value = useMemo(() => ({ locale, dir, setLocale, toggleLocale }), [locale, dir, setLocale, toggleLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within a LocaleProvider");
  return ctx;
}
