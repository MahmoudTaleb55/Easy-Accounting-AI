import { format } from "date-fns";
import { ar, enUS, de, fr } from "date-fns/locale";
import { Locate } from "lucide-react";
import { usePeriod, type PeriodKey } from "@/contexts/period-context";
import { useLocale } from "@/contexts/locale-context";
import { useT } from "@/i18n/dict";
import { usePeriodEmptinessHint } from "@/hooks/use-period-emptiness";
import { useFormatMoney } from "@/lib/format";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PeriodChipProps {
  showCompare?: boolean;
  className?: string;
}

/**
 * Compact period chip for in-page headers.
 * Mirrors the dashboard PeriodBar — selector + range + optional compare toggle —
 * but as a single inline pill so it can sit next to a page title and actions.
 *
 * When the workspace has zero postings inside the active range but has
 * postings elsewhere, the chip surfaces a small "jump to nearest
 * posting" arrow so users don't have to open a per-account drawer to
 * discover the active period is empty (Task #320). The hint reuses the
 * same helper and `setPeriodToInclude` jump as the per-account empty
 * state in `chart-of-accounts.tsx`.
 */
export function PeriodChip({ showCompare = true, className = "" }: PeriodChipProps) {
  const { period, setPeriodKey, setPeriodToInclude, compareToPrevious, setCompareToPrevious } = usePeriod();
  const { locale } = useLocale();
  const t = useT();
  const intl = locale === "ar" ? "ar-SA" : "en-US";
  const start = period.start.toLocaleDateString(intl, { month: "short", day: "numeric" });
  const end = period.end.toLocaleDateString(intl, { month: "short", day: "numeric", year: "numeric" });

  const hint = usePeriodEmptinessHint(period, locale === "ar");
  const dfLocale =
    locale === "ar" ? ar : locale === "de" ? de : locale === "fr" ? fr : enUS;
  const formatMoney = useFormatMoney();
  const jumpAriaLabel = hint.nearest
    ? `${
        hint.nearest.side === "past"
          ? t("period_jump_past")
          : t("period_jump_future")
      } (${format(hint.nearest.date, "d MMM yyyy", { locale: dfLocale })})`
    : "";
  // Compose the one-line "what am I about to land on?" preview from
  // the fields the hook resolved (Task #367). Each segment is omitted
  // independently so a JE missing a description or with an unresolved
  // account never renders an empty `· ·` gap. The amount is formatted
  // through the workspace currency settings so it matches every other
  // money figure on the dashboard.
  const previewSegments = hint.nearest
    ? [
        hint.nearest.accountName,
        hint.nearest.reference,
        hint.nearest.amount != null && hint.nearest.amount > 0
          ? formatMoney(hint.nearest.amount)
          : "",
      ].filter(Boolean)
    : [];
  const previewLine = previewSegments.join(" · ");
  const jumpAriaLabelWithPreview = previewLine
    ? `${jumpAriaLabel} — ${previewLine}`
    : jumpAriaLabel;

  return (
    <div
      className={`inline-flex items-center gap-2.5 h-9 rounded-md border border-border bg-card px-2.5 ${className}`}
      data-testid="period-chip"
    >
      <select
        value={period.key}
        onChange={(e) => setPeriodKey(e.target.value as PeriodKey)}
        className="bg-transparent text-xs font-medium text-foreground focus:outline-none cursor-pointer pe-1"
        aria-label={t("period_month")}
        data-testid="select-period-chip"
      >
        <option value="today">{t("period_today")}</option>
        <option value="week">{t("period_week")}</option>
        <option value="month">{t("period_month")}</option>
        <option value="quarter">{t("period_quarter")}</option>
        <option value="ytd">{t("period_ytd")}</option>
        <option value="30d">{t("period_30d")}</option>
        {/* "custom" is set programmatically by setPeriodToInclude when
            no preset window covers the target date (e.g. jumping to a
            posting in a different calendar year). The option is hidden
            from the dropdown — selecting any visible preset clears it
            again — but kept in the option list so React doesn't warn
            about an unknown <select value>. */}
        {period.key === "custom" && (
          <option value="custom" hidden>
            {t("period_custom")}
          </option>
        )}
      </select>
      <span className="hairline-v hidden sm:inline-block h-4" />
      <span
        className="hidden sm:inline text-xs text-muted-foreground tabular-nums whitespace-nowrap"
        data-testid="text-period-chip-range"
      >
        {start} <span className="text-muted-foreground/60 mx-0.5">–</span> {end}
      </span>
      {hint.isEmpty && hint.nearest && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setPeriodToInclude(hint.nearest!.date)}
              aria-label={jumpAriaLabelWithPreview}
              title={jumpAriaLabelWithPreview}
              className="inline-flex items-center justify-center h-6 w-6 rounded text-warning hover-elevate -mx-1"
              data-testid="button-period-chip-jump-nearest"
            >
              <Locate className="size-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-xs text-xs">
            <div className="font-medium">{t("period_empty_hint_short")}</div>
            <div className="text-muted-foreground mt-0.5">{jumpAriaLabel}</div>
            {previewLine && (
              <div
                className="text-foreground/90 mt-1 truncate"
                data-testid="text-period-chip-jump-preview"
              >
                {previewLine}
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      )}
      {showCompare && (
        <>
          <span className="hairline-v hidden md:inline-block h-4" />
          <label
            className="hidden md:inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
            data-testid="label-page-compare"
          >
            <input
              type="checkbox"
              checked={compareToPrevious}
              onChange={(e) => setCompareToPrevious(e.target.checked)}
              className="accent-primary"
            />
            {t("compare_prev")}
          </label>
        </>
      )}
    </div>
  );
}
