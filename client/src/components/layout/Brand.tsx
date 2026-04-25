import { cn } from "@/lib/utils"
import { BrandMark } from "@/components/brand/mark"

/**
 * Brand — typographic wordmark for محاسب ذكي.
 *
 *   ▣  محاسب · ذكي
 *
 * Composes the signature BrandMark glyph (three stacked ledger bars
 * + accent dot) with the bilingual typographic wordmark. The middot
 * is a hairline separator and the second word is set in the brand
 * emerald — the wordmark IS the type, the glyph IS the mark.
 */
interface BrandProps {
  className?: string
  size?: "sm" | "md" | "lg"
  withTagline?: boolean
  /** Render only the typographic wordmark, no glyph. */
  glyph?: boolean
  /** Where the wordmark links to. Defaults to "/" (public landing). */
  href?: string
}

const sizeMap = {
  sm: { mark: "text-base", tag: "text-2xs", glyph: "sm" },
  md: { mark: "text-lg",  tag: "text-2xs", glyph: "sm" },
  lg: { mark: "text-2xl", tag: "text-xs",  glyph: "md" },
} as const

export function Brand({
  className,
  size = "md",
  withTagline = false,
  glyph = true,
  href = "/",
}: BrandProps) {
  const s = sizeMap[size]
  return (
    <a
      href={href}
      data-testid="link-brand"
      className={cn(
        "inline-flex items-center gap-3 group select-none",
        className
      )}
    >
      {glyph && (
        <BrandMark
          size={s.glyph as "sm" | "md"}
          className="text-foreground"
        />
      )}
      <div className="inline-flex flex-col items-start gap-0.5">
        {/*
         * The wordmark is two Arabic words separated by a dot. We keep them
         * in logical reading order (محاسب · ذكي) and let the parent's
         * direction decide the visual order via flex. In an RTL document
         * the flex naturally reverses to show محاسب on the right; in an
         * LTR document it shows محاسب on the left. Hard-coding dir="rtl"
         * here used to flip the order incorrectly when the page was
         * English, producing "ذكي محاسب".
         */}
        <bdi className={cn("flex items-baseline gap-1.5 font-semibold tracking-tight text-foreground", s.mark)}>
          <span>محاسب</span>
          <span className="inline-block w-1.5 h-1.5 rounded-full translate-y-[-0.18em]" style={{ background: "hsl(var(--luxe))" }} aria-hidden />
          <span className="text-foreground/85">ذكي</span>
        </bdi>
        {withTagline && (
          <span className={cn("eyebrow", s.tag)}>Accounting OS</span>
        )}
      </div>
    </a>
  )
}
