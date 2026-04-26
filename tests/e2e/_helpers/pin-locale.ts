import type { Page } from "@playwright/test";

/**
 * Locales the SPA recognises end-to-end. Mirrors `SUPPORTED_LOCALES` in
 * `client/src/components/layout/main-layout.tsx` and the `isLocale`
 * predicate in `client/src/contexts/locale-context.tsx` so an unknown
 * value would be rejected (silently ignored by `getUrlLocaleOverride`)
 * instead of leaving the test rendering in whatever locale `localStorage`
 * happened to hold. Kept inline so this helper stays self-contained for
 * Playwright's loader and pulls in zero browser-only modules.
 */
const PINNED_LOCALES = ["ar", "en", "de", "fr"] as const;
export type PinnedLocale = (typeof PINNED_LOCALES)[number];

export interface GotoWithPinnedLocaleOptions {
  /** Locale to pin via the `?lang=` URL parameter. Defaults to `'en'`. */
  locale?: PinnedLocale;
}

/**
 * Navigate to `route` while pinning the SPA locale via the `?lang=<locale>`
 * URL override.
 *
 * Why the URL override (and not just `localStorage["app.locale"]`):
 * `LocaleSync` (in `client/src/components/layout/main-layout.tsx`) reads
 * the signed-in user's `preferredLocale` from `/api/auth/user` once the
 * auth query resolves and calls `setLocale()` with it, which would
 * clobber any `addInitScript`-seeded `localStorage` value moments after
 * first paint. The `?lang=` override is honoured by both
 * `LocaleProvider`'s initializer AND `LocaleSync`'s early-return guard
 * (`getUrlLocaleOverride` consumers), so the locale stays pinned for
 * the lifetime of the page even when the signed-in user's stored
 * `preferred_locale` is something else (e.g. the dedicated owners in
 * the email-delivery-alerts / delivery-alert-audit suites are pinned to
 * `'ar'` precisely so this URL override is the load-bearing piece for
 * their English-string assertions).
 *
 * Theme is still safe to seed via `localStorage` because nothing
 * reconciles it from the server.
 *
 * Routing every locale-dependent spec through this helper documents
 * the pattern in one place — a future regression in either guard
 * (`LocaleProvider` initializer or `LocaleSync` early-return) would
 * fail loudly here instead of silently falling back to the older,
 * weaker `addInitScript("app.locale", ...)` seed that relied on the
 * implicit `HAD_PRELOADED_LOCALE` snapshot in `main-layout.tsx`.
 */
export async function gotoWithPinnedLocale(
  page: Page,
  route: string = "/app",
  options: GotoWithPinnedLocaleOptions = {},
): Promise<void> {
  const locale = options.locale ?? "en";
  if (!(PINNED_LOCALES as readonly string[]).includes(locale)) {
    throw new Error(
      `gotoWithPinnedLocale: locale '${locale}' is not one of the SPA's ` +
        `supported locales (${PINNED_LOCALES.join(" | ")}). See ` +
        `getUrlLocaleOverride in client/src/contexts/locale-context.tsx — ` +
        `unknown values are silently dropped, which would leave the test ` +
        `rendering in whatever locale localStorage happened to hold.`,
    );
  }
  await page.addInitScript(() => {
    window.localStorage.setItem("app.theme", "light");
  });
  const url = appendLangParam(route, locale);
  await page.goto(url, { waitUntil: "domcontentloaded" });
}

function appendLangParam(route: string, locale: PinnedLocale): string {
  // Preserve any existing query string on the route the caller passed in
  // (e.g. `/app/foo?bar=1` should become `/app/foo?bar=1&lang=en`).
  const sep = route.includes("?") ? "&" : "?";
  return `${route}${sep}lang=${locale}`;
}
