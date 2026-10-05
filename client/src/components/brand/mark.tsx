import { cn } from "@/lib/utils";

interface BrandMarkProps {
  className?: string;
  /** Render the wordmark next to the glyph. */
  withWordmark?: boolean;
  /** ar | en wordmark, defaults to en if not provided */
  locale?: string;
  /** Tone of the spark dot. Defaults to var(--primary). */
  sparkTone?: "primary" | "info" | "accent";
  /** Visual size — controls the glyph box. */
  size?: "sm" | "md" | "lg";
  "data-testid"?: string;
}

/**
 * Orqam (أرقام) signature mark.
 *
 * Three stacked ledger bars (debit / credit / balance) of decreasing length,
 * crowned by an offset spark dot — the "ذكي / smart" beat over the ledger.
 * Monochromatic foreground + a single token-colored accent dot.
 *
 * The mark sits on the *baseline* of the wordmark when paired with text,
 * so it composes cleanly with `font-serif tracking-tight` headlines.
 */
export function BrandMark({
  className,
  withWordmark = false,
  locale = "en",
  sparkTone = "primary",
  size = "md",
  ...rest
}: BrandMarkProps) {
  const sizeClass = size === "sm" ? "h-5 w-5" : size === "lg" ? "h-9 w-9" : "h-7 w-7";
  const wordmarkSize =
    size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-xl";
  const tone =
    sparkTone === "info"
      ? "hsl(var(--info))"
      : sparkTone === "accent"
      ? "hsl(var(--accent))"
      : "hsl(var(--primary))";

  return (
    <span
      className={cn("inline-flex items-center gap-2.5 align-baseline", className)}
      data-testid={rest["data-testid"] ?? "brand-mark"}
    >
      <svg
        viewBox="0 0 24 24"
        className={cn(sizeClass, "shrink-0")}
        aria-hidden="true"
        focusable="false"
      >
        {/* Three ledger bars, decreasing length, hairline rounded */}
        <rect x="3" y="9" width="18" height="2.25" rx="1.125" fill="currentColor" />
        <rect x="3" y="13" width="13" height="2.25" rx="1.125" fill="currentColor" opacity="0.55" />
        <rect x="3" y="17" width="8" height="2.25" rx="1.125" fill="currentColor" opacity="0.3" />
        {/* Spark dot — the "smart" beat */}
        <circle cx="20" cy="5" r="2.4" fill={tone} />
      </svg>
      {withWordmark && (
        <span className={cn("font-serif font-semibold tracking-tight leading-none", wordmarkSize)}>
          {locale === "ar" ? "أرقام" : "Orqam"}
        </span>
      )}
    </span>
  );
}
