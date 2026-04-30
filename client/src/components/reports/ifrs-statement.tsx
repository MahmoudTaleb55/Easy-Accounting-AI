import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

import { api } from "@shared/routes";
import { useSettings } from "@/lib/format";
import { formatMoney, type IfrsLineItem, type IfrsStatement } from "@/lib/ifrs-classifier";

interface Props {
  periodStart: Date | null;
  periodEnd: Date | null;
  companyName?: string;
}

export function IfrsIncomeStatement({
  periodStart,
  periodEnd,
  companyName = "منشأتي",
}: Props) {
  const settings = useSettings();

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

  const { data, isLoading, isError } = useQuery<IfrsStatement>({
    queryKey: [api.reports.incomeStatement.path, fromIso, toIso],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load income statement (${res.status})`);
      return res.json();
    },
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
        <h2 className="text-2xl font-extrabold text-foreground">{companyName}</h2>
        <h3 className="text-xl font-bold text-foreground mt-2">قائمة الأرباح والخسائر</h3>
        <p className="text-sm text-muted-foreground mt-1 font-medium">الأساس: استحقاق الدفع</p>
        <p className="text-sm text-muted-foreground mt-1 font-medium">
          {periodStart && periodEnd
            ? `من ${format(periodStart, "d MMMM yyyy", { locale: ar })} إلى ${format(
                periodEnd,
                "d MMMM yyyy",
                { locale: ar }
              )}`
            : "كل الفترات"}
        </p>
      </div>

      {/* Loading / error states */}
      {isLoading && (
        <div
          className="p-8 text-center text-muted-foreground text-sm"
          data-testid="status-ifrs-loading"
        >
          جاري تحميل قائمة الدخل…
        </div>
      )}
      {isError && (
        <div
          className="p-8 text-center text-rose-600 text-sm"
          data-testid="status-ifrs-error"
        >
          تعذّر تحميل قائمة الدخل. حاول مرة أخرى.
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {/* Statement table */}
          <div className="overflow-x-auto table-sticky-first">
            <table className="w-full text-sm" dir="rtl">
              <thead>
                <tr className="bg-muted/40 text-foreground/70 text-xs uppercase tracking-wider">
                  <th className="p-3 text-right font-bold w-3/4">الحساب</th>
                  <th className="p-3 text-left font-bold">{`الإجمالي (${settings.currencySymbol})`}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {/* Operating Revenue */}
                <SectionHeader title="إيرادات التشغيل" />
                {stmt.revenueItems.length === 0 ? (
                  <EmptyRow label="لا توجد إيرادات" />
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
                  label="إجمالي إيرادات التشغيل"
                  value={stmt.totalRevenue}
                  testId="row-total-revenue"
                />

                {/* COGS */}
                <SectionHeader title="تكلفة البضائع المباعة" />
                {stmt.cogsItems.length === 0 ? (
                  <EmptyRow label="لا توجد تكلفة بضائع مسجلة" />
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
                  label="إجمالي تكلفة البضائع المباعة"
                  value={stmt.totalCogs}
                  testId="row-total-cogs"
                />

                {/* Gross Profit */}
                <TotalRow
                  label="إجمالي الربح"
                  value={stmt.grossProfit}
                  tone="primary"
                  testId="row-gross-profit"
                />

                {/* Operating Expenses */}
                <SectionHeader title="مصروفات التشغيل" />
                {stmt.operatingExpenseItems.length === 0 ? (
                  <EmptyRow label="لا توجد مصروفات تشغيلية" />
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
                  label="إجمالي مصروفات التشغيل"
                  value={stmt.totalOperatingExpenses}
                  testId="row-total-opex"
                />

                {/* Other Income (only if present) */}
                {stmt.otherIncomeItems.length > 0 && (
                  <>
                    <SectionHeader title="إيرادات أخرى" />
                    {stmt.otherIncomeItems.map((it) => (
                      <LineRow
                        key={`oi-${it.category}`}
                        item={it}
                        testId={`row-other-inc-${it.category}`}
                      />
                    ))}
                    <SubtotalRow
                      label="إجمالي الإيرادات الأخرى"
                      value={stmt.totalOtherIncome}
                      testId="row-total-other-inc"
                    />
                  </>
                )}

                {/* Net Profit */}
                <TotalRow
                  label="صافي الربح / الخسارة"
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
            تم إعداد هذا البيان وفق المبادئ العامة للمعايير الدولية لإعداد التقارير المالية (IFRS) -
            مبني على قيود اليومية المرحّلة.
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
