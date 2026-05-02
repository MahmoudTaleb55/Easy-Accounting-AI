import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Layers,
  Package,
  Plus,
  TrendingUp,
} from "lucide-react";
import { useT } from "@/i18n/dict";
import { useLocale } from "@/contexts/locale-context";
import { useFormatMoney } from "@/lib/format";
import { dashboardKeys } from "@/hooks/use-dashboard-data";
import { InventorySummarySkeleton } from "./skeletons";

type ValRow = {
  productId: number;
  productSku: string;
  productNameAr: string;
  productNameEn: string | null;
  unit: string;
  costingMethod: "fifo" | "avg";
  totalQty: string;
  totalValue: string;
};
type ValReport = { rows: ValRow[]; grandTotalQty: string; grandTotalValue: string };

type AlertRow = {
  productId: number;
  sku: string;
  nameAr: string;
  nameEn: string | null;
  unit: string;
  minimumStock: string;
  totalQty: string;
};

type InvTxnType = "purchase" | "sale" | "adjustment" | "transfer";
type InvTxn = {
  id: number;
  number: string;
  type: InvTxnType;
  txnDate: string;
};

const TXN_TYPES: InvTxnType[] = ["purchase", "sale", "adjustment", "transfer"];

const TYPE_TONE: Record<InvTxnType, { dot: string; bar: string }> = {
  purchase:   { dot: "bg-success",      bar: "bg-success/80" },
  sale:       { dot: "bg-primary",      bar: "bg-primary/80" },
  adjustment: { dot: "bg-warning",      bar: "bg-warning/80" },
  transfer:   { dot: "bg-info",         bar: "bg-info/80" },
};

function txnLabel(t: ReturnType<typeof useT>, type: InvTxnType): string {
  switch (type) {
    case "purchase":   return t("inv_purchase");
    case "sale":       return t("inv_sale");
    case "adjustment": return t("inv_adjustment");
    case "transfer":   return t("inv_transfer");
  }
}

interface StatTileProps {
  label: string;
  value: string;
  hint?: string;
  href: string;
  testid: string;
  icon: React.ReactNode;
  accent?: "default" | "warning" | "success";
}

function StatTile({ label, value, hint, href, testid, icon, accent = "default" }: StatTileProps) {
  const accentRing = accent === "warning"
    ? "border-warning/40 hover:border-warning/60"
    : accent === "success"
      ? "border-success/40 hover:border-success/60"
      : "border-border hover:border-foreground/20";
  const accentIcon = accent === "warning"
    ? "text-warning bg-warning/10"
    : accent === "success"
      ? "text-success bg-success/10"
      : "text-muted-foreground bg-muted";
  return (
    <Link href={href} className="block group" data-testid={testid}>
      <div
        className={`h-full border ${accentRing} bg-card rounded-xl p-4 transition-all hover:shadow-sm flex flex-col gap-3 min-h-[7rem]`}
      >
        <div className="flex items-center justify-between">
          <span className="eyebrow">{label}</span>
          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${accentIcon}`}>
            {icon}
          </span>
        </div>
        <div className="font-display text-2xl font-semibold tabular-nums tracking-tight leading-none text-foreground">
          {value}
        </div>
        {hint && (
          <div className="mt-auto text-xs text-muted-foreground leading-snug">{hint}</div>
        )}
      </div>
    </Link>
  );
}

export function InventorySummary() {
  const t = useT();
  const fmtMoney = useFormatMoney();
  const { dir, locale } = useLocale();
  const isAr = locale === "ar";

  const { data: valuation, isLoading: valLoading } = useQuery<ValReport>({
    queryKey: dashboardKeys.inventoryValuation,
  });
  const { data: alerts, isLoading: alertsLoading } = useQuery<AlertRow[]>({
    queryKey: dashboardKeys.inventoryAlerts,
  });
  const { data: txns, isLoading: txnsLoading } = useQuery<InvTxn[]>({
    queryKey: dashboardKeys.inventoryTransactions,
  });

  const isLoading = valLoading || alertsLoading || txnsLoading;

  const topItems = useMemo<ValRow[]>(() => {
    const rows = valuation?.rows ?? [];
    return [...rows]
      .sort((a, b) => Number(b.totalValue) - Number(a.totalValue))
      .slice(0, 5);
  }, [valuation]);

  const recent30 = useMemo(() => {
    const list = txns ?? [];
    const cutoff = Date.now() - 30 * 86_400_000;
    const filtered = list.filter((tx) => {
      const t = Date.parse(tx.txnDate);
      return Number.isFinite(t) && t >= cutoff;
    });
    const counts = TXN_TYPES.reduce<Record<InvTxnType, number>>(
      (acc, k) => ((acc[k] = 0), acc),
      {} as Record<InvTxnType, number>,
    );
    for (const tx of filtered) {
      if (counts[tx.type] != null) counts[tx.type] += 1;
    }
    const total = filtered.length;
    const max = Math.max(...Object.values(counts), 0);
    return { counts, total, max };
  }, [txns]);

  if (isLoading) {
    return <InventorySummarySkeleton />;
  }

  const totalValue = Number(valuation?.grandTotalValue ?? 0);
  const itemCount = valuation?.rows.length ?? 0;
  const lowStockCount = alerts?.length ?? 0;
  const hasAnyInventoryData =
    itemCount > 0 || lowStockCount > 0 || recent30.total > 0;

  // Empty state — no inventory data at all yet.
  if (!hasAnyInventoryData) {
    return (
      <section
        className="motion-safe:animate-fade-in"
        data-testid="inventory-summary"
      >
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold tracking-tight">{t("inv_dash_title")}</h2>
        </div>
        <Link
          href="/app/inventory/transactions?new=purchase"
          className="block group"
          data-testid="inventory-empty"
        >
          <div className="border border-dashed border-border bg-card/50 rounded-md p-6 flex items-center gap-4 transition-colors hover:border-foreground/30 hover:bg-card">
            <div className="rounded-full bg-muted p-3 shrink-0">
              <Boxes className="w-6 h-6 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold tracking-tight text-foreground">
                {t("inv_dash_setup")}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t("inv_dash_setup_hint")}
              </div>
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground border border-border rounded-md px-3 py-1.5 group-hover:bg-foreground group-hover:text-background transition-colors">
              <Plus className="w-3.5 h-3.5" />
              {t("inv_purchase")}
            </div>
          </div>
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-3 motion-safe:animate-fade-in" data-testid="inventory-summary">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold tracking-tight">{t("inv_dash_title")}</h2>
        <Link
          href="/app/inventory/items"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          data-testid="link-inventory-view-all"
        >
          {t("inv_dash_view_all")}
          <ArrowRight className={`w-3 h-3 ${dir === "rtl" ? "rotate-180" : ""}`} />
        </Link>
      </div>

      {/* Top KPI tiles */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <StatTile
          label={t("inv_total_value")}
          value={fmtMoney(totalValue)}
          hint={`${itemCount.toLocaleString(isAr ? "ar-SA" : "en-US")} ${t("inv_dash_items_label")}`}
          href="/app/inventory/valuation"
          testid="kpi-inventory-value"
          icon={<Package className="w-4 h-4" />}
          accent="success"
        />
        <StatTile
          label={t("inv_dash_low_stock")}
          value={lowStockCount.toLocaleString(isAr ? "ar-SA" : "en-US")}
          hint={lowStockCount === 0 ? t("inv_no_alerts") : t("nav_inv_alerts")}
          href="/app/inventory/alerts"
          testid="kpi-inventory-alerts"
          icon={<AlertTriangle className="w-4 h-4" />}
          accent={lowStockCount > 0 ? "warning" : "default"}
        />
        <StatTile
          label={t("inv_dash_movements")}
          value={recent30.total.toLocaleString(isAr ? "ar-SA" : "en-US")}
          hint={`${t("inv_dash_movements_label")} · ${t("period_30d")}`}
          href="/app/inventory/transactions"
          testid="kpi-inventory-movements"
          icon={<TrendingUp className="w-4 h-4" />}
        />
      </div>

      {/* Detail row: top items + txn-type breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Top 5 items by value */}
        <section
          className="border border-border bg-card rounded-md flex flex-col"
          data-testid="inventory-top-items"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold tracking-tight inline-flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-muted-foreground" />
              {t("inv_dash_top_items")}
            </h3>
            <Link
              href="/app/inventory/valuation"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              data-testid="link-inventory-valuation"
            >
              {t("recent_view_all")}
              <ArrowRight className={`w-3 h-3 ${dir === "rtl" ? "rotate-180" : ""}`} />
            </Link>
          </div>
          {topItems.length === 0 ? (
            <div className="flex-1 flex items-center justify-center px-4 py-10 text-xs text-muted-foreground">
              {t("inv_dash_no_value")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {topItems.map((row) => {
                const name = isAr
                  ? row.productNameAr
                  : row.productNameEn || row.productNameAr;
                const value = Number(row.totalValue);
                const max = Number(topItems[0].totalValue) || 1;
                const pct = Math.max(4, (value / max) * 100);
                return (
                  <li key={row.productId}>
                    <Link
                      href="/app/inventory/valuation"
                      className="block px-4 py-2.5 hover:bg-accent/30 transition-colors group"
                      data-testid={`row-top-item-${row.productId}`}
                    >
                      <div className="flex items-baseline justify-between gap-3 mb-1.5 min-w-0">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                            {row.productSku}
                          </span>
                          <span className="text-sm text-foreground truncate">{name}</span>
                        </div>
                        <span className="text-sm tabular-nums font-medium text-foreground shrink-0">
                          {fmtMoney(value)}
                        </span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden" dir="ltr">
                        <div
                          className="h-full bg-primary/70 group-hover:bg-primary transition-colors rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 30-day txn count by type */}
        <section
          className="border border-border bg-card rounded-md flex flex-col"
          data-testid="inventory-txn-breakdown"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold tracking-tight inline-flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
              {t("inv_dash_movements")}
            </h3>
            <Link
              href="/app/inventory/transactions"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              data-testid="link-inventory-transactions"
            >
              {t("recent_view_all")}
              <ArrowRight className={`w-3 h-3 ${dir === "rtl" ? "rotate-180" : ""}`} />
            </Link>
          </div>
          <div className="flex-1 px-4 py-3">
            {recent30.total === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground py-10">
                {t("inv_dash_no_movements")}
              </div>
            ) : (
              <ul className="space-y-3">
                {TXN_TYPES.map((type) => {
                  const count = recent30.counts[type];
                  const pct = recent30.max > 0 ? (count / recent30.max) * 100 : 0;
                  const tone = TYPE_TONE[type];
                  const href = `/app/inventory/transactions?type=${type}`;
                  return (
                    <li key={type}>
                      <Link
                        href={href}
                        className="block group"
                        data-testid={`row-txn-type-${type}`}
                      >
                        <div className="flex items-baseline justify-between text-xs mb-1">
                          <span className="font-medium text-foreground inline-flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                            {txnLabel(t, type)}
                          </span>
                          <span
                            className="tabular-nums text-muted-foreground group-hover:text-foreground transition-colors"
                            data-testid={`count-txn-type-${type}`}
                          >
                            {count.toLocaleString(isAr ? "ar-SA" : "en-US")}
                          </span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden" dir="ltr">
                          <div
                            className={`h-full ${tone.bar} rounded-full transition-all`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
