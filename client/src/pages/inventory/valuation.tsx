import { useQuery } from "@tanstack/react-query";
import { useLocale } from "@/contexts/locale-context";
import { useT } from "@/i18n/dict";
import { useFormatMoney } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell, TableFooter } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, Download } from "lucide-react";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";

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

export default function InventoryValuationPage() {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const t = useT();
  const formatMoney = useFormatMoney();

  const { data, isLoading } = useQuery<ValReport>({
    queryKey: ["/api/inventory/valuation"],
  });

  return (
    <div className="space-y-6 p-6" data-testid="page-inventory-valuation">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("nav_inv_valuation")}</h1>
        <a href="/api/inventory/valuation.csv" download>
          <Button variant="outline" data-testid="button-export-valuation-csv">
            <Download className="me-1 h-4 w-4" /> {t("inv_export_csv")}
          </Button>
        </a>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("nav_inv_valuation")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <ListSkeleton rows={6} /> : !data || data.rows.length === 0 ? (
            <EmptyState icon={<ClipboardList className="h-6 w-6" />} title={t("inv_no_data")} description="" />
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t("inv_code")}</TableHead>
                <TableHead>{isAr ? t("inv_name_ar") : t("inv_name_en")}</TableHead>
                <TableHead>{t("inv_uom")}</TableHead>
                <TableHead>{t("inv_costing")}</TableHead>
                <TableHead className="text-end">{t("inv_quantity")}</TableHead>
                <TableHead className="text-end">{t("inv_value")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.productId} data-testid={`row-valuation-${r.productId}`}>
                    <TableCell className="font-mono">{r.productSku}</TableCell>
                    <TableCell>{isAr ? r.productNameAr : (r.productNameEn || r.productNameAr)}</TableCell>
                    <TableCell>{r.unit}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {r.costingMethod === "fifo" ? t("inv_costing_fifo") : t("inv_costing_avg")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">{r.totalQty}</TableCell>
                    <TableCell className="text-end" data-testid={`cell-valuation-value-${r.productId}`}>
                      {formatMoney(Number(r.totalValue))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="font-semibold">{t("inv_total_value")}</TableCell>
                  <TableCell className="text-end font-semibold">{data.grandTotalQty}</TableCell>
                  <TableCell className="text-end font-semibold" data-testid="cell-valuation-grand-total">
                    {formatMoney(Number(data.grandTotalValue))}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
