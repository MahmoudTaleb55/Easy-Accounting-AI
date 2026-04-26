/**
 * Locale parsing helpers for HTTP routes.
 *
 * Every endpoint that emits localized output (PDFs today, Word/Excel
 * tomorrow) reads the active locale through this single helper so the
 * fallback chain stays consistent: explicit `?lang=` query → request body
 * `locale` field → default to Arabic. We deliberately don't fall back to
 * `Accept-Language` because the user's UI selection (which is what the
 * frontend sends) takes precedence over what the browser advertises.
 */
import type { Request } from "express";
import { isLocale, type Locale } from "../i18n/pdf-strings";

export type { Locale };

const DEFAULT_LOCALE: Locale = "ar";

export function parseLangParam(req: Request): Locale {
  const fromQuery = req.query?.lang;
  if (typeof fromQuery === "string" && isLocale(fromQuery)) return fromQuery;
  const fromBody = (req.body && typeof req.body === "object") ? (req.body as Record<string, unknown>).locale : undefined;
  if (typeof fromBody === "string" && isLocale(fromBody)) return fromBody;
  return DEFAULT_LOCALE;
}
