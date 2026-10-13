import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocale } from "@/contexts/locale-context";
import { useT } from "@/i18n/dict";
import { mapErrorKey } from "@/lib/error-messages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { WriteGuard } from "@/components/auth/write-guard";
import { Plus, Tag } from "lucide-react";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { insertInventoryCategorySchema, type InventoryCategory } from "@shared/schema";
import type { z } from "zod";

type CategoryForm = z.infer<typeof insertInventoryCategorySchema>;

export default function InventoryCategoriesPage() {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const t = useT();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: rows, isLoading } = useQuery<InventoryCategory[]>({
    queryKey: ["/api/inventory/categories"],
  });

  const form = useForm<CategoryForm>({
    resolver: zodResolver(insertInventoryCategorySchema),
    defaultValues: { nameAr: "", nameEn: "", isActive: true },
  });

  const createMut = useMutation({
    mutationFn: async (data: CategoryForm) => {
      await apiRequest("POST", "/api/inventory/categories", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/categories"] });
      setCreateOpen(false);
      form.reset();
      toast({ description: t("toast_saved") });
    },
    onError: (e: unknown) => toast({ variant: "destructive", description: t(mapErrorKey(e)) }),
  });

  return (
    <div className="space-y-6 p-6" data-testid="page-inventory-categories">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("nav_inv_categories")}</h1>
        <WriteGuard>
          <Button data-testid="button-create-category" onClick={() => setCreateOpen(true)}>
            <Plus className="me-1 h-4 w-4" /> {t("inv_create")}
          </Button>
        </WriteGuard>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("nav_inv_categories")}</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((d) => createMut.mutate(d))} className="space-y-4">
                <FormField control={form.control} name="nameAr" render={({ field }) => (
                  <FormItem><FormLabel>{t("inv_name_ar")}</FormLabel><FormControl><Input {...field} data-testid="input-nameAr" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="nameEn" render={({ field }) => (
                  <FormItem><FormLabel>{t("inv_name_en")}</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-nameEn" /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{t("inv_cancel")}</Button>
                  <Button type="submit" disabled={createMut.isPending} data-testid="button-submit-category">{t("inv_save")}</Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("nav_inv_categories")}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <ListSkeleton rows={4} /> : (rows ?? []).length === 0 ? (
            <EmptyState icon={<Tag className="h-6 w-6" />} title={t("inv_no_data")} description="" />
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t("inv_name_ar")}</TableHead>
                <TableHead>{t("inv_name_en")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(rows ?? []).map((r) => (
                  <TableRow key={r.id} data-testid={`row-category-${r.id}`}>
                    <TableCell>{r.nameAr}</TableCell>
                    <TableCell>{r.nameEn}</TableCell>
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
