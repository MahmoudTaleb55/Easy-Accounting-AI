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
  createSalesPaymentSchema,
  type CreateSalesPaymentInput,
  type SalesPaymentWithAllocations,
  type SalesInvoice,
  type Customer,
} from "@shared/schema";

export default function SalesPaymentsPage() {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const formatMoney = useFormatMoney();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data: payments, isLoading } = useQuery<SalesPaymentWithAllocations[]>({
    queryKey: ["/api/sales/payments"],
  });
  const { data: customers } = useQuery<Customer[]>({ queryKey: ["/api/sales/customers"] });
  const { data: invoices } = useQuery<SalesInvoice[]>({ queryKey: ["/api/sales/invoices"] });
  const { data: nextNum } = useQuery<{ number: string }>({
    queryKey: ["/api/sales/payments/next-number"],
    enabled: open,
  });

  const today = new Date().toISOString().slice(0, 10);
  const form = useForm<CreateSalesPaymentInput>({
    resolver: zodResolver(createSalesPaymentSchema),
    defaultValues: {
      customerId: 0,
      paymentDate: today,
      notes: "",
      allocations: [],
    },
  });
  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "allocations",
  });

  const customerId = form.watch("customerId");

  const openInvoices = useMemo(() => {
    if (!customerId || !invoices) return [];
    return invoices.filter(
      (i) =>
        i.customerId === customerId &&
        i.status === "posted" &&
        i.paymentMethod === "credit" &&
        Number(i.totalAmount) - Number(i.paidAmount) > 0,
    );
  }, [invoices, customerId]);

  useEffect(() => {
    replace([]);
  }, [customerId, replace]);

  const createMut = useMutation({
    mutationFn: async (input: CreateSalesPaymentInput) => {
      const res = await apiRequest("POST", "/api/sales/payments", input);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales/customers"] });
      setOpen(false);
      form.reset();
      toast({ title: isAr ? "تم تسجيل سند القبض" : "Receipt recorded" });
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
      await apiRequest("DELETE", `/api/sales/payments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales/invoices"] });
      toast({ title: isAr ? "تم عكس سند القبض" : "Receipt reversed" });
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

  const customerName = (id: number) => {
    const c = customers?.find((x) => x.id === id);
    return c ? c.nameAr || c.nameEn : `#${id}`;
  };

  const toggleInvoice = (invId: number, checked: boolean) => {
    const current = form.getValues("allocations") || [];
    if (checked) {
      const inv = openInvoices.find((i) => i.id === invId);
      const open = inv ? Number(inv.totalAmount) - Number(inv.paidAmount) : 0;
      append({ invoiceId: invId, amount: open });
    } else {
      const idx = current.findIndex((a) => a.invoiceId === invId);
      if (idx >= 0) remove(idx);
    }
  };

  return (
    <div className="space-y-8" data-testid="sales-payments-page">
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-2 max-w-2xl">
          <div className="eyebrow text-muted-foreground/80">
            {isAr ? "بوابة المبيعات" : "Sales Portal"}
          </div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {isAr ? "سندات القبض من العملاء" : "Customer Receipt Vouchers"}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {isAr
              ? "حصّل عدة فواتير من نفس العميل بسند قبض واحد — يُسجَّل القيد تلقائياً (مدين نقدية / دائن ذمم مدينة)."
              : "Collect multiple invoices from one customer in a single voucher — JE auto-posts (Dr Cash / Cr AR)."}
          </p>
        </div>
        <WriteGuard>
          <Button data-testid="button-new-receipt" onClick={() => setOpen(true)}>
            <Plus className="size-4 me-2" />
            {isAr ? "سند قبض جديد" : "New receipt"}
          </Button>
        </WriteGuard>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {isAr ? "سند قبض جديد" : "New receipt"}
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
                    name="customerId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{isAr ? "العميل" : "Customer"}</FormLabel>
                        <Select
                          onValueChange={(v) => field.onChange(Number(v))}
                          value={field.value ? String(field.value) : ""}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-customer">
                              <SelectValue
                                placeholder={isAr ? "اختر عميل" : "Select customer"}
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {customers?.map((c) => (
                              <SelectItem
                                key={c.id}
                                value={String(c.id)}
                                data-testid={`option-customer-${c.id}`}
                              >
                                {c.nameAr || c.nameEn}
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
                        <FormLabel>{isAr ? "التاريخ" : "Receipt date"}</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} data-testid="input-receipt-date" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                {customerId > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">
                      {isAr ? "اختر الفواتير المراد تحصيلها" : "Select invoices to collect"}
                    </h4>
                    {openInvoices.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {isAr ? "لا فواتير مفتوحة لهذا العميل." : "No open invoices for this customer."}
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
                          {openInvoices.map((i) => {
                            const open = Number(i.totalAmount) - Number(i.paidAmount);
                            const idx = (form.watch("allocations") || []).findIndex(
                              (a) => a.invoiceId === i.id,
                            );
                            const selected = idx >= 0;
                            return (
                              <TableRow key={i.id} data-testid={`row-collect-invoice-${i.id}`}>
                                <TableCell>
                                  <Checkbox
                                    checked={selected}
                                    onCheckedChange={(v) => toggleInvoice(i.id, !!v)}
                                    data-testid={`checkbox-collect-invoice-${i.id}`}
                                  />
                                </TableCell>
                                <TableCell className="font-mono">{i.number}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {i.invoiceDate}
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
                                      data-testid={`input-alloc-amount-${i.id}`}
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
                    {isAr ? "إجمالي التحصيل" : "Receipt total"}
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
                        <Input {...field} value={field.value ?? ""} data-testid="input-receipt-notes" />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setOpen(false)}
                    data-testid="button-cancel-receipt"
                  >
                    {isAr ? "إلغاء" : "Cancel"}
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMut.isPending || fields.length === 0}
                    data-testid="button-submit-receipt"
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
          <CardTitle>{isAr ? "كل سندات القبض" : "All receipts"}</CardTitle>
          <CardDescription>
            {isAr ? "آخر سندات القبض من العملاء والقيود المرتبطة بها." : "Recent customer receipts and their JE links."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <ListSkeleton rows={6} />}
          {!isLoading && (payments?.length ?? 0) === 0 && (
            <EmptyState
              title={isAr ? "لا سندات قبض بعد" : "No receipts yet"}
              description={isAr ? "سجّل أول سند قبض لتخفيض ذمم العملاء." : "Record your first customer receipt to reduce AR."}
            />
          )}
          {!isLoading && (payments?.length ?? 0) > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isAr ? "الرقم" : "#"}</TableHead>
                  <TableHead>{isAr ? "العميل" : "Customer"}</TableHead>
                  <TableHead>{isAr ? "التاريخ" : "Date"}</TableHead>
                  <TableHead>{isAr ? "الفواتير" : "Invoices"}</TableHead>
                  <TableHead className="text-end">{isAr ? "المبلغ" : "Amount"}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments!.map((p) => (
                  <TableRow key={p.id} data-testid={`row-receipt-${p.id}`}>
                    <TableCell className="font-mono" data-testid={`text-receipt-number-${p.id}`}>
                      {p.number}
                    </TableCell>
                    <TableCell>{customerName(p.customerId)}</TableCell>
                    <TableCell className="text-muted-foreground">{p.paymentDate}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {p.allocations.length} {isAr ? "فاتورة" : "invoices"}
                    </TableCell>
                    <TableCell className="text-end font-mono" data-testid={`text-receipt-amount-${p.id}`}>
                      {formatMoney(Number(p.amount))}
                    </TableCell>
                    <TableCell className="text-end">
                      <WriteGuard>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reverseMut.mutate(p.id)}
                          disabled={reverseMut.isPending}
                          data-testid={`button-reverse-receipt-${p.id}`}
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
