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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { WriteGuard } from "@/components/auth/write-guard";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { Plus, Trash2, Eye } from "lucide-react";
import {
  createPurchaseInvoiceSchema,
  type CreatePurchaseInvoiceInput,
  type PurchaseInvoice,
  type Vendor,
  type Product,
  type InventoryLocation,
  type PurchaseInvoiceStatus,
} from "@shared/schema";

const STATUS_VARIANTS: Record<PurchaseInvoiceStatus, "secondary" | "default" | "destructive"> = {
  draft: "secondary",
  posted: "default",
  cancelled: "destructive",
};

export default function PurchaseBillsPage() {
  const t = useT();
  const formatMoney = useFormatMoney();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data: bills, isLoading } = useQuery<PurchaseInvoice[]>({
    queryKey: ["/api/purchases/bills"],
  });
  const { data: vendors } = useQuery<Vendor[]>({ queryKey: ["/api/purchases/vendors"] });
  const { data: products } = useQuery<Product[]>({ queryKey: ["/api/sales/products"] });
  const { data: locations } = useQuery<InventoryLocation[]>({
    queryKey: ["/api/inventory/locations"],
  });
  const { data: nextNum } = useQuery<{ number: string }>({
    queryKey: ["/api/purchases/bills/next-number"],
    enabled: open,
  });

  const today = new Date().toISOString().slice(0, 10);
  const form = useForm<CreatePurchaseInvoiceInput>({
    resolver: zodResolver(createPurchaseInvoiceSchema),
    defaultValues: {
      vendorId: 0,
      invoiceDate: today,
      dueDate: "",
      status: "draft",
      paymentMethod: "credit",
      vendorReference: "",
      notes: "",
      locationId: null,
      lines: [{ productId: null, description: "", quantity: 1, unitCost: 0, vatRate: 0, expenseAccountCode: "" }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });

  const createMut = useMutation({
    mutationFn: async (input: CreatePurchaseInvoiceInput) => {
      const res = await apiRequest("POST", "/api/purchases/bills", input);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchases/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchases/vendors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchases/aging"] });
      setOpen(false);
      form.reset();
      toast({ title: t("bill_toast_created") });
    },
    onError: (err: unknown) =>
      toast({
        title: t("purch_save_failed"),
        description: t(mapErrorKey(err)),
        variant: "destructive",
      }),
  });

  const vendorName = (id: number) => {
    const v = vendors?.find((x) => x.id === id);
    return v ? v.nameAr || v.nameEn : `#${id}`;
  };

  const totals = useMemo(() => {
    const lines = form.watch("lines") || [];
    let subtotal = 0;
    let vat = 0;
    for (const l of lines) {
      const lineSub = Number(l.quantity || 0) * Number(l.unitCost || 0);
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
    form.setValue(`lines.${idx}.unitCost`, Number(p.unitCost));
    if (p.vatRate !== null && p.vatRate !== undefined) {
      form.setValue(`lines.${idx}.vatRate`, Number(p.vatRate));
    }
  };

  return (
    <div className="space-y-8" data-testid="purchases-bills-page">
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-2 max-w-2xl">
          <div className="eyebrow text-muted-foreground/80">
            {t("purch_portal")}
          </div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {t("bill_title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {t("bill_sub")}
          </p>
        </div>
        <WriteGuard>
          <Button data-testid="button-new-bill" onClick={() => setOpen(true)}>
            <Plus className="size-4 me-2" />
            {t("bill_new")}
          </Button>
        </WriteGuard>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {t("bill_new")}
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
                        <FormLabel>{t("purch_vendor")}</FormLabel>
                        <Select
                          onValueChange={(v) => field.onChange(Number(v))}
                          value={field.value ? String(field.value) : ""}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-vendor">
                              <SelectValue
                                placeholder={t("purch_select_vendor")}
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
                    name="paymentMethod"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("purch_payment")}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-payment-method">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="credit">{t("purch_credit")}</SelectItem>
                            <SelectItem value="cash">{t("purch_cash")}</SelectItem>
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
                        <FormLabel>{t("bill_date")}</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} data-testid="input-bill-date" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="dueDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("bill_due_date")}</FormLabel>
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
                  <FormField
                    control={form.control}
                    name="vendorReference"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("bill_vendor_ref")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} data-testid="input-vendor-ref" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="locationId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("bill_location")}</FormLabel>
                        <Select
                          onValueChange={(v) => field.onChange(v ? Number(v) : null)}
                          value={field.value ? String(field.value) : ""}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-location">
                              <SelectValue placeholder={t("bill_default")} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {locations?.map((l) => (
                              <SelectItem key={l.id} value={String(l.id)}>
                                {l.nameAr || l.nameEn}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">{t("bill_lines")}</h4>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        append({
                          productId: null,
                          description: "",
                          quantity: 1,
                          unitCost: 0,
                          vatRate: 0,
                          expenseAccountCode: "",
                        })
                      }
                      data-testid="button-add-line"
                    >
                      <Plus className="size-4 me-1" />
                      {t("bill_add_line")}
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
                              <SelectValue placeholder={t("bill_pick_product")} />
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
                            placeholder={t("bill_description")}
                            {...form.register(`lines.${idx}.description`)}
                            data-testid={`input-line-desc-${idx}`}
                          />
                        </div>
                        <div className="col-span-2">
                          <FormLabel className="text-xs">{t("bill_qty")}</FormLabel>
                          <Input
                            type="number"
                            step="0.01"
                            {...form.register(`lines.${idx}.quantity`, { valueAsNumber: true })}
                            data-testid={`input-line-qty-${idx}`}
                          />
                        </div>
                        <div className="col-span-2">
                          <FormLabel className="text-xs">{t("bill_cost")}</FormLabel>
                          <Input
                            type="number"
                            step="0.01"
                            {...form.register(`lines.${idx}.unitCost`, { valueAsNumber: true })}
                            data-testid={`input-line-cost-${idx}`}
                          />
                        </div>
                        <div className="col-span-2">
                          <FormLabel className="text-xs">{t("bill_vat_pct")}</FormLabel>
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
                    <span className="text-muted-foreground">{t("purch_subtotal")}</span>
                    <span className="font-mono" data-testid="text-form-subtotal">
                      {formatMoney(totals.subtotal)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("purch_input_vat")}</span>
                    <span className="font-mono" data-testid="text-form-vat">
                      {formatMoney(totals.vat)}
                    </span>
                  </div>
                  <div className="flex justify-between font-semibold border-t pt-1">
                    <span>{t("purch_total")}</span>
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
                      <FormLabel>{t("bill_save_as")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-status">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="draft">{t("bill_draft")}</SelectItem>
                          <SelectItem value="posted">{t("bill_post_now")}</SelectItem>
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
                    data-testid="button-cancel-bill"
                  >
                    {t("purch_cancel")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMut.isPending}
                    data-testid="button-submit-bill"
                  >
                    {createMut.isPending ? t("purch_saving") : t("purch_save")}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("bill_all")}</CardTitle>
          <CardDescription>
            {t("bill_all_desc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <ListSkeleton rows={6} />}
          {!isLoading && (bills?.length ?? 0) === 0 && (
            <EmptyState
              title={t("bill_empty")}
              description={t("bill_empty_desc")}
            />
          )}
          {!isLoading && (bills?.length ?? 0) > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("purch_number_hash")}</TableHead>
                  <TableHead>{t("purch_vendor")}</TableHead>
                  <TableHead>{t("purch_date")}</TableHead>
                  <TableHead>{t("purch_status")}</TableHead>
                  <TableHead className="text-end">{t("purch_total")}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills!.map((inv) => (
                  <TableRow key={inv.id} data-testid={`row-bill-${inv.id}`}>
                    <TableCell className="font-mono" data-testid={`text-bill-number-${inv.id}`}>
                      {inv.number}
                    </TableCell>
                    <TableCell>{vendorName(inv.vendorId)}</TableCell>
                    <TableCell className="text-muted-foreground">{inv.invoiceDate}</TableCell>
                    <TableCell>
                      <Badge
                        variant={STATUS_VARIANTS[inv.status as PurchaseInvoiceStatus]}
                        data-testid={`badge-bill-status-${inv.id}`}
                      >
                        {inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end font-mono" data-testid={`text-bill-total-${inv.id}`}>
                      {formatMoney(Number(inv.totalAmount))}
                    </TableCell>
                    <TableCell className="text-end">
                      <Link href={`/app/purchases/bills/${inv.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid={`button-view-bill-${inv.id}`}
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
