import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFormatMoney } from "@/lib/format";
import { useT } from "@/i18n/dict";
import { mapErrorKey } from "@/lib/error-messages";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { WriteGuard } from "@/components/auth/write-guard";
import { Plus, Wallet, Eye } from "lucide-react";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { insertVendorSchema, type Vendor, type PurchaseInvoice } from "@shared/schema";
import type { z } from "zod";

type VendorForm = z.infer<typeof insertVendorSchema>;

export default function PurchaseVendorsPage() {
  const t = useT();
  const formatMoney = useFormatMoney();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Vendor | null>(null);

  const { data: vendors, isLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/purchases/vendors"],
  });

  const form = useForm<VendorForm>({
    resolver: zodResolver(insertVendorSchema),
    defaultValues: {
      code: "",
      nameAr: "",
      nameEn: "",
      taxNumber: "",
      phone: "",
      email: "",
      address: "",
      notes: "",
      isActive: true,
    },
  });

  const createMut = useMutation({
    mutationFn: async (input: VendorForm) => {
      const res = await apiRequest("POST", "/api/purchases/vendors", input);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchases/vendors"] });
      setCreateOpen(false);
      form.reset();
      toast({ title: t("vendor_toast_saved") });
    },
    onError: (err: unknown) => {
      toast({
        title: t("purch_save_failed"),
        description: t(mapErrorKey(err)),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-8" data-testid="purchases-vendors-page">
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-2 max-w-2xl">
          <div className="eyebrow text-muted-foreground/80">
            {t("purch_portal")}
          </div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {t("vendor_title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {t("vendor_sub")}
          </p>
        </div>
        <WriteGuard>
          <Button
            data-testid="button-new-vendor"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4 me-2" />
            {t("vendor_new")}
          </Button>
        </WriteGuard>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("vendor_new")}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((d) => createMut.mutate(d))}
                className="space-y-3"
              >
                <FormField
                  control={form.control}
                  name="nameAr"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("vendor_name_ar")}</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} data-testid="input-vendor-name-ar" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="nameEn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("vendor_name_en")}</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} data-testid="input-vendor-name-en" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("vendor_code")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} data-testid="input-vendor-code" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="taxNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("vendor_tax")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} data-testid="input-vendor-tax" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("vendor_phone")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} data-testid="input-vendor-phone" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("vendor_email")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} data-testid="input-vendor-email" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={createMut.isPending}
                  data-testid="button-submit-vendor"
                >
                  {createMut.isPending ? t("purch_saving") : t("purch_save")}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("vendor_list_title")}</CardTitle>
          <CardDescription>
            {t("vendor_list_desc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <ListSkeleton rows={5} />}
          {!isLoading && (vendors?.length ?? 0) === 0 && (
            <EmptyState
              title={t("vendor_empty")}
              description={t("vendor_empty_desc")}
            />
          )}
          {!isLoading && (vendors?.length ?? 0) > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("vendor_col_name")}</TableHead>
                  <TableHead>{t("vendor_code")}</TableHead>
                  <TableHead>{t("vendor_phone")}</TableHead>
                  <TableHead className="text-end">{t("vendor_col_balance")}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors!.map((v) => (
                  <VendorRow
                    key={v.id}
                    vendor={v}
                    onView={() => setSelected(v)}
                    formatMoney={formatMoney}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-vendor-detail">
          {selected && <VendorDetail vendor={selected} formatMoney={formatMoney} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VendorRow({
  vendor,
  onView,
  formatMoney,
}: {
  vendor: Vendor;
  onView: () => void;
  formatMoney: (v: number) => string;
}) {
  const { data } = useQuery<{ balance: number }>({
    queryKey: ["/api/purchases/vendors", vendor.id, "balance"],
  });
  return (
    <TableRow data-testid={`row-vendor-${vendor.id}`}>
      <TableCell className="font-medium" data-testid={`text-vendor-name-${vendor.id}`}>
        {vendor.nameAr || vendor.nameEn}
      </TableCell>
      <TableCell className="text-muted-foreground">{vendor.code || "—"}</TableCell>
      <TableCell className="text-muted-foreground">{vendor.phone || "—"}</TableCell>
      <TableCell
        className="text-end font-mono"
        data-testid={`text-vendor-balance-${vendor.id}`}
      >
        {formatMoney(data?.balance ?? 0)}
      </TableCell>
      <TableCell className="text-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={onView}
          data-testid={`button-view-vendor-${vendor.id}`}
        >
          <Eye className="size-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function VendorDetail({
  vendor,
  formatMoney,
}: {
  vendor: Vendor;
  formatMoney: (v: number) => string;
}) {
  const t = useT();
  const { data: balance } = useQuery<{ balance: number }>({
    queryKey: ["/api/purchases/vendors", vendor.id, "balance"],
  });
  const { data: history } = useQuery<PurchaseInvoice[]>({
    queryKey: ["/api/purchases/vendors", vendor.id, "history"],
  });
  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle data-testid="text-vendor-detail-name">
          {vendor.nameAr || vendor.nameEn}
        </DialogTitle>
      </DialogHeader>
      <div className="rounded-md border p-4 flex items-center gap-3 bg-muted/30">
        <Wallet className="size-5 text-primary" />
        <div className="flex-1">
          <div className="eyebrow text-muted-foreground">
            {t("vendor_open_ap")}
          </div>
          <div
            className="text-xl font-mono font-semibold"
            data-testid="text-vendor-detail-balance"
          >
            {formatMoney(balance?.balance ?? 0)}
          </div>
        </div>
      </div>
      <div>
        <div className="text-sm font-medium mb-2">
          {t("vendor_recent_bills")}
        </div>
        {(history?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("vendor_no_bills")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("purch_number_hash")}</TableHead>
                <TableHead>{t("purch_date")}</TableHead>
                <TableHead>{t("purch_status")}</TableHead>
                <TableHead className="text-end">{t("purch_total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history!.map((inv) => (
                <TableRow key={inv.id} data-testid={`row-history-${inv.id}`}>
                  <TableCell>{inv.number}</TableCell>
                  <TableCell>{inv.invoiceDate}</TableCell>
                  <TableCell>{inv.status}</TableCell>
                  <TableCell className="text-end font-mono">
                    {formatMoney(Number(inv.totalAmount))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
