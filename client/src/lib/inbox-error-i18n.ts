/**
 * Centralised localisation for Smart Inbox extraction error messages.
 *
 * The server (`server/services/document-extraction.ts` →
 * `DocumentExtractionError`) persists a stable machine-readable code in
 * `documents.errorMessage` instead of free-form text whenever it can.
 * This module maps those codes to friendly, locale-specific copy.
 *
 * Codes are deliberately a closed set so we never silently render a
 * server-controlled string. Anything not in the set is shown with a
 * generic localized fallback plus the raw text underneath, which keeps
 * us safe from prompt-injection-style content showing up in the UI but
 * still gives the user something to copy/paste into a support request.
 *
 * See task #345.
 */

import type { Locale } from "@/contexts/locale-context";

/**
 * Stable codes the server may emit. Keep in sync with
 * `ExtractionErrorCode` in `server/services/document-extraction.ts`.
 */
export type InboxErrorCode = "unsupported_language" | "ai_not_configured";

const KNOWN_CODES: ReadonlySet<string> = new Set<InboxErrorCode>([
  "unsupported_language",
  "ai_not_configured",
]);

type ErrorCopy = {
  /** Bold heading shown in the destructive callout. */
  title: string;
  /** Body explanation of what happened. */
  body: string;
  /** Suggested next action shown beneath the body, dimmer. */
  hint: string;
};

const FALLBACK_TITLE: Record<Locale, string> = {
  ar: "تعذّر قراءة المستند",
  en: "Couldn't read this document",
  de: "Dokument konnte nicht gelesen werden",
  fr: "Impossible de lire ce document",
};

const FALLBACK_HINT: Record<Locale, string> = {
  ar: "جرب صورة أوضح أو ملف أقل حجماً.",
  en: "Try a clearer image or a smaller file.",
  de: "Versuchen Sie es mit einem schärferen Bild oder einer kleineren Datei.",
  fr: "Essayez une image plus nette ou un fichier plus petit.",
};

const COPY: Record<InboxErrorCode, Record<Locale, ErrorCopy>> = {
  unsupported_language: {
    ar: {
      title: "لغة المستند غير مدعومة",
      body: "ندعم حالياً المستندات بالعربية والإنجليزية والألمانية والفرنسية فقط.",
      hint: "حاول رفع نسخة PDF الأصلية أو ترجم المستند إلى إحدى اللغات المدعومة.",
    },
    en: {
      title: "Unsupported document language",
      body: "We currently support documents in Arabic, English, German, and French only.",
      hint: "Try uploading the original PDF or a version translated into one of the supported languages.",
    },
    de: {
      title: "Nicht unterstützte Dokumentsprache",
      body: "Derzeit werden nur Dokumente auf Arabisch, Englisch, Deutsch und Französisch unterstützt.",
      hint: "Laden Sie das Original-PDF hoch oder eine in einer der unterstützten Sprachen übersetzte Version.",
    },
    fr: {
      title: "Langue de document non prise en charge",
      body: "Nous prenons actuellement en charge uniquement les documents en arabe, anglais, allemand et français.",
      hint: "Essayez de téléverser le PDF original ou une version traduite dans l'une des langues prises en charge.",
    },
  },
  ai_not_configured: {
    ar: {
      title: "لم يتم إعداد الاستخراج بالذكاء الاصطناعي",
      body: "لم يتم إعداد استخراج المستندات بالذكاء الاصطناعي (مفتاح OpenAI API مفقود). تم رفع المستند؛ أضف OPENAI_API_KEY لتفعيل القراءة التلقائية.",
      hint: "اطلب من المسؤول ضبط OPENAI_API_KEY ثم أعد رفع المستند.",
    },
    en: {
      title: "AI extraction not configured",
      body: "AI document extraction isn't configured (missing OpenAI API key). The document was uploaded; add OPENAI_API_KEY to enable automatic reading.",
      hint: "Ask your administrator to set OPENAI_API_KEY, then re-upload.",
    },
    de: {
      title: "KI-Extraktion nicht konfiguriert",
      body: "Die KI-Dokumentenextraktion ist nicht konfiguriert (OpenAI-API-Schlüssel fehlt). Das Dokument wurde hochgeladen; fügen Sie OPENAI_API_KEY hinzu, um das automatische Lesen zu aktivieren.",
      hint: "Bitten Sie Ihren Administrator, OPENAI_API_KEY zu setzen, und laden Sie das Dokument erneut hoch.",
    },
    fr: {
      title: "Extraction par IA non configurée",
      body: "L'extraction de documents par IA n'est pas configurée (clé API OpenAI manquante). Le document a été téléversé ; ajoutez OPENAI_API_KEY pour activer la lecture automatique.",
      hint: "Demandez à votre administrateur de définir OPENAI_API_KEY, puis téléversez à nouveau.",
    },
  },
};

export function isKnownInboxErrorCode(value: string): value is InboxErrorCode {
  return KNOWN_CODES.has(value);
}

/**
 * Detected document language values that the inbox can render as a badge.
 * Mirrors `extractedDocumentSchema.language` in `shared/schema.ts` plus a
 * permissive `unknown` fallback for legacy rows without a language field.
 */
export type DetectedLanguage = "ar" | "en" | "de" | "fr" | "mixed";

const LANGUAGE_LABELS: Record<DetectedLanguage, Record<Locale, string>> = {
  ar: { ar: "العربية", en: "Arabic", de: "Arabisch", fr: "Arabe" },
  en: { ar: "الإنجليزية", en: "English", de: "Englisch", fr: "Anglais" },
  de: { ar: "الألمانية", en: "German", de: "Deutsch", fr: "Allemand" },
  fr: { ar: "الفرنسية", en: "French", de: "Französisch", fr: "Français" },
  mixed: { ar: "مختلط", en: "Mixed", de: "Gemischt", fr: "Mixte" },
};

/**
 * Localised human label for a detected document language. Returns `null`
 * for missing / non-conforming inputs so callers can simply hide the
 * badge for legacy rows that predate task #345.
 */
export function detectedLanguageLabel(
  language: string | null | undefined,
  locale: Locale,
): string | null {
  if (!language) return null;
  if (!(language in LANGUAGE_LABELS)) return null;
  const key = language as DetectedLanguage;
  return LANGUAGE_LABELS[key][locale] ?? LANGUAGE_LABELS[key].en;
}

/**
 * Resolve the error block copy for a given persisted `errorMessage`
 * value and UI locale. Falls back to a generic localized message with
 * the raw server text shown verbatim underneath.
 */
export function resolveInboxError(
  errorMessage: string | null | undefined,
  locale: Locale,
): { title: string; body: string; hint: string } {
  const raw = (errorMessage ?? "").trim();
  if (raw && isKnownInboxErrorCode(raw)) {
    return COPY[raw][locale] ?? COPY[raw].en;
  }
  return {
    title: FALLBACK_TITLE[locale] ?? FALLBACK_TITLE.en,
    body: raw || FALLBACK_TITLE[locale],
    hint: FALLBACK_HINT[locale] ?? FALLBACK_HINT.en,
  };
}
