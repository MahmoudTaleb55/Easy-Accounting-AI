import { cn } from "@/lib/utils"

/**
 * Brand — typographic wordmark for محاسب ذكي.
 * Pure type, no icon-in-circle. The mark IS the typography.
 *
 *   محاسب · ذكي
 *
 * The middot is a hairline separator (a deliberate accent),
 * the second word is set in the brand emerald.
 */
interface BrandProps {
  className?: string
  size?: "sm" | "md" | "lg"
  withTagline?: boolean
  /** Where the wordmark links to. Defaults to "/" (public landing). */
  href?: string
}

const sizeMap = {
  sm: { mark: "text-base", tag: "text-2xs" },
  md: { mark: "text-lg",  tag: "text-2xs" },
  lg: { mark: "text-2xl", tag: "text-xs"  },
} as const

export function Brand({ className, size = "md", withTagline = false, href = "/" }: BrandProps) {
  const s = sizeMap[size]
  return (
    <a
      href={href}
      data-testid="link-brand"
      className={cn(
        "inline-flex flex-col items-start gap-0.5 group select-none",
        className
      )}
    >
      <div className={cn("flex items-baseline gap-1.5 font-semibold tracking-tight text-foreground", s.mark)}>
        <span>محاسب</span>
        <span className="inline-block w-1 h-1 rounded-full bg-primary translate-y-[-0.18em]" aria-hidden />
        <span className="text-primary">ذكي</span>
      </div>
      {withTagline && (
        <span className={cn("eyebrow", s.tag)}>Accounting OS</span>
      )}
    </a>
  )
}
