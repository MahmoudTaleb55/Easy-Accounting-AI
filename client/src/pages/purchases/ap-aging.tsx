import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useFormatMoney } from "@/lib/format";
import { useLocale } from "@/contexts/locale-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { Eye } from "lucide-react";
import type { ApAgingReport, ApAgingRow } from "@shared/schema";

const BUCKETS: Array<{ key: ApAgingRow["bucket"]; labelAr: string; labelEn: string }> = [
  { key: "current", labelAr: "ضمن الاستحقاق", labelEn: "Current" },
  { key: "1_30",    labelAr: "1–30 يوم",       labelEn: "1–30 days" },
  { key: "31_60",   labelAr: "31–60 يوم",      labelEn: "31–60 days" },
  { key: "61_90",   labelAr: "61–90 يوم",      labelEn: "61–90 days" },
  { key: "over_90", labelAr: "أكثر من 90",     labelEn: "Over 90 days" },
];

export default function PurchaseApAgingPage() {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const formatMoney = useFormatMoney();
  const today = new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf] = useState(today);
  const [bucket, setBucket] = useState<ApAgingRow["bucket"] | "all">("all");

  const { data, isLoading } = useQuery<ApAgingReport>({
    queryKey: ["/api/purchases/aging", asOf],
    queryFn: async () => {
      const res = await fetch(`/api/purchases/aging?asOf=${encodeURIComponent(asOf)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    if (bucket === "all") return data.rows;
    return data.rows.filter((r) => r.bucket === bucket);
  }, [data, bucket]);

  return (
    <div className="space-y-8" data-testid="purchases-aging-page">
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-2 max-w-2xl">
          <div className="eyebrow text-muted-foreground/80">
            {isAr ? "بوابة المشتريات" : "Purchases Portal"}
          </div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {isAr ? "أعمار الذمم الدائنة" : "AP Aging"}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {isAr
              ? "تابع التزاماتك تجاه الموردين بحسب فئات التأخر — اضغط على فئة لتصفية الجدول."
              : "Track what you owe vendors by aging bucket — click a bucket to filter the table."}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <label className="eyebrow text-muted-foreground" htmlFor="asof">
              {isAr ? "كما في" : "As of"}
            </label>
            <Input
              id="asof"
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              data-testid="input-as-of"
            />
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {BUCKETS.map((b) => {
          const value =
            b.key === "current" ? data?.totals.current ?? 0
            : b.key === "1_30" ? data?.totals.bucket1_30 ?? 0
            : b.key === "31_60" ? data?.totals.bucket31_60 ?? 0
            : b.key === "61_90" ? data?.totals.bucket61_90 ?? 0
            : data?.totals.over90 ?? 0;
          const active = bucket === b.key;
          return (
            <button
              key={b.key}
              onClick={() => setBucket(active ? "all" : b.key)}
              className={`rounded-md border p-3 text-start hover-elevate ${
                active ? "border-primary bg-primary/5" : "bg-card"
              }`}
              data-testid={`bucket-${b.key}`}
            >
              <div className="eyebrow text-muted-foreground">
                {isAr ? b.labelAr : b.labelEn}
              </div>
              <div className="text-lg font-mono font-semibold mt-1" data-testid={`bucket-total-${b.key}`}>
                {formatMoney(value)}
              </div>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isAr ? "الفواتير المفتوحة" : "Open bills"}</CardTitle>
          <CardDescription>
            {bucket === "all"
              ? isAr ? "كل الفواتير المفتوحة" : "All open bills"
              : isAr ? `تصفية: ${BUCKETS.find((x) => x.key === bucket)?.labelAr}`
                     : `Filter: ${BUCKETS.find((x) => x.key === bucket)?.labelEn}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <ListSkeleton rows={6} />}
          {!isLoading && filtered.length === 0 && (
            <EmptyState
              title={isAr ? "لا توجد فواتير" : "No bills"}
              description={isAr ? "لا توجد ذمم دائنة في هذه الفئة." : "No open AP in this bucket."}
            />
          )}
          {!isLoading && filtered.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isAr ? "الرقم" : "#"}</TableHead>
                  <TableHead>{isAr ? "المورد" : "Vendor"}</TableHead>
                  <TableHead>{isAr ? "التاريخ" : "Date"}</TableHead>
                  <TableHead>{isAr ? "الاستحقاق" : "Due"}</TableHead>
                  <TableHead className="text-end">{isAr ? "أيام التأخر" : "Days"}</TableHead>
                  <TableHead className="text-end">{isAr ? "الإجمالي" : "Total"}</TableHead>
                  <TableHead className="text-end">{isAr ? "المتبقي" : "Open"}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.invoiceId} data-testid={`row-aging-${r.invoiceId}`}>
                    <TableCell className="font-mono">{r.invoiceNumber}</TableCell>
                    <TableCell>{r.vendorName}</TableCell>
                    <TableCell className="text-muted-foreground">{r.invoiceDate}</TableCell>
                    <TableCell className="text-muted-foreground">{r.dueDate || "—"}</TableCell>
                    <TableCell className="text-end font-mono">
                      {r.daysOverdue > 0 ? r.daysOverdue : 0}
                    </TableCell>
                    <TableCell className="text-end font-mono">{formatMoney(r.totalAmount)}</TableCell>
                    <TableCell className="text-end font-mono font-semibold">
                      {formatMoney(r.openAmount)}
                    </TableCell>
                    <TableCell className="text-end">
                      <Link href={`/app/purchases/bills/${r.invoiceId}`}>
                        <Button variant="ghost" size="sm" data-testid={`button-view-aging-${r.invoiceId}`}>
                          <Eye className="size-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
