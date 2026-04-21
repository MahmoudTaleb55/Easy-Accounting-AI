import { useMemo } from "react";
import { Link } from "wouter";
import { useTransactions } from "@/hooks/use-transactions";
import { usePeriod } from "@/contexts/period-context";
import { useT } from "@/i18n/dict";
import { useFormatMoney } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/contexts/locale-context";

export function CategoryList() {
  const t = useT();
  const fmt = useFormatMoney();
  const { period } = usePeriod();
  const { dir } = useLocale();
  const { data: txs, isLoading } = useTransactions();

  const rows = useMemo(() => {
    const map = new Map<string, number>();
    (txs || [])
      .filter((tx) => tx.type === "expense" && tx.date)
      .filter((tx) => { const d = new Date(tx.date!); return d >= period.start && d <= period.end; })
      .forEach((tx) => map.set(tx.category, (map.get(tx.category) || 0) + Number(tx.amount)));
    const arr = Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
    const max = arr[0]?.value || 1;
    return arr.map((r) => ({ ...r, pct: (r.value / max) * 100 }));
  }, [txs, period]);

  if (isLoading) return <Skeleton className="h-72 rounded-md" />;

  return (
    <section className="border border-border bg-card rounded-md flex flex-col" data-testid="category-list">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold tracking-tight">{t("categories_title")}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{t("kpi_expenses")}</p>
      </div>
      <div className="flex-1 px-4 py-3">
        {rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground py-12">
            {t("no_categories")}
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.name}>
                <Link
                  href={`/app/transactions?category=${encodeURIComponent(r.name)}`}
                  className="block group"
                  data-testid={`category-row-${r.name}`}
                >
                  <div className="flex items-baseline justify-between text-xs mb-1">
                    <span className="font-medium text-foreground truncate">{r.name}</span>
                    <span className="tabular-nums text-muted-foreground group-hover:text-foreground transition-colors">
                      {fmt(r.value)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary/80 group-hover:bg-primary transition-colors rounded-full"
                      style={{
                        width: `${r.pct}%`,
                        marginInlineStart: 0,
                      }}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
