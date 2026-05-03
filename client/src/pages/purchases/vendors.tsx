import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFormatMoney } from "@/lib/format";
import { useLocale } from "@/contexts/locale-context";
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
  const { locale } = useLocale();
  const isAr = locale === "ar";
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
      toast({ title: isAr ? "تم حفظ المورد" : "Vendor saved" });
    },
    onError: (err: any) => {
      toast({
        title: isAr ? "تعذر الحفظ" : "Save failed",
        description: err?.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-8" data-testid="purchases-vendors-page">
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-2 max-w-2xl">
          <div className="eyebrow text-muted-foreground/80">
            {isAr ? "بوابة المشتريات" : "Purchases Portal"}
          </div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {isAr ? "الموردون" : "Vendors"}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {isAr
              ? "أنشئ مورديك وتتبّع أرصدتهم وفواتيرهم — مع تسجيل تلقائي في دفتر الأستاذ."
              : "Create vendors, track their AP balance and bill history — auto-posted to the ledger."}
          </p>
        </div>
        <WriteGuard>
          <Button
            data-testid="button-new-vendor"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4 me-2" />
            {isAr ? "مورد جديد" : "New vendor"}
          </Button>
        </WriteGuard>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{isAr ? "مورد جديد" : "New vendor"}</DialogTitle>
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
                      <FormLabel>{isAr ? "الاسم بالعربية" : "Arabic name"}</FormLabel>
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
                      <FormLabel>{isAr ? "الاسم بالإنجليزية" : "English name"}</FormLabel>
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
                        <FormLabel>{isAr ? "الكود" : "Code"}</FormLabel>
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
                        <FormLabel>{isAr ? "الرقم الضريبي" : "Tax number"}</FormLabel>
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
                        <FormLabel>{isAr ? "الهاتف" : "Phone"}</FormLabel>
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
                        <FormLabel>{isAr ? "البريد" : "Email"}</FormLabel>
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
                  {createMut.isPending
                    ? isAr ? "جارٍ الحفظ…" : "Saving…"
                    : isAr ? "حفظ" : "Save"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{isAr ? "قائمة الموردين" : "Vendors"}</CardTitle>
          <CardDescription>
            {isAr ? "اضغط على مورد لرؤية رصيده وفواتيره" : "Click a vendor to view balance and bills"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <ListSkeleton rows={5} />}
          {!isLoading && (vendors?.length ?? 0) === 0 && (
            <EmptyState
              title={isAr ? "لا يوجد موردون بعد" : "No vendors yet"}
              description={isAr ? "أضف أول مورد لبدء استلام الفواتير." : "Add your first vendor to start recording bills."}
            />
          )}
          {!isLoading && (vendors?.length ?? 0) > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isAr ? "الاسم" : "Name"}</TableHead>
                  <TableHead>{isAr ? "الكود" : "Code"}</TableHead>
                  <TableHead>{isAr ? "الهاتف" : "Phone"}</TableHead>
                  <TableHead className="text-end">{isAr ? "الرصيد" : "Balance"}</TableHead>
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
                    isAr={isAr}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-vendor-detail">
          {selected && <VendorDetail vendor={selected} isAr={isAr} formatMoney={formatMoney} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VendorRow({
  vendor,
  onView,
  formatMoney,
  isAr,
}: {
  vendor: Vendor;
  onView: () => void;
  formatMoney: (v: number) => string;
  isAr: boolean;
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
  isAr,
  formatMoney,
}: {
  vendor: Vendor;
  isAr: boolean;
  formatMoney: (v: number) => string;
}) {
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
            {isAr ? "الرصيد المستحق" : "Open AP balance"}
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
          {isAr ? "آخر الفواتير" : "Recent bills"}
        </div>
        {(history?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isAr ? "لا فواتير بعد." : "No bills yet."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{isAr ? "الرقم" : "#"}</TableHead>
                <TableHead>{isAr ? "التاريخ" : "Date"}</TableHead>
                <TableHead>{isAr ? "الحالة" : "Status"}</TableHead>
                <TableHead className="text-end">{isAr ? "الإجمالي" : "Total"}</TableHead>
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
