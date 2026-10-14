import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

import { api } from "@shared/routes";
import { useSettings } from "@/lib/format";
import { formatMoney, type IfrsLineItem, type IfrsStatement } from "@/lib/ifrs-classifier";
import { useT } from "@/i18n/dict";
import { useLocale } from "@/contexts/locale-context";

interface Props {
  periodStart: Date | null;
  periodEnd: Date | null;
  companyName?: string;
}

export function IfrsIncomeStatement({
  periodStart,
  periodEnd,
  companyName,
}: Props) {
  const t = useT();
  const { dir } = useLocale();
  const resolvedCompanyName = companyName ?? t("report_default_company");
  const settings = useSettings();
  // Service workspaces have no inventory and therefore no Cost of Goods Sold,
  // so we hide the COGS block + the gross-profit subtotal entirely. Trading
  // and manufacturing workspaces keep the full layout. Default-safe: an
  // unknown / legacy value falls through to "show COGS" so we never
  // silently strip data from a workspace that has actual COGS postings.
  const showCogs = settings.businessType !== "service";

  // Build a stable query key that changes when the period changes so the
  // statement refetches whenever the user picks a new range.
  const fromIso = periodStart ? periodStart.toISOString() : "";
  const toIso = periodEnd ? periodEnd.toISOString() : "";
  const params = new URLSearchParams();
  if (fromIso) params.set("from", fromIso);
  if (toIso) params.set("to", toIso);
  const url = params.toString()
    ? `${api.reports.incomeStatement.path}?${params.toString()}`
    : api.reports.incomeStatement.path;

  // The global QueryClient defaults to `retry: false` and `staleTime: Infinity`,
  // which means a transient failure (e.g. a 401 fired right before a session
  // refresh) would stick as a cached error until the component unmounts. The
  // income statement is mounted continuously while the user is on /reports,
  // so we opt back in to a single retry + refetch-on-mount so the report
  // self-heals after the user signs back in or the network blips.
  const { data, isLoading, isError, refetch } = useQuery<IfrsStatement>({
    queryKey: [api.reports.incomeStatement.path, fromIso, toIso],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load income statement (${res.status})`);
      return res.json();
    },
    retry: 1,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const empty: IfrsStatement = {
    revenueItems: [],
    totalRevenue: 0,
    cogsItems: [],
    totalCogs: 0,
    grossProfit: 0,
    operatingExpenseItems: [],
    totalOperatingExpenses: 0,
    otherIncomeItems: [],
    totalOtherIncome: 0,
    netProfit: 0,
  };
  const stmt = data ?? empty;

  return (
    <div
      className="bg-card rounded-2xl shadow-lg shadow-black/5 print:shadow-none print:rounded-none border border-border/50 overflow-hidden"
      data-testid="ifrs-statement"
    >
      {/* Statement header */}
      <div className="p-8 text-center border-b-2 border-foreground/10">
        <h2 className="text-2xl font-extrabold text-foreground">{resolvedCompanyName}</h2>
        <h3 className="text-xl font-bold text-foreground mt-2">{t("report_pl_title")}</h3>
        <p className="text-sm text-muted-foreground mt-1 font-medium">{t("report_pl_basis")}</p>
        <p className="text-sm text-muted-foreground mt-1 font-medium">
          {periodStart && periodEnd
            ? `${format(periodStart, "d MMMM yyyy", { locale: ar })} — ${format(
                periodEnd,
                "d MMMM yyyy",
                { locale: ar }
              )}`
            : t("report_all_periods")}
        </p>
      </div>

      {/* Loading / error states */}
      {isLoading && (
        <div
          className="p-8 text-center text-muted-foreground text-sm"
          data-testid="status-ifrs-loading"
        >
          {t("report_loading_pl")}
        </div>
      )}
      {isError && (
        <div
          className="p-8 text-center text-rose-600 text-sm flex flex-col items-center gap-3"
          data-testid="status-ifrs-error"
        >
          <span>{t("report_pl_error")}</span>
          <button
            type="button"
            onClick={() => refetch()}
            className="px-4 py-1.5 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 text-sm font-semibold transition-colors"
            data-testid="button-ifrs-retry"
          >
            {t("report_retry")}
          </button>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {/* Statement table */}
          <div className="overflow-x-auto table-sticky-first">
            <table className="w-full text-sm" dir={dir}>
              <thead>
                <tr className="bg-muted/40 text-foreground/70 text-xs uppercase tracking-wider">
                  <th className="p-3 text-right font-bold w-3/4">{t("report_account")}</th>
                  <th className="p-3 text-left font-bold">{t("report_total_col").replace("{sym}", settings.currencySymbol)}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {/* Operating Revenue */}
                <SectionHeader title={t("report_op_revenue")} />
                {stmt.revenueItems.length === 0 ? (
                  <EmptyRow label={t("report_no_revenue_sec")} />
                ) : (
                  stmt.revenueItems.map((it) => (
                    <LineRow
                      key={`rev-${it.category}`}
                      item={it}
                      testId={`row-rev-${it.category}`}
                    />
                  ))
                )}
                <SubtotalRow
                  label={t("report_total_op_revenue")}
                  value={stmt.totalRevenue}
                  testId="row-total-revenue"
                />

                {/* COGS — service workspaces hide this entire section + the
                    gross-profit subtotal because they have no inventory. */}
                {showCogs && (
                  <>
                    <SectionHeader title={t("report_cogs")} />
                    {stmt.cogsItems.length === 0 ? (
                      <EmptyRow label={t("report_no_cogs")} />
                    ) : (
                      stmt.cogsItems.map((it) => (
                        <LineRow
                          key={`cogs-${it.category}`}
                          item={it}
                          testId={`row-cogs-${it.category}`}
                        />
                      ))
                    )}
                    <SubtotalRow
                      label={t("report_total_cogs")}
                      value={stmt.totalCogs}
                      testId="row-total-cogs"
                    />

                    {/* Gross Profit — only meaningful when COGS is in play */}
                    <TotalRow
                      label={t("report_gross_profit")}
                      value={stmt.grossProfit}
                      tone="primary"
                      testId="row-gross-profit"
                    />
                  </>
                )}

                {/*
                  Service workspaces hide the COGS section above, but the
                  server still returns and subtracts real COGS postings from
                  net profit. If the workspace declared "service" yet the
                  books actually contain COGS, the visible income/expense
                  rows would not reconcile to net profit and the user would
                  rightly be confused. Surface a clear, locale-only-Arabic
                  warning naming the amount and pointing them at Settings,
                  rather than silently fudging the math by zeroing it out
                  on the client (which would hide a real bookkeeping issue).
                */}
                {!showCogs && stmt.totalCogs !== 0 && (
                  <tr data-testid="row-cogs-warning-service">
                    <td colSpan={2} className="px-4 py-3">
                      <div className="rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 text-[12.5px] text-amber-900 dark:text-amber-200 leading-relaxed">
                        <span className="font-semibold">{t("report_cogs_warning_label")}</span>{" "}
                        {t("report_cogs_warn_1")}{" "}
                        <span className="font-numeric tabular-nums font-semibold">
                          {formatMoney(stmt.totalCogs)} {settings.currencySymbol}
                        </span>{" "}
                        {t("report_cogs_warn_2")}
                      </div>
                    </td>
                  </tr>
                )}

                {/* Operating Expenses */}
                <SectionHeader title={t("report_op_expenses")} />
                {stmt.operatingExpenseItems.length === 0 ? (
                  <EmptyRow label={t("report_no_op_expenses")} />
                ) : (
                  stmt.operatingExpenseItems.map((it) => (
                    <LineRow
                      key={`opex-${it.category}`}
                      item={it}
                      testId={`row-opex-${it.category}`}
                    />
                  ))
                )}
                <SubtotalRow
                  label={t("report_total_op_expenses")}
                  value={stmt.totalOperatingExpenses}
                  testId="row-total-opex"
                />

                {/* Other Income (only if present) */}
                {stmt.otherIncomeItems.length > 0 && (
                  <>
                    <SectionHeader title={t("report_other_income")} />
                    {stmt.otherIncomeItems.map((it) => (
                      <LineRow
                        key={`oi-${it.category}`}
                        item={it}
                        testId={`row-other-inc-${it.category}`}
                      />
                    ))}
                    <SubtotalRow
                      label={t("report_total_other_income")}
                      value={stmt.totalOtherIncome}
                      testId="row-total-other-inc"
                    />
                  </>
                )}

                {/* Net Profit */}
                <TotalRow
                  label={t("report_net_profit_loss")}
                  value={stmt.netProfit}
                  tone={stmt.netProfit >= 0 ? "success" : "danger"}
                  testId="row-net-profit"
                  emphasized
                />
              </tbody>
            </table>
          </div>

          {/* Footer note */}
          <div className="p-4 bg-muted/20 text-xs text-muted-foreground text-center font-medium border-t border-border/40">
            {t("report_ifrs_footer")}
          </div>
        </>
      )}
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={2} className="p-3 pr-8 text-sm text-muted-foreground italic text-right">
        {label}
      </td>
    </tr>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <tr className="bg-foreground/[0.03]">
      <td colSpan={2} className="p-3 font-extrabold text-foreground text-base text-right">
        {title}
      </td>
    </tr>
  );
}

function LineRow({ item, testId }: { item: IfrsLineItem; testId: string }) {
  return (
    <tr className="hover:bg-muted/20 transition-colors" data-testid={testId}>
      <td className="p-3 pr-8 text-foreground/85 font-medium">{item.category}</td>
      <td
        className={`p-3 text-left tabular-nums font-semibold ${
          item.amount < 0 ? "text-rose-600" : "text-foreground"
        }`}
      >
        {formatMoney(item.amount)}
      </td>
    </tr>
  );
}

function SubtotalRow({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <tr className="bg-muted/30 border-t-2 border-foreground/10" data-testid={testId}>
      <td className="p-3 pr-4 font-bold text-foreground text-right">{label}</td>
      <td className="p-3 text-left tabular-nums font-extrabold text-foreground">
        {formatMoney(value)}
      </td>
    </tr>
  );
}

function TotalRow({
  label,
  value,
  tone,
  testId,
  emphasized = false,
}: {
  label: string;
  value: number;
  tone: "primary" | "success" | "danger";
  testId: string;
  emphasized?: boolean;
}) {
  const toneMap = {
    primary: "bg-primary/5 border-primary/30 text-primary",
    success: "bg-emerald-50 border-emerald-300 text-emerald-700",
    danger: "bg-rose-50 border-rose-300 text-rose-700",
  };
  return (
    <tr className={`${toneMap[tone]} border-y-2`} data-testid={testId}>
      <td
        className={`p-4 text-right ${emphasized ? "text-lg font-black" : "font-extrabold"}`}
      >
        {label}
      </td>
      <td
        className={`p-4 text-left tabular-nums ${
          emphasized ? "text-xl font-black" : "text-base font-extrabold"
        }`}
      >
        {formatMoney(value)}
      </td>
    </tr>
  );
}
