import { useQuery } from "@tanstack/react-query";
import { useLocale } from "@/contexts/locale-context";
import { useT } from "@/i18n/dict";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Boxes } from "lucide-react";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { useFormatMoney } from "@/lib/format";
import type { Product, InventoryCategory } from "@shared/schema";

export default function InventoryItemsPage() {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const t = useT();
  const formatMoney = useFormatMoney();

  const { data: products, isLoading } = useQuery<Product[]>({ queryKey: ["/api/products"] });
  const { data: categories } = useQuery<InventoryCategory[]>({ queryKey: ["/api/inventory/categories"] });

  const catName = (id: number | null | undefined) => {
    if (!id) return "—";
    const c = categories?.find((x) => x.id === id);
    if (!c) return "—";
    return isAr ? c.nameAr : (c.nameEn || c.nameAr);
  };

  return (
    <div className="space-y-6 p-6" data-testid="page-inventory-items">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("nav_inv_items")}</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("nav_inv_items")}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <ListSkeleton rows={6} /> : (products ?? []).length === 0 ? (
            <EmptyState icon={<Boxes className="h-6 w-6" />} title={t("inv_no_data")} description="" />
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t("inv_code")}</TableHead>
                <TableHead>{isAr ? t("inv_name_ar") : t("inv_name_en")}</TableHead>
                <TableHead>{t("inv_uom")}</TableHead>
                <TableHead>{t("inv_min_stock")}</TableHead>
                <TableHead>{t("inv_category")}</TableHead>
                <TableHead>{t("inv_costing")}</TableHead>
                <TableHead className="text-end">{t("inv_unit_cost")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(products ?? []).map((p) => (
                  <TableRow key={p.id} data-testid={`row-item-${p.id}`}>
                    <TableCell className="font-mono">{p.sku}</TableCell>
                    <TableCell>{isAr ? p.nameAr : (p.nameEn || p.nameAr)}</TableCell>
                    <TableCell>{(p as any).unit ?? "pcs"}</TableCell>
                    <TableCell>{(p as any).minimumStock ?? "0"}</TableCell>
                    <TableCell>{catName((p as any).categoryId)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {(p as any).costingMethod === "fifo"
                          ? t("inv_costing_fifo")
                          : (p as any).costingMethod === "avg"
                          ? t("inv_costing_avg")
                          : "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">{formatMoney(Number(p.unitCost ?? 0))}</TableCell>
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
