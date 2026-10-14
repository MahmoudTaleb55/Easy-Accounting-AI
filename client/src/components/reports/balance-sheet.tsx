import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { Building2, CheckCircle2, AlertCircle } from "lucide-react";
import { useT } from "@/i18n/dict";

interface Item { code: string; nameAr: string; balance: number; }
interface BSData {
  asOf: string;
  assets: { current: Item[]; nonCurrent: Item[]; totalCurrent: number; totalNonCurrent: number; total: number };
  liabilities: { current: Item[]; nonCurrent: Item[]; totalCurrent: number; totalNonCurrent: number; total: number };
  equity: { items: Item[]; netIncome: number; total: number };
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
}

const fmt = (n: number) => n.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ItemRows({ items }: { items: Item[] }) {
  const t = useT();
  if (!items.length) return <tr><td colSpan={2} className="px-3 py-2 text-xs text-muted-foreground">{t("report_bs_none")}</td></tr>;
  return <>{items.map((i) => (
    <tr key={i.code} className="border-b last:border-0">
      <td className="px-3 py-1.5 text-sm">
        <span className="font-mono text-xs text-muted-foreground ml-2">{i.code}</span>{i.nameAr}
      </td>
      <td className="px-3 py-1.5 text-left tabular-nums text-sm">{fmt(i.balance)}</td>
    </tr>
  ))}</>;
}

export function BalanceSheet() {
  const t = useT();
  const { data, isLoading } = useQuery<BSData>({ queryKey: ["/api/reports/balance-sheet"] });

  if (isLoading) return <Skeleton className="h-96" />;
  if (!data) return null;

  return (
    <Card data-testid="card-balance-sheet">
      <CardHeader className="border-b">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Building2 className="w-5 h-5 text-primary" />
            {t("report_bs_title")}
          </CardTitle>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{t("report_bs_as_of").replace("{date}", format(new Date(data.asOf), "d MMMM yyyy", { locale: ar }))}</span>
            <span className={`flex items-center gap-1 font-medium ${data.isBalanced ? "text-emerald-600" : "text-rose-600"}`}>
              {data.isBalanced ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {data.isBalanced ? t("report_bs_balanced") : t("report_bs_unbalanced")}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 md:p-6 grid gap-6 md:grid-cols-2">
        {/* Assets */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-blue-700 dark:text-blue-300 border-b pb-2">{t("report_bs_assets")}</h3>
          <div>
            <h4 className="text-sm font-semibold text-muted-foreground mb-1">{t("report_bs_current_assets")}</h4>
            <div className="table-sticky-first overflow-x-auto"><table className="w-full"><tbody><ItemRows items={data.assets.current} /></tbody></table></div>
            <div className="flex justify-between font-medium text-sm border-t pt-2 mt-1 px-3">
              <span>{t("report_bs_total_current")}</span>
              <span className="tabular-nums">{fmt(data.assets.totalCurrent)}</span>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-muted-foreground mb-1">{t("report_bs_noncurrent_assets")}</h4>
            <div className="table-sticky-first overflow-x-auto"><table className="w-full"><tbody><ItemRows items={data.assets.nonCurrent} /></tbody></table></div>
            <div className="flex justify-between font-medium text-sm border-t pt-2 mt-1 px-3">
              <span>{t("report_bs_total_noncurrent")}</span>
              <span className="tabular-nums">{fmt(data.assets.totalNonCurrent)}</span>
            </div>
          </div>
          <div className="flex justify-between font-bold text-base border-t-2 border-primary pt-3 px-3 bg-primary/5 rounded">
            <span>{t("report_bs_total_assets")}</span>
            <span className="tabular-nums" data-testid="text-bs-total-assets">{fmt(data.assets.total)}</span>
          </div>
        </div>

        {/* Liabilities + Equity */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-rose-700 dark:text-rose-300 border-b pb-2">{t("report_bs_liab_equity")}</h3>
          <div>
            <h4 className="text-sm font-semibold text-muted-foreground mb-1">{t("report_bs_current_liab")}</h4>
            <div className="table-sticky-first overflow-x-auto"><table className="w-full"><tbody><ItemRows items={data.liabilities.current} /></tbody></table></div>
            <div className="flex justify-between font-medium text-sm border-t pt-2 mt-1 px-3">
              <span>{t("report_bs_total_current_liab")}</span>
              <span className="tabular-nums">{fmt(data.liabilities.totalCurrent)}</span>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-muted-foreground mb-1">{t("report_bs_noncurrent_liab")}</h4>
            <div className="table-sticky-first overflow-x-auto"><table className="w-full"><tbody><ItemRows items={data.liabilities.nonCurrent} /></tbody></table></div>
            <div className="flex justify-between font-medium text-sm border-t pt-2 mt-1 px-3">
              <span>{t("report_bs_total_noncurrent_liab")}</span>
              <span className="tabular-nums">{fmt(data.liabilities.totalNonCurrent)}</span>
            </div>
          </div>
          <div className="flex justify-between font-semibold text-sm border-t pt-2 px-3 bg-rose-50 dark:bg-rose-900/10 rounded">
            <span>{t("report_bs_total_liab")}</span>
            <span className="tabular-nums">{fmt(data.liabilities.total)}</span>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-muted-foreground mb-1">{t("report_bs_equity")}</h4>
            <div className="table-sticky-first overflow-x-auto"><table className="w-full"><tbody>
              <ItemRows items={data.equity.items} />
              <tr className="border-b last:border-0">
                <td className="px-3 py-1.5 text-sm italic">{t("report_bs_net_income")}</td>
                <td className="px-3 py-1.5 text-left tabular-nums text-sm italic">{fmt(data.equity.netIncome)}</td>
              </tr>
            </tbody></table></div>
            <div className="flex justify-between font-medium text-sm border-t pt-2 mt-1 px-3">
              <span>{t("report_bs_total_equity")}</span>
              <span className="tabular-nums">{fmt(data.equity.total)}</span>
            </div>
          </div>

          <div className="flex justify-between font-bold text-base border-t-2 border-primary pt-3 px-3 bg-primary/5 rounded">
            <span>{t("report_bs_total_liab_equity")}</span>
            <span className="tabular-nums" data-testid="text-bs-total-liab-equity">{fmt(data.totalLiabilitiesAndEquity)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
