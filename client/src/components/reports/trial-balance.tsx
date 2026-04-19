import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Scale, CheckCircle2, AlertCircle } from "lucide-react";

interface TBRow {
  accountId: number;
  code: string;
  nameAr: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
}
interface TBData {
  rows: TBRow[];
  totalDebit: number;
  totalCredit: number;
}

const fmt = (n: number) => n.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function TrialBalance() {
  const { data, isLoading } = useQuery<TBData>({ queryKey: ["/api/reports/trial-balance"] });

  if (isLoading) return <Skeleton className="h-96" />;
  if (!data) return null;

  const balanced = Math.abs(data.totalDebit - data.totalCredit) < 0.01;

  return (
    <Card data-testid="card-trial-balance">
      <CardHeader className="border-b">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Scale className="w-5 h-5 text-primary" />
            ميزان المراجعة
          </CardTitle>
          <div className={`flex items-center gap-2 text-sm font-medium ${balanced ? "text-emerald-600" : "text-rose-600"}`}>
            {balanced ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {balanced ? "متوازن" : "غير متوازن"}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-right">الكود</th>
                <th className="px-4 py-3 text-right">اسم الحساب</th>
                <th className="px-4 py-3 text-left">إجمالي مدين</th>
                <th className="px-4 py-3 text-left">إجمالي دائن</th>
                <th className="px-4 py-3 text-left">الرصيد</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.accountId} className="border-t hover:bg-muted/20" data-testid={`row-tb-${r.code}`}>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{r.code}</td>
                  <td className="px-4 py-2.5">{r.nameAr}</td>
                  <td className="px-4 py-2.5 text-left tabular-nums">{r.debit > 0 ? fmt(r.debit) : "—"}</td>
                  <td className="px-4 py-2.5 text-left tabular-nums">{r.credit > 0 ? fmt(r.credit) : "—"}</td>
                  <td className="px-4 py-2.5 text-left tabular-nums font-medium">{fmt(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/40 font-bold">
              <tr>
                <td colSpan={2} className="px-4 py-3 text-right">الإجمالي</td>
                <td className="px-4 py-3 text-left tabular-nums" data-testid="text-tb-total-debit">{fmt(data.totalDebit)}</td>
                <td className="px-4 py-3 text-left tabular-nums" data-testid="text-tb-total-credit">{fmt(data.totalCredit)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
