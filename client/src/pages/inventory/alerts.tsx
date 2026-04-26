import { useQuery } from "@tanstack/react-query";
import { useLocale } from "@/contexts/locale-context";
import { useT } from "@/i18n/dict";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";

type AlertRow = {
  productId: number;
  sku: string;
  nameAr: string;
  nameEn: string | null;
  unit: string;
  minimumStock: string;
  totalQty: string;
};

export default function InventoryAlertsPage() {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const t = useT();

  const { data: rows, isLoading } = useQuery<AlertRow[]>({
    queryKey: ["/api/inventory/alerts"],
  });

  return (
    <div className="space-y-6 p-6" data-testid="page-inventory-alerts">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("nav_inv_alerts")}</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("nav_inv_alerts")}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <ListSkeleton rows={4} /> : (rows ?? []).length === 0 ? (
            <EmptyState icon={<AlertTriangle className="h-6 w-6" />} title={t("inv_no_alerts")} description="" />
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t("inv_code")}</TableHead>
                <TableHead>{isAr ? t("inv_name_ar") : t("inv_name_en")}</TableHead>
                <TableHead>{t("inv_uom")}</TableHead>
                <TableHead className="text-end">{t("inv_min_stock")}</TableHead>
                <TableHead className="text-end">{t("inv_on_hand")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(rows ?? []).map((r) => (
                  <TableRow key={r.productId} data-testid={`row-alert-${r.productId}`}>
                    <TableCell className="font-mono">{r.sku}</TableCell>
                    <TableCell>{isAr ? r.nameAr : (r.nameEn || r.nameAr)}</TableCell>
                    <TableCell>{r.unit}</TableCell>
                    <TableCell className="text-end">{r.minimumStock}</TableCell>
                    <TableCell className="text-end">
                      <Badge variant="destructive">{r.totalQty}</Badge>
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
