import { useMemo, useState } from "react";
import { Link } from "wouter";
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
  const { locale } = useLocale();
  const isAr = locale === "ar";
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
      customerId: 0 as any,
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
      toast({ title: isAr ? "تم إنشاء الفاتورة" : "Invoice created" });
    },
    onError: (err: any) =>
      toast({
        title: isAr ? "تعذر الحفظ" : "Save failed",
        description: err?.message,
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
            {isAr ? "بوابة المبيعات" : "Sales Portal"}
          </div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {isAr ? "فواتير المبيعات" : "Sales Invoices"}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {isAr
              ? "أنشئ فواتيرك واعتمدها لتُرحَّل تلقائياً إلى دفتر الأستاذ — ضريبة القيمة المضافة وتكلفة البضاعة المباعة محسوبة لك."
              : "Create and post invoices — VAT and COGS are auto-posted to the ledger."}
          </p>
        </div>
        <WriteGuard>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-invoice">
                <Plus className="size-4 me-2" />
                {isAr ? "فاتورة جديدة" : "New invoice"}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {isAr ? "فاتورة جديدة" : "New invoice"}
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
                      name="paymentMethod"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{isAr ? "طريقة الدفع" : "Payment"}</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-payment-method">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="credit">{isAr ? "آجل" : "Credit"}</SelectItem>
                              <SelectItem value="cash">{isAr ? "نقدي" : "Cash"}</SelectItem>
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
                          <FormLabel>{isAr ? "تاريخ الفاتورة" : "Invoice date"}</FormLabel>
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
                          <FormLabel>{isAr ? "تاريخ الاستحقاق" : "Due date"}</FormLabel>
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
                      <h4 className="text-sm font-medium">{isAr ? "البنود" : "Lines"}</h4>
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
                        {isAr ? "إضافة بند" : "Add line"}
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
                                <SelectValue placeholder={isAr ? "اختر منتج" : "Pick product"} />
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
                              placeholder={isAr ? "وصف" : "Description"}
                              {...form.register(`lines.${idx}.description`)}
                              data-testid={`input-line-desc-${idx}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <FormLabel className="text-xs">{isAr ? "الكمية" : "Qty"}</FormLabel>
                            <Input
                              type="number"
                              step="0.01"
                              {...form.register(`lines.${idx}.quantity`, { valueAsNumber: true })}
                              data-testid={`input-line-qty-${idx}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <FormLabel className="text-xs">{isAr ? "السعر" : "Price"}</FormLabel>
                            <Input
                              type="number"
                              step="0.01"
                              {...form.register(`lines.${idx}.unitPrice`, { valueAsNumber: true })}
                              data-testid={`input-line-price-${idx}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <FormLabel className="text-xs">{isAr ? "ض.ق.م" : "VAT %"}</FormLabel>
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
                      <span className="text-muted-foreground">{isAr ? "الإجمالي قبل الضريبة" : "Subtotal"}</span>
                      <span className="font-mono" data-testid="text-form-subtotal">
                        {formatMoney(totals.subtotal)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{isAr ? "ضريبة القيمة المضافة" : "VAT"}</span>
                      <span className="font-mono" data-testid="text-form-vat">
                        {formatMoney(totals.vat)}
                      </span>
                    </div>
                    <div className="flex justify-between font-semibold border-t pt-1">
                      <span>{isAr ? "الإجمالي" : "Total"}</span>
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
                        <FormLabel>{isAr ? "الحالة عند الحفظ" : "Save as"}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-status">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="draft">{isAr ? "مسودة" : "Draft"}</SelectItem>
                            <SelectItem value="posted">{isAr ? "ترحيل فوري" : "Post now"}</SelectItem>
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
                      {isAr ? "إلغاء" : "Cancel"}
                    </Button>
                    <Button
                      type="submit"
                      disabled={createMut.isPending}
                      data-testid="button-submit-invoice"
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
        </WriteGuard>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{isAr ? "كل الفواتير" : "All invoices"}</CardTitle>
          <CardDescription>
            {isAr ? "اضغط على الفاتورة لعرض التفاصيل والتحكم بالحالة." : "Click an invoice to view details and lifecycle."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <ListSkeleton rows={6} />}
          {!isLoading && (invoices?.length ?? 0) === 0 && (
            <EmptyState
              title={isAr ? "لا فواتير بعد" : "No invoices yet"}
              description={isAr ? "أنشئ أول فاتورة لتتبّع المبيعات." : "Create your first invoice to start tracking sales."}
            />
          )}
          {!isLoading && (invoices?.length ?? 0) > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isAr ? "الرقم" : "#"}</TableHead>
                  <TableHead>{isAr ? "العميل" : "Customer"}</TableHead>
                  <TableHead>{isAr ? "التاريخ" : "Date"}</TableHead>
                  <TableHead>{isAr ? "الحالة" : "Status"}</TableHead>
                  <TableHead className="text-end">{isAr ? "الإجمالي" : "Total"}</TableHead>
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
