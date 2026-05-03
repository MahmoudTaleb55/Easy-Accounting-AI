import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
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
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { WriteGuard } from "@/components/auth/write-guard";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { Plus, Trash2 } from "lucide-react";
import {
  createPurchasePaymentSchema,
  type CreatePurchasePaymentInput,
  type PurchasePaymentWithAllocations,
  type PurchaseInvoice,
  type Vendor,
} from "@shared/schema";

export default function PurchasePaymentsPage() {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const formatMoney = useFormatMoney();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data: payments, isLoading } = useQuery<PurchasePaymentWithAllocations[]>({
    queryKey: ["/api/purchases/payments"],
  });
  const { data: vendors } = useQuery<Vendor[]>({ queryKey: ["/api/purchases/vendors"] });
  const { data: bills } = useQuery<PurchaseInvoice[]>({ queryKey: ["/api/purchases/bills"] });
  const { data: nextNum } = useQuery<{ number: string }>({
    queryKey: ["/api/purchases/payments/next-number"],
    enabled: open,
  });

  const today = new Date().toISOString().slice(0, 10);
  const form = useForm<CreatePurchasePaymentInput>({
    resolver: zodResolver(createPurchasePaymentSchema),
    defaultValues: {
      vendorId: 0,
      paymentDate: today,
      notes: "",
      allocations: [],
    },
  });
  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "allocations",
  });

  const vendorId = form.watch("vendorId");

  const openBills = useMemo(() => {
    if (!vendorId || !bills) return [];
    return bills.filter(
      (b) =>
        b.vendorId === vendorId &&
        b.status === "posted" &&
        b.paymentMethod === "credit" &&
        Number(b.totalAmount) - Number(b.paidAmount) > 0,
    );
  }, [bills, vendorId]);

  // Reset allocation rows whenever the vendor changes so we don't keep stale
  // bill IDs from a previous selection.
  useEffect(() => {
    replace([]);
  }, [vendorId, replace]);

  const createMut = useMutation({
    mutationFn: async (input: CreatePurchasePaymentInput) => {
      const res = await apiRequest("POST", "/api/purchases/payments", input);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchases/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchases/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchases/vendors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchases/aging"] });
      setOpen(false);
      form.reset();
      toast({ title: isAr ? "تم تسجيل الدفعة" : "Payment recorded" });
    },
    onError: (err: any) =>
      toast({
        title: isAr ? "تعذر التسجيل" : "Save failed",
        description: err?.message,
        variant: "destructive",
      }),
  });

  const reverseMut = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/purchases/payments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchases/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchases/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchases/aging"] });
      toast({ title: isAr ? "تم عكس الدفعة" : "Payment reversed" });
    },
    onError: (err: any) =>
      toast({
        title: isAr ? "تعذر العكس" : "Reverse failed",
        description: err?.message,
        variant: "destructive",
      }),
  });

  const totalAlloc = useMemo(() => {
    return (form.watch("allocations") || []).reduce(
      (a, b) => a + Number(b.amount || 0),
      0,
    );
  }, [form.watch("allocations")]);

  const vendorName = (id: number) => {
    const v = vendors?.find((x) => x.id === id);
    return v ? v.nameAr || v.nameEn : `#${id}`;
  };

  const toggleBill = (billId: number, checked: boolean) => {
    const current = form.getValues("allocations") || [];
    if (checked) {
      const bill = openBills.find((b) => b.id === billId);
      const open = bill ? Number(bill.totalAmount) - Number(bill.paidAmount) : 0;
      append({ invoiceId: billId, amount: open });
    } else {
      const idx = current.findIndex((a) => a.invoiceId === billId);
      if (idx >= 0) remove(idx);
    }
  };

  const isBillSelected = (billId: number) => {
    return (form.watch("allocations") || []).some((a) => a.invoiceId === billId);
  };

  return (
    <div className="space-y-8" data-testid="purchases-payments-page">
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-2 max-w-2xl">
          <div className="eyebrow text-muted-foreground/80">
            {isAr ? "بوابة المشتريات" : "Purchases Portal"}
          </div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {isAr ? "دفعات الموردين" : "Vendor Payments"}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {isAr
              ? "سدّد عدة فواتير من نفس المورد بدفعة واحدة — يُسجَّل القيد تلقائياً (مدين ذمم دائنة / دائن نقدية)."
              : "Pay multiple bills from the same vendor in one shot — JE auto-posts (Dr AP / Cr Cash)."}
          </p>
        </div>
        <WriteGuard>
          <Button data-testid="button-new-payment" onClick={() => setOpen(true)}>
            <Plus className="size-4 me-2" />
            {isAr ? "دفعة جديدة" : "New payment"}
          </Button>
        </WriteGuard>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {isAr ? "دفعة جديدة" : "New payment"}
                {nextNum?.number ? (
                  <span className="ms-2 text-sm text-muted-foreground font-mono">
                    ({nextNum.number})
                  </span>
                ) : null}
              </DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((d) => createMut.mutate(d))}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="vendorId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{isAr ? "المورد" : "Vendor"}</FormLabel>
                        <Select
                          onValueChange={(v) => field.onChange(Number(v))}
                          value={field.value ? String(field.value) : ""}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-vendor">
                              <SelectValue
                                placeholder={isAr ? "اختر مورد" : "Select vendor"}
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {vendors?.map((v) => (
                              <SelectItem
                                key={v.id}
                                value={String(v.id)}
                                data-testid={`option-vendor-${v.id}`}
                              >
                                {v.nameAr || v.nameEn}
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
                    name="paymentDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{isAr ? "التاريخ" : "Payment date"}</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} data-testid="input-payment-date" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                {vendorId > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">
                      {isAr ? "اختر الفواتير المراد سدادها" : "Select bills to pay"}
                    </h4>
                    {openBills.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {isAr ? "لا فواتير مفتوحة لهذا المورد." : "No open bills for this vendor."}
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead></TableHead>
                            <TableHead>{isAr ? "الرقم" : "#"}</TableHead>
                            <TableHead>{isAr ? "التاريخ" : "Date"}</TableHead>
                            <TableHead className="text-end">{isAr ? "المتبقي" : "Open"}</TableHead>
                            <TableHead className="text-end">{isAr ? "المبلغ" : "Amount"}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {openBills.map((b) => {
                            const open = Number(b.totalAmount) - Number(b.paidAmount);
                            const idx = (form.watch("allocations") || []).findIndex(
                              (a) => a.invoiceId === b.id,
                            );
                            const selected = idx >= 0;
                            return (
                              <TableRow key={b.id} data-testid={`row-pay-bill-${b.id}`}>
                                <TableCell>
                                  <Checkbox
                                    checked={selected}
                                    onCheckedChange={(v) => toggleBill(b.id, !!v)}
                                    data-testid={`checkbox-pay-bill-${b.id}`}
                                  />
                                </TableCell>
                                <TableCell className="font-mono">{b.number}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {b.invoiceDate}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {formatMoney(open)}
                                </TableCell>
                                <TableCell className="text-end">
                                  {selected && (
                                    <Input
                                      type="number"
                                      step="0.01"
                                      className="w-32 text-end font-mono ms-auto"
                                      {...form.register(
                                        `allocations.${idx}.amount`,
                                        { valueAsNumber: true },
                                      )}
                                      data-testid={`input-alloc-amount-${b.id}`}
                                    />
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}

                {form.formState.errors.allocations && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.allocations.message as string}
                  </p>
                )}

                <div className="rounded-md border bg-muted/30 p-3 flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    {isAr ? "إجمالي الدفعة" : "Payment total"}
                  </span>
                  <span className="font-mono text-lg font-semibold" data-testid="text-form-total">
                    {formatMoney(totalAlloc)}
                  </span>
                </div>

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{isAr ? "ملاحظات" : "Notes"}</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} data-testid="input-payment-notes" />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setOpen(false)}
                    data-testid="button-cancel-payment"
                  >
                    {isAr ? "إلغاء" : "Cancel"}
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMut.isPending || fields.length === 0}
                    data-testid="button-submit-payment"
                  >
                    {createMut.isPending
                      ? isAr ? "جارٍ الحفظ…" : "Saving…"
                      : isAr ? "حفظ" : "Save"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{isAr ? "كل الدفعات" : "All payments"}</CardTitle>
          <CardDescription>
            {isAr ? "آخر دفعات الموردين والقيود المرتبطة بها." : "Recent vendor payments and their JE links."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <ListSkeleton rows={6} />}
          {!isLoading && (payments?.length ?? 0) === 0 && (
            <EmptyState
              title={isAr ? "لا دفعات بعد" : "No payments yet"}
              description={isAr ? "سجّل أول دفعة لتقليل الذمم الدائنة." : "Record your first vendor payment to reduce AP."}
            />
          )}
          {!isLoading && (payments?.length ?? 0) > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isAr ? "الرقم" : "#"}</TableHead>
                  <TableHead>{isAr ? "المورد" : "Vendor"}</TableHead>
                  <TableHead>{isAr ? "التاريخ" : "Date"}</TableHead>
                  <TableHead>{isAr ? "الفواتير" : "Bills"}</TableHead>
                  <TableHead className="text-end">{isAr ? "المبلغ" : "Amount"}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments!.map((p) => (
                  <TableRow key={p.id} data-testid={`row-payment-${p.id}`}>
                    <TableCell className="font-mono" data-testid={`text-payment-number-${p.id}`}>
                      {p.number}
                    </TableCell>
                    <TableCell>{vendorName(p.vendorId)}</TableCell>
                    <TableCell className="text-muted-foreground">{p.paymentDate}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {p.allocations.length} {isAr ? "فاتورة" : "bills"}
                    </TableCell>
                    <TableCell className="text-end font-mono" data-testid={`text-payment-amount-${p.id}`}>
                      {formatMoney(Number(p.amount))}
                    </TableCell>
                    <TableCell className="text-end">
                      <WriteGuard>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reverseMut.mutate(p.id)}
                          disabled={reverseMut.isPending}
                          data-testid={`button-reverse-payment-${p.id}`}
                        >
                          <Trash2 className="size-4 text-destructive" />
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
    </div>
  );
}
