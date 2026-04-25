import { Link } from "wouter"
import { useLocale } from "@/contexts/locale-context"
import type { JournalEntrySourceLink } from "@shared/schema"

// Localised month name (Arabic + English) used inside the badge body so
// "From: Payroll Nov 2025" reads naturally in both locales.
const MONTH_NAMES_AR = [
  "يناير","فبراير","مارس","أبريل","مايو","يونيو",
  "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر",
]
const MONTH_NAMES_EN = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
]

// Renders a small "From: Payroll Nov 2025" badge that deep-links back to the
// originating row (payroll run, depreciation run, or fixed-asset event).
//
// The parent is responsible for hiding this when `link` is absent — i.e. when
// the source row no longer exists. `server/storage.ts` already returns
// `sourceLink: undefined` in that case, so any caller can simply do
// `je.sourceLink && <SourceLinkBadge link={je.sourceLink} />`.
//
// `surface` lets reused contexts (the JE detail dialog, the admin-activity
// feed, …) opt into a distinct test-id so two badges for the same source
// don't collide in the DOM when both are visible at the same time.
export function SourceLinkBadge({
  link,
  surface,
}: {
  link: JournalEntrySourceLink
  surface?: string
}) {
  const { locale } = useLocale()
  const months = locale === "ar" ? MONTH_NAMES_AR : MONTH_NAMES_EN

  const fromPrefix = locale === "ar" ? "من:" : "From:"
  const aria = locale === "ar" ? "فتح المصدر" : "Open source"

  const labelBody = (() => {
    if (link.kind === "payroll_run" && link.period) {
      const word = locale === "ar" ? "كشف رواتب" : "Payroll"
      return `${word} ${months[link.period.month - 1]} ${link.period.year}`
    }
    if (link.kind === "depreciation_run" && link.period) {
      const word = locale === "ar" ? "إهلاك" : "Depreciation"
      return `${word} ${months[link.period.month - 1]} ${link.period.year}`
    }
    const kindLabel =
      link.kind === "impairment"
        ? (locale === "ar" ? "انخفاض قيمة" : "Impairment")
        : link.kind === "revaluation"
        ? (locale === "ar" ? "إعادة تقييم" : "Revaluation")
        : (locale === "ar" ? "استبعاد" : "Disposal")
    const assetTag = link.assetCode || link.assetName
    return assetTag ? `${kindLabel} — ${assetTag}` : kindLabel
  })()

  const testId = surface
    ? `link-je-source-${surface}-${link.kind}-${link.id}`
    : `link-je-source-${link.kind}-${link.id}`

  return (
    <Link
      href={link.href}
      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted hover:border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={`${fromPrefix} ${labelBody}`}
      aria-label={aria}
      data-testid={testId}
    >
      <span className="text-muted-foreground">{fromPrefix}</span>
      <span>{labelBody}</span>
    </Link>
  )
}
