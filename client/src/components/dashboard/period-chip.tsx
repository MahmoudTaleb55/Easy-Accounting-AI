import { usePeriod, type PeriodKey } from "@/contexts/period-context";
import { useLocale } from "@/contexts/locale-context";
import { useT } from "@/i18n/dict";

interface PeriodChipProps {
  showCompare?: boolean;
  className?: string;
}

/**
 * Compact period chip for in-page headers.
 * Mirrors the dashboard PeriodBar — selector + range + optional compare toggle —
 * but as a single inline pill so it can sit next to a page title and actions.
 */
export function PeriodChip({ showCompare = true, className = "" }: PeriodChipProps) {
  const { period, setPeriodKey, compareToPrevious, setCompareToPrevious } = usePeriod();
  const { locale } = useLocale();
  const t = useT();
  const intl = locale === "ar" ? "ar-SA" : "en-US";
  const start = period.start.toLocaleDateString(intl, { month: "short", day: "numeric" });
  const end = period.end.toLocaleDateString(intl, { month: "short", day: "numeric", year: "numeric" });

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
      </select>
      <span className="hairline-v hidden sm:inline-block h-4" />
      <span
        className="hidden sm:inline text-xs text-muted-foreground tabular-nums whitespace-nowrap"
        data-testid="text-period-chip-range"
      >
        {start} <span className="text-muted-foreground/60 mx-0.5">–</span> {end}
      </span>
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
