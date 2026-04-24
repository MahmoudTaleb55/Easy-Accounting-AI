import { useMemo } from "react";
import { Link } from "wouter";
import { useTransactions } from "@/hooks/use-dashboard-data";
import { useT } from "@/i18n/dict";
import { useFormatMoney } from "@/lib/format";
import { useLocale } from "@/contexts/locale-context";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { ArrowUpRight, ArrowDownRight, ArrowRight } from "lucide-react";
import { RecentActivitySkeleton } from "./skeletons";

export function RecentActivity() {
  const t = useT();
  const fmt = useFormatMoney();
  const { dir, locale } = useLocale();
  const { data: txs, isLoading } = useTransactions();

  const rows = useMemo(() => {
    return [...(txs || [])]
      .filter((t) => t.date)
      .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime())
      .slice(0, 8);
  }, [txs]);

  if (isLoading) return <RecentActivitySkeleton />;

  return (
    <section className="border border-border bg-card rounded-md motion-safe:animate-fade-in" data-testid="recent-activity">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold tracking-tight">{t("recent_title")}</h2>
        <Link
          href="/app/transactions"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          data-testid="link-view-all"
        >
          {t("recent_view_all")}
          <ArrowRight className={`w-3 h-3 ${dir === "rtl" ? "rotate-180" : ""}`} />
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-12 text-center text-xs text-muted-foreground">{t("empty_recent")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground border-b border-border">
                <th className="text-start font-medium px-4 py-2 w-32">{t("col_date")}</th>
                <th className="text-start font-medium px-4 py-2">{t("col_description")}</th>
                <th className="text-start font-medium px-4 py-2 w-32">{t("col_category")}</th>
                <th className="text-end font-medium px-4 py-2 w-32 tabular-nums">{t("col_amount")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tx) => (
                <tr
                  key={tx.id}
                  className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors"
                  data-testid={`row-recent-${tx.id}`}
                >
                  <td className="px-4 py-2 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {format(new Date(tx.date!), "d MMM yyyy", { locale: locale === "ar" ? ar : undefined })}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-sm shrink-0 ${
                        tx.type === "income" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                      }`}>
                        {tx.type === "income" ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      </span>
                      <span className="text-foreground truncate">{tx.description}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-xs text-muted-foreground">{tx.category}</span>
                  </td>
                  <td className={`px-4 py-2 text-end tabular-nums font-medium whitespace-nowrap ${
                    tx.type === "income" ? "text-success" : "text-destructive"
                  }`}>
                    {tx.type === "income" ? "+" : "−"}{fmt(Number(tx.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
