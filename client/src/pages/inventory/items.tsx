import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocale } from "@/contexts/locale-context";
import { useT } from "@/i18n/dict";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WriteGuard } from "@/components/auth/write-guard";
import { Boxes, Pencil } from "lucide-react";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { useFormatMoney } from "@/lib/format";
import { insertProductSchema, type Product, type InventoryCategory } from "@shared/schema";
import { z } from "zod";

const editItemSchema = insertProductSchema.pick({
  unit: true,
  minimumStock: true,
  categoryId: true,
  costingMethod: true,
});
type EditItemForm = z.infer<typeof editItemSchema>;

const NO_CATEGORY = "__none__";
const DEFAULT_COSTING = "__default__";

export default function InventoryItemsPage() {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const t = useT();
  const formatMoney = useFormatMoney();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Product | null>(null);

  const { data: products, isLoading } = useQuery<Product[]>({ queryKey: ["/api/sales/products"] });
  const { data: categories } = useQuery<InventoryCategory[]>({ queryKey: ["/api/inventory/categories"] });

  const catName = (id: number | null | undefined) => {
    if (!id) return "—";
    const c = categories?.find((x) => x.id === id);
    if (!c) return "—";
    return isAr ? c.nameAr : (c.nameEn || c.nameAr);
  };

  const form = useForm<EditItemForm>({
    resolver: zodResolver(editItemSchema),
    defaultValues: { unit: "pcs", minimumStock: 0, categoryId: null, costingMethod: null },
  });

  useEffect(() => {
    if (editing) {
      form.reset({
        unit: (editing as any).unit ?? "pcs",
        minimumStock: Number((editing as any).minimumStock ?? 0),
        categoryId: (editing as any).categoryId ?? null,
        costingMethod: (editing as any).costingMethod ?? null,
      });
    }
  }, [editing, form]);

  const updateMut = useMutation({
    mutationFn: async (data: EditItemForm) => {
      if (!editing) return;
      await apiRequest("PATCH", `/api/sales/products/${editing.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/valuation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/stock-levels"] });
      setEditing(null);
      toast({ description: isAr ? "تم الحفظ" : "Saved" });
    },
    onError: (e: any) => toast({ variant: "destructive", description: e?.message ?? "Error" }),
  });

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
                <TableHead className="text-end">{t("inv_actions")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(products ?? []).map((p) => (
                  <TableRow key={p.id} data-testid={`row-item-${p.id}`}>
                    <TableCell className="font-mono">{p.sku}</TableCell>
                    <TableCell>{isAr ? p.nameAr : (p.nameEn || p.nameAr)}</TableCell>
                    <TableCell data-testid={`text-unit-${p.id}`}>{(p as any).unit ?? "pcs"}</TableCell>
                    <TableCell data-testid={`text-min-stock-${p.id}`}>{(p as any).minimumStock ?? "0"}</TableCell>
                    <TableCell data-testid={`text-category-${p.id}`}>{catName((p as any).categoryId)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" data-testid={`badge-costing-${p.id}`}>
                        {(p as any).costingMethod === "fifo"
                          ? t("inv_costing_fifo")
                          : (p as any).costingMethod === "avg"
                          ? t("inv_costing_avg")
                          : "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">{formatMoney(Number(p.unitCost ?? 0))}</TableCell>
                    <TableCell className="text-end">
                      <WriteGuard>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(p)}
                          data-testid={`button-edit-item-${p.id}`}
                        >
                          <Pencil className="h-4 w-4 me-1" />
                          {t("inv_edit")}
                        </Button>
                      </WriteGuard>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("inv_edit_item")}
              {editing && (
                <span className="ms-2 font-mono text-sm text-muted-foreground">{editing.sku}</span>
              )}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((d) => updateMut.mutate(d))}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("inv_uom")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        data-testid="input-edit-unit"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="minimumStock"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("inv_min_stock")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={field.value ?? 0}
                        onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                        data-testid="input-edit-min-stock"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("inv_category")}</FormLabel>
                    <Select
                      value={field.value ? String(field.value) : NO_CATEGORY}
                      onValueChange={(v) => field.onChange(v === NO_CATEGORY ? null : Number(v))}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-category">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_CATEGORY}>{t("inv_no_category")}</SelectItem>
                        {(categories ?? []).map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {isAr ? c.nameAr : (c.nameEn || c.nameAr)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="costingMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("inv_costing")}</FormLabel>
                    <Select
                      value={field.value ?? DEFAULT_COSTING}
                      onValueChange={(v) =>
                        field.onChange(v === DEFAULT_COSTING ? null : (v as "fifo" | "avg"))
                      }
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-costing">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={DEFAULT_COSTING}>{t("inv_costing_default")}</SelectItem>
                        <SelectItem value="fifo">{t("inv_costing_fifo")}</SelectItem>
                        <SelectItem value="avg">{t("inv_costing_avg")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(null)}
                  data-testid="button-cancel-edit-item"
                >
                  {t("inv_cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={updateMut.isPending}
                  data-testid="button-submit-edit-item"
                >
                  {t("inv_save")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
