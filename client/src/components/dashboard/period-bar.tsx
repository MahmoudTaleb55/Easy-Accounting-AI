import { useEffect, useState } from "react";
import { usePeriod } from "@/contexts/period-context";
import { useLocale } from "@/contexts/locale-context";
import { useT } from "@/i18n/dict";
import { useFormatMoney, useSettings } from "@/lib/format";
import { CircleDot } from "lucide-react";

export function PeriodBar() {
  const { period, compareToPrevious, setCompareToPrevious } = usePeriod();
  const { dir, locale } = useLocale();
  const t = useT();
  const settings = useSettings();
  const intl = locale === "ar" ? "ar-SA" : "en-US";
  const start = period.start.toLocaleDateString(intl, { month: "short", day: "numeric" });
  const end = period.end.toLocaleDateString(intl, { month: "short", day: "numeric", year: "numeric" });

  const [pulse, setPulse] = useState(false);
  const [syncedAgo, setSyncedAgo] = useState("0m");
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => {
      const mins = Math.floor((Date.now() - t0) / 60000);
      setSyncedAgo(mins === 0 ? (locale === "ar" ? "الآن" : "now") : `${mins}m`);
    }, 30000);
    return () => clearInterval(id);
  }, [locale]);
  useEffect(() => {
    setPulse(true);
    const id = setTimeout(() => setPulse(false), 900);
    return () => clearTimeout(id);
  }, [period.key]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-1" data-testid="period-bar">
      <div className="flex items-center gap-3 min-w-0">
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {dir === "rtl" ? "اللوحة الرئيسية" : "Dashboard"}
        </div>
        <span className="hairline-v hidden md:inline-block h-4" />
        <div className="text-sm font-medium text-foreground tabular-nums" data-testid="text-period-range">
          {start} <span className="text-muted-foreground mx-1">–</span> {end}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="hidden md:flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none" data-testid="label-compare">
          <input
            type="checkbox"
            checked={compareToPrevious}
            onChange={(e) => setCompareToPrevious(e.target.checked)}
            className="accent-primary"
          />
          {t("compare_prev")}
        </label>
        <span className="hairline-v hidden md:inline-block h-4" />
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5" title={t("currency_label")}>
          <span className="font-mono uppercase tracking-wider">{settings.currencyCode}</span>
        </div>
        <span className="hairline-v hidden md:inline-block h-4" />
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <CircleDot className={`w-3 h-3 ${pulse ? "text-success" : "text-success/60"}`} />
          <span>{t("synced")} {syncedAgo}</span>
        </div>
      </div>
    </div>
  );
}
