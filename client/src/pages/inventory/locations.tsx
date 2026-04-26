import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocale } from "@/contexts/locale-context";
import { useT } from "@/i18n/dict";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { WriteGuard } from "@/components/auth/write-guard";
import { Plus, MapPin } from "lucide-react";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { insertInventoryLocationSchema, type InventoryLocation } from "@shared/schema";
import type { z } from "zod";

type LocationForm = z.infer<typeof insertInventoryLocationSchema>;

export default function InventoryLocationsPage() {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const t = useT();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: rows, isLoading } = useQuery<InventoryLocation[]>({
    queryKey: ["/api/inventory/locations"],
  });

  const form = useForm<LocationForm>({
    resolver: zodResolver(insertInventoryLocationSchema),
    defaultValues: { nameAr: "", nameEn: "", address: "", isActive: true },
  });

  const createMut = useMutation({
    mutationFn: async (data: LocationForm) => {
      await apiRequest("POST", "/api/inventory/locations", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/locations"] });
      setCreateOpen(false);
      form.reset();
      toast({ description: isAr ? "تم الحفظ" : "Saved" });
    },
    onError: (e: any) => toast({ variant: "destructive", description: e?.message ?? "Error" }),
  });

  return (
    <div className="space-y-6 p-6" data-testid="page-inventory-locations">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("nav_inv_locations")}</h1>
        <WriteGuard>
          <Button data-testid="button-create-location" onClick={() => setCreateOpen(true)}>
            <Plus className="me-1 h-4 w-4" /> {t("inv_create")}
          </Button>
        </WriteGuard>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("nav_inv_locations")}</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((d) => createMut.mutate(d))} className="space-y-4">
                <FormField control={form.control} name="nameAr" render={({ field }) => (
                  <FormItem><FormLabel>{t("inv_name_ar")}</FormLabel><FormControl><Input {...field} data-testid="input-loc-nameAr" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="nameEn" render={({ field }) => (
                  <FormItem><FormLabel>{t("inv_name_en")}</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-loc-nameEn" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="address" render={({ field }) => (
                  <FormItem><FormLabel>{t("inv_address")}</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-loc-address" /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{t("inv_cancel")}</Button>
                  <Button type="submit" disabled={createMut.isPending} data-testid="button-submit-location">{t("inv_save")}</Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("nav_inv_locations")}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <ListSkeleton rows={4} /> : (rows ?? []).length === 0 ? (
            <EmptyState icon={<MapPin className="h-6 w-6" />} title={t("inv_no_data")} description="" />
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t("inv_name_ar")}</TableHead>
                <TableHead>{t("inv_name_en")}</TableHead>
                <TableHead>{t("inv_address")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(rows ?? []).map((r) => (
                  <TableRow key={r.id} data-testid={`row-location-${r.id}`}>
                    <TableCell>{r.nameAr}</TableCell>
                    <TableCell>{r.nameEn}</TableCell>
                    <TableCell>{r.address}</TableCell>
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
