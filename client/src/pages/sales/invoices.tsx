import { useMemo, useState } from "react";
import { Link } from "wouter";
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
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { WriteGuard } from "@/components/auth/write-guard";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { Plus, Trash2, Eye } from "lucide-react";
import {
  createSalesInvoiceSchema,
  type CreateSalesInvoiceInput,
  type SalesInvoice,
  type Customer,
  type Product,
  type SalesInvoiceStatus,
} from "@shared/schema";

const STATUS_VARIANTS: Record<SalesInvoiceStatus, "secondary" | "default" | "destructive"> = {
  draft: "secondary",
  posted: "default",
  cancelled: "destructive",
};

export default function SalesInvoicesPage() {
  const t = useT();
  const formatMoney = useFormatMoney();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data: invoices, isLoading } = useQuery<SalesInvoice[]>({
    queryKey: ["/api/sales/invoices"],
  });
  const { data: customers } = useQuery<Customer[]>({ queryKey: ["/api/sales/customers"] });
  const { data: products } = useQuery<Product[]>({ queryKey: ["/api/sales/products"] });
  const { data: nextNum } = useQuery<{ number: string }>({
    queryKey: ["/api/sales/invoices/next-number"],
    enabled: open,
  });

  const today = new Date().toISOString().slice(0, 10);
  const form = useForm<CreateSalesInvoiceInput>({
    resolver: zodResolver(createSalesInvoiceSchema),
    defaultValues: {
      customerId: 0,
      invoiceDate: today,
      dueDate: "",
      status: "draft",
      paymentMethod: "credit",
      notes: "",
      lines: [{ productId: null, description: "", quantity: 1, unitPrice: 0, vatRate: 0, unitCost: 0 }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });

  const createMut = useMutation({
    mutationFn: async (input: CreateSalesInvoiceInput) => {
      const res = await apiRequest("POST", "/api/sales/invoices", input);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales/customers"] });
      setOpen(false);
      form.reset();
      toast({ title: t("salesinv_toast_created") });
    },
    onError: (err: unknown) =>
      toast({
        title: t("salesinv_save_failed"),
        description: t(mapErrorKey(err)),
        variant: "destructive",
      }),
  });

  const customerName = (id: number) => {
    const c = customers?.find((x) => x.id === id);
    return c ? c.nameAr || c.nameEn : `#${id}`;
  };

  const totals = useMemo(() => {
    const lines = form.watch("lines") || [];
    let subtotal = 0;
    let vat = 0;
    for (const l of lines) {
      const lineSub = Number(l.quantity || 0) * Number(l.unitPrice || 0);
      subtotal += lineSub;
      vat += lineSub * Number(l.vatRate || 0);
    }
    return { subtotal, vat, total: subtotal + vat };
  }, [form.watch("lines")]);

  const onPickProduct = (idx: number, productId: number) => {
    const p = products?.find((x) => x.id === productId);
    if (!p) return;
    form.setValue(`lines.${idx}.productId`, p.id);
    form.setValue(`lines.${idx}.description`, p.nameAr || p.nameEn);
    form.setValue(`lines.${idx}.unitPrice`, Number(p.unitPrice));
    form.setValue(`lines.${idx}.unitCost`, Number(p.unitCost));
    if (p.vatRate !== null && p.vatRate !== undefined) {
      form.setValue(`lines.${idx}.vatRate`, Number(p.vatRate));
    }
  };

  return (
    <div className="space-y-8" data-testid="sales-invoices-page">
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-2 max-w-2xl">
          <div className="eyebrow text-muted-foreground/80">
            {t("sales_portal")}
          </div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {t("salesinv_title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {t("salesinv_sub")}
          </p>
        </div>
        <WriteGuard>
          <Button
            data-testid="button-new-invoice"
            onClick={() => setOpen(true)}
          >
            <Plus className="size-4 me-2" />
            {t("salesinv_new")}
          </Button>
        </WriteGuard>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {t("salesinv_new")}
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
                      name="paymentMethod"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("sales_payment")}</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-payment-method">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="credit">{t("sales_credit")}</SelectItem>
                              <SelectItem value="cash">{t("sales_cash")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="invoiceDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("salesinv_invoice_date")}</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} data-testid="input-invoice-date" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="dueDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("salesinv_due_date")}</FormLabel>
                          <FormControl>
                            <Input
                              type="date"
                              {...field}
                              value={field.value ?? ""}
                              data-testid="input-due-date"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">{t("salesinv_lines")}</h4>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          append({
                            productId: null,
                            description: "",
                            quantity: 1,
                            unitPrice: 0,
                            vatRate: 0,
                            unitCost: 0,
                          })
                        }
                        data-testid="button-add-line"
                      >
                        <Plus className="size-4 me-1" />
                        {t("salesinv_add_line")}
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {fields.map((f, idx) => (
                        <div
                          key={f.id}
                          className="grid grid-cols-12 gap-2 items-end border rounded-md p-2"
                          data-testid={`row-line-${idx}`}
                        >
                          <div className="col-span-4">
                            <Select
                              onValueChange={(v) => onPickProduct(idx, Number(v))}
                              value={form.watch(`lines.${idx}.productId`)?.toString() ?? ""}
                            >
                              <SelectTrigger data-testid={`select-product-${idx}`}>
                                <SelectValue placeholder={t("salesinv_pick_product")} />
                              </SelectTrigger>
                              <SelectContent>
                                {products?.map((p) => (
                                  <SelectItem key={p.id} value={String(p.id)}>
                                    {p.nameAr || p.nameEn}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              className="mt-1"
                              placeholder={t("salesinv_description")}
                              {...form.register(`lines.${idx}.description`)}
                              data-testid={`input-line-desc-${idx}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <FormLabel className="text-xs">{t("salesinv_qty")}</FormLabel>
                            <Input
                              type="number"
                              step="0.01"
                              {...form.register(`lines.${idx}.quantity`, { valueAsNumber: true })}
                              data-testid={`input-line-qty-${idx}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <FormLabel className="text-xs">{t("salesinv_price")}</FormLabel>
                            <Input
                              type="number"
                              step="0.01"
                              {...form.register(`lines.${idx}.unitPrice`, { valueAsNumber: true })}
                              data-testid={`input-line-price-${idx}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <FormLabel className="text-xs">{t("salesinv_vat_pct")}</FormLabel>
                            <Input
                              type="number"
                              step="0.01"
                              {...form.register(`lines.${idx}.vatRate`, { valueAsNumber: true })}
                              data-testid={`input-line-vat-${idx}`}
                            />
                          </div>
                          <div className="col-span-2 flex justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => remove(idx)}
                              disabled={fields.length === 1}
                              data-testid={`button-remove-line-${idx}`}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("sales_subtotal")}</span>
                      <span className="font-mono" data-testid="text-form-subtotal">
                        {formatMoney(totals.subtotal)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("sales_vat")}</span>
                      <span className="font-mono" data-testid="text-form-vat">
                        {formatMoney(totals.vat)}
                      </span>
                    </div>
                    <div className="flex justify-between font-semibold border-t pt-1">
                      <span>{t("sales_total")}</span>
                      <span className="font-mono" data-testid="text-form-total">
                        {formatMoney(totals.total)}
                      </span>
                    </div>
                  </div>

                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("salesinv_save_as")}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-status">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="draft">{t("salesinv_draft")}</SelectItem>
                            <SelectItem value="posted">{t("salesinv_post_now")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setOpen(false)}
                      data-testid="button-cancel-invoice"
                    >
                      {t("sales_cancel")}
                    </Button>
                    <Button
                      type="submit"
                      disabled={createMut.isPending}
                      data-testid="button-submit-invoice"
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
          <CardTitle>{t("salesinv_all")}</CardTitle>
          <CardDescription>
            {t("salesinv_all_desc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <ListSkeleton rows={6} />}
          {!isLoading && (invoices?.length ?? 0) === 0 && (
            <EmptyState
              title={t("salesinv_empty")}
              description={t("salesinv_empty_desc")}
            />
          )}
          {!isLoading && (invoices?.length ?? 0) > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("sales_number_hash")}</TableHead>
                  <TableHead>{t("sales_customer")}</TableHead>
                  <TableHead>{t("sales_date")}</TableHead>
                  <TableHead>{t("sales_status")}</TableHead>
                  <TableHead className="text-end">{t("sales_total")}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices!.map((inv) => (
                  <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                    <TableCell className="font-mono" data-testid={`text-invoice-number-${inv.id}`}>
                      {inv.number}
                    </TableCell>
                    <TableCell>{customerName(inv.customerId)}</TableCell>
                    <TableCell className="text-muted-foreground">{inv.invoiceDate}</TableCell>
                    <TableCell>
                      <Badge
                        variant={STATUS_VARIANTS[inv.status as SalesInvoiceStatus]}
                        data-testid={`badge-invoice-status-${inv.id}`}
                      >
                        {inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end font-mono" data-testid={`text-invoice-total-${inv.id}`}>
                      {formatMoney(Number(inv.totalAmount))}
                    </TableCell>
                    <TableCell className="text-end">
                      <Link href={`/app/sales/invoices/${inv.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid={`button-view-invoice-${inv.id}`}
                        >
                          <Eye className="size-4" />
                        </Button>
                      </Link>
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
