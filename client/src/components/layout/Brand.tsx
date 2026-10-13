import { cn } from "@/lib/utils"
import { BrandMark } from "@/components/brand/mark"
import { useT } from "@/i18n/dict"

/**
 * Brand — typographic wordmark logo for Orqam.
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
  const t = useT()
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
         * Orqam ("numbers") wordmark logo. A single word; the accent
         * dot after the first glyph is the brand's signature "spark" beat.
         * Direction is governed by the document-level `<html dir>`.
         */}
        <bdi className={cn("flex items-baseline font-serif font-semibold tracking-tight text-foreground", s.mark)}>
          <span>{t("brand")}</span>
          <span className="inline-block w-1.5 h-1.5 rounded-full translate-y-[-0.1em] ms-0.5" style={{ background: "hsl(var(--luxe))" }} aria-hidden />
        </bdi>
        {withTagline && (
          <span className={cn("eyebrow", s.tag)}>{t("layout_accounting_os")}</span>
        )}
      </div>
    </a>
  )
}
