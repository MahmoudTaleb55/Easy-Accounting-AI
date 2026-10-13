import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useFormatMoney } from "@/lib/format";
import { useT, type StringKey } from "@/i18n/dict";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { Eye } from "lucide-react";
import type { ApAgingReport, ApAgingRow } from "@shared/schema";

const BUCKETS: Array<{ key: ApAgingRow["bucket"]; labelKey: StringKey }> = [
  { key: "current", labelKey: "apaging_bucket_current" },
  { key: "1_30",    labelKey: "apaging_bucket_1_30" },
  { key: "31_60",   labelKey: "apaging_bucket_31_60" },
  { key: "61_90",   labelKey: "apaging_bucket_61_90" },
  { key: "over_90", labelKey: "apaging_bucket_over_90" },
];

export default function PurchaseApAgingPage() {
  const t = useT();
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
            {t("purch_portal")}
          </div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {t("apaging_title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {t("apaging_sub")}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <label className="eyebrow text-muted-foreground" htmlFor="asof">
              {t("apaging_as_of")}
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
                {t(b.labelKey)}
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
          <CardTitle>{t("apaging_open_bills")}</CardTitle>
          <CardDescription>
            {bucket === "all"
              ? t("apaging_all_open")
              : t("apaging_filter").replace(
                  "{bucket}",
                  (() => {
                    const b = BUCKETS.find((x) => x.key === bucket);
                    return b ? t(b.labelKey) : "";
                  })(),
                )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <ListSkeleton rows={6} />}
          {!isLoading && filtered.length === 0 && (
            <EmptyState
              title={t("apaging_empty")}
              description={t("apaging_empty_desc")}
            />
          )}
          {!isLoading && filtered.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("purch_number_hash")}</TableHead>
                  <TableHead>{t("purch_vendor")}</TableHead>
                  <TableHead>{t("purch_date")}</TableHead>
                  <TableHead>{t("bill_due")}</TableHead>
                  <TableHead className="text-end">{t("apaging_days")}</TableHead>
                  <TableHead className="text-end">{t("purch_total")}</TableHead>
                  <TableHead className="text-end">{t("purch_open")}</TableHead>
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
