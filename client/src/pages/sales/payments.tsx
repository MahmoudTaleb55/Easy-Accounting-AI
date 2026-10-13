import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
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
  const t = useT();
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
      toast({ title: t("salespay_toast_saved") });
    },
    onError: (err: unknown) =>
      toast({
        title: t("salespay_save_failed"),
        description: t(mapErrorKey(err)),
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
      toast({ title: t("salespay_toast_reversed") });
    },
    onError: (err: unknown) =>
      toast({
        title: t("salespay_reverse_failed"),
        description: t(mapErrorKey(err)),
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
            {t("sales_portal")}
          </div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {t("salespay_title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {t("salespay_sub")}
          </p>
        </div>
        <WriteGuard>
          <Button data-testid="button-new-receipt" onClick={() => setOpen(true)}>
            <Plus className="size-4 me-2" />
            {t("salespay_new")}
          </Button>
        </WriteGuard>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {t("salespay_new")}
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
                        <FormLabel>{t("sales_customer")}</FormLabel>
                        <Select
                          onValueChange={(v) => field.onChange(Number(v))}
                          value={field.value ? String(field.value) : ""}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-customer">
                              <SelectValue
                                placeholder={t("sales_select_customer")}
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
                        <FormLabel>{t("salespay_date")}</FormLabel>
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
                      {t("salespay_select_inv")}
                    </h4>
                    {openInvoices.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t("salespay_no_open_inv")}
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead></TableHead>
                            <TableHead>{t("sales_number_hash")}</TableHead>
                            <TableHead>{t("sales_date")}</TableHead>
                            <TableHead className="text-end">{t("salespay_open")}</TableHead>
                            <TableHead className="text-end">{t("salespay_amount")}</TableHead>
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
                    {t("salespay_receipt_total")}
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
                      <FormLabel>{t("salespay_notes")}</FormLabel>
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
                    {t("sales_cancel")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMut.isPending || fields.length === 0}
                    data-testid="button-submit-receipt"
                  >
                    {createMut.isPending ? t("sales_saving") : t("sales_save")}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("salespay_all")}</CardTitle>
          <CardDescription>
            {t("salespay_all_desc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <ListSkeleton rows={6} />}
          {!isLoading && (payments?.length ?? 0) === 0 && (
            <EmptyState
              title={t("salespay_empty")}
              description={t("salespay_empty_desc")}
            />
          )}
          {!isLoading && (payments?.length ?? 0) > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("sales_number_hash")}</TableHead>
                  <TableHead>{t("sales_customer")}</TableHead>
                  <TableHead>{t("sales_date")}</TableHead>
                  <TableHead>{t("salespay_invoices")}</TableHead>
                  <TableHead className="text-end">{t("salespay_amount")}</TableHead>
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
                      {p.allocations.length} {t("salespay_invoices_count")}
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
