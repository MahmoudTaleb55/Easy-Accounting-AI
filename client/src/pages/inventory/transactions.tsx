import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocale } from "@/contexts/locale-context";
import { useT } from "@/i18n/dict";
import { mapErrorKey } from "@/lib/error-messages";
import { useFormatMoney } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { WriteGuard } from "@/components/auth/write-guard";
import { Plus, ArrowLeftRight, Trash2, Undo2 } from "lucide-react";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import {
  createInventoryPurchaseSchema,
  createInventoryAdjustmentSchema,
  createInventoryTransferSchema,
  type InventoryTransactionWithLines,
  type InventoryLocation,
  type Product,
} from "@shared/schema";
import type { z } from "zod";

type PurchaseForm = z.infer<typeof createInventoryPurchaseSchema>;
type AdjustmentForm = z.infer<typeof createInventoryAdjustmentSchema>;
type TransferForm = z.infer<typeof createInventoryTransferSchema>;

const today = () => new Date().toISOString().slice(0, 10);

export default function InventoryTransactionsPage() {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const t = useT();
  const formatMoney = useFormatMoney();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [tab, setTab] = useState<"purchase" | "adjustment" | "transfer">("purchase");

  const { data: rows, isLoading } = useQuery<InventoryTransactionWithLines[]>({
    queryKey: ["/api/inventory/transactions"],
  });
  const { data: locations } = useQuery<InventoryLocation[]>({ queryKey: ["/api/inventory/locations"] });
  const { data: products } = useQuery<Product[]>({ queryKey: ["/api/products"] });

  const locName = (id: number | null | undefined) => {
    if (!id) return "—";
    const l = locations?.find((x) => x.id === id);
    return l ? (isAr ? l.nameAr : (l.nameEn || l.nameAr)) : "—";
  };
  const productName = (id: number) => {
    const p = products?.find((x) => x.id === id);
    return p ? `${p.sku} — ${isAr ? p.nameAr : (p.nameEn || p.nameAr)}` : `#${id}`;
  };

  const reverseMut = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/inventory/transactions/${id}/reverse`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/valuation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/alerts"] });
      toast({ description: t("inv_reversed_toast") });
    },
    onError: (e: unknown) => toast({ variant: "destructive", description: t(mapErrorKey(e)) }),
  });

  // Forms
  const purchaseForm = useForm<PurchaseForm>({
    resolver: zodResolver(createInventoryPurchaseSchema),
    defaultValues: {
      txnDate: today(), locationId: 0 as any, reference: "", vendorName: "", notes: "",
      paymentMethod: "credit",
      lines: [{ productId: 0 as any, description: "", quantity: 1, unitCost: 0 }],
    },
  });
  const purchaseLines = useFieldArray({ control: purchaseForm.control, name: "lines" });

  const adjustForm = useForm<AdjustmentForm>({
    resolver: zodResolver(createInventoryAdjustmentSchema),
    defaultValues: {
      txnDate: today(), locationId: 0 as any, reason: "other", notes: "",
      lines: [{ productId: 0 as any, description: "", quantity: 1, unitCost: 0 }],
    },
  });
  const adjustLines = useFieldArray({ control: adjustForm.control, name: "lines" });

  const transferForm = useForm<TransferForm>({
    resolver: zodResolver(createInventoryTransferSchema),
    defaultValues: {
      txnDate: today(), locationId: 0 as any, destLocationId: 0 as any, notes: "",
      lines: [{ productId: 0 as any, description: "", quantity: 1 }],
    },
  });
  const transferLines = useFieldArray({ control: transferForm.control, name: "lines" });

  const onSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/inventory/transactions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/inventory/valuation"] });
    queryClient.invalidateQueries({ queryKey: ["/api/inventory/alerts"] });
    setCreateOpen(false);
    purchaseForm.reset();
    adjustForm.reset();
    transferForm.reset();
    toast({ description: t("toast_saved") });
  };
  const onError = (e: unknown) => toast({ variant: "destructive", description: t(mapErrorKey(e)) });

  const purchaseMut = useMutation({
    mutationFn: (d: PurchaseForm) => apiRequest("POST", "/api/inventory/purchases", d),
    onSuccess, onError,
  });
  const adjustMut = useMutation({
    mutationFn: (d: AdjustmentForm) => apiRequest("POST", "/api/inventory/adjustments", d),
    onSuccess, onError,
  });
  const transferMut = useMutation({
    mutationFn: (d: TransferForm) => apiRequest("POST", "/api/inventory/transfers", d),
    onSuccess, onError,
  });

  const txnTypeBadge = (type: string) => {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      purchase: { label: t("inv_purchase"), variant: "default" },
      sale: { label: t("inv_sale"), variant: "secondary" },
      adjustment: { label: t("inv_adjustment"), variant: "outline" },
      transfer: { label: t("inv_transfer"), variant: "outline" },
    };
    const m = map[type] ?? { label: type, variant: "outline" as const };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  return (
    <div className="space-y-6 p-6" data-testid="page-inventory-transactions">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("nav_inv_transactions")}</h1>
        <WriteGuard>
          <Button data-testid="button-create-transaction" onClick={() => setCreateOpen(true)}>
            <Plus className="me-1 h-4 w-4" /> {t("inv_create")}
          </Button>
        </WriteGuard>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>{t("inv_create")}</DialogTitle></DialogHeader>
            <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
              <TabsList>
                <TabsTrigger value="purchase" data-testid="tab-purchase">{t("inv_purchase")}</TabsTrigger>
                <TabsTrigger value="adjustment" data-testid="tab-adjustment">{t("inv_adjustment")}</TabsTrigger>
                <TabsTrigger value="transfer" data-testid="tab-transfer">{t("inv_transfer")}</TabsTrigger>
              </TabsList>

              {/* PURCHASE */}
              <TabsContent value="purchase">
                <Form {...purchaseForm}>
                  <form onSubmit={purchaseForm.handleSubmit((d) => purchaseMut.mutate(d))} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={purchaseForm.control} name="txnDate" render={({ field }) => (
                        <FormItem><FormLabel>{t("inv_txn_date")}</FormLabel>
                        <FormControl><Input type="date" {...field} data-testid="input-purchase-date" /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={purchaseForm.control} name="locationId" render={({ field }) => (
                        <FormItem><FormLabel>{t("inv_location")}</FormLabel>
                          <Select value={field.value ? String(field.value) : ""} onValueChange={(v) => field.onChange(Number(v))}>
                            <FormControl><SelectTrigger data-testid="select-purchase-location"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>{(locations ?? []).map((l) => (
                              <SelectItem key={l.id} value={String(l.id)}>{isAr ? l.nameAr : (l.nameEn || l.nameAr)}</SelectItem>
                            ))}</SelectContent>
                          </Select><FormMessage /></FormItem>
                      )} />
                      <FormField control={purchaseForm.control} name="reference" render={({ field }) => (
                        <FormItem><FormLabel>{t("inv_reference")}</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={purchaseForm.control} name="paymentMethod" render={({ field }) => (
                        <FormItem><FormLabel>{t("inv_payment")}</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="credit">{t("inv_credit")}</SelectItem>
                              <SelectItem value="cash">{t("inv_cash")}</SelectItem>
                            </SelectContent>
                          </Select><FormMessage /></FormItem>
                      )} />
                    </div>
                    <div className="space-y-2">
                      {purchaseLines.fields.map((f, i) => (
                        <div key={f.id} className="grid grid-cols-12 gap-2 items-end">
                          <FormField control={purchaseForm.control} name={`lines.${i}.productId`} render={({ field }) => (
                            <FormItem className="col-span-6"><FormLabel className={i > 0 ? "sr-only" : ""}>{t("inv_item")}</FormLabel>
                              <Select value={field.value ? String(field.value) : ""} onValueChange={(v) => field.onChange(Number(v))}>
                                <FormControl><SelectTrigger data-testid={`select-purchase-product-${i}`}><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>{(products ?? []).filter((p) => !p.isService).map((p) => (
                                  <SelectItem key={p.id} value={String(p.id)}>{p.sku} — {isAr ? p.nameAr : (p.nameEn || p.nameAr)}</SelectItem>
                                ))}</SelectContent>
                              </Select><FormMessage /></FormItem>
                          )} />
                          <FormField control={purchaseForm.control} name={`lines.${i}.quantity`} render={({ field }) => (
                            <FormItem className="col-span-2"><FormLabel className={i > 0 ? "sr-only" : ""}>{t("inv_quantity")}</FormLabel>
                              <FormControl><Input type="number" step="0.0001" {...field} data-testid={`input-purchase-qty-${i}`} /></FormControl><FormMessage /></FormItem>
                          )} />
                          <FormField control={purchaseForm.control} name={`lines.${i}.unitCost`} render={({ field }) => (
                            <FormItem className="col-span-3"><FormLabel className={i > 0 ? "sr-only" : ""}>{t("inv_unit_cost")}</FormLabel>
                              <FormControl><Input type="number" step="0.0001" {...field} data-testid={`input-purchase-cost-${i}`} /></FormControl><FormMessage /></FormItem>
                          )} />
                          <Button type="button" size="icon" variant="ghost" onClick={() => purchaseLines.remove(i)} disabled={purchaseLines.fields.length === 1} className="col-span-1">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" onClick={() => purchaseLines.append({ productId: 0 as any, description: "", quantity: 1, unitCost: 0 })}>
                        <Plus className="me-1 h-4 w-4" /> {t("inv_add_line")}
                      </Button>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{t("inv_cancel")}</Button>
                      <Button type="submit" disabled={purchaseMut.isPending} data-testid="button-submit-purchase">{t("inv_save")}</Button>
                    </div>
                  </form>
                </Form>
              </TabsContent>

              {/* ADJUSTMENT */}
              <TabsContent value="adjustment">
                <Form {...adjustForm}>
                  <form onSubmit={adjustForm.handleSubmit((d) => adjustMut.mutate(d))} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={adjustForm.control} name="txnDate" render={({ field }) => (
                        <FormItem><FormLabel>{t("inv_txn_date")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={adjustForm.control} name="locationId" render={({ field }) => (
                        <FormItem><FormLabel>{t("inv_location")}</FormLabel>
                          <Select value={field.value ? String(field.value) : ""} onValueChange={(v) => field.onChange(Number(v))}>
                            <FormControl><SelectTrigger data-testid="select-adjust-location"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>{(locations ?? []).map((l) => (
                              <SelectItem key={l.id} value={String(l.id)}>{isAr ? l.nameAr : (l.nameEn || l.nameAr)}</SelectItem>
                            ))}</SelectContent>
                          </Select><FormMessage /></FormItem>
                      )} />
                    </div>
                    <div className="space-y-2">
                      {adjustLines.fields.map((f, i) => (
                        <div key={f.id} className="grid grid-cols-12 gap-2 items-end">
                          <FormField control={adjustForm.control} name={`lines.${i}.productId`} render={({ field }) => (
                            <FormItem className="col-span-6"><FormLabel className={i > 0 ? "sr-only" : ""}>{t("inv_item")}</FormLabel>
                              <Select value={field.value ? String(field.value) : ""} onValueChange={(v) => field.onChange(Number(v))}>
                                <FormControl><SelectTrigger data-testid={`select-adjust-product-${i}`}><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>{(products ?? []).filter((p) => !p.isService).map((p) => (
                                  <SelectItem key={p.id} value={String(p.id)}>{p.sku} — {isAr ? p.nameAr : (p.nameEn || p.nameAr)}</SelectItem>
                                ))}</SelectContent>
                              </Select><FormMessage /></FormItem>
                          )} />
                          <FormField control={adjustForm.control} name={`lines.${i}.quantity`} render={({ field }) => (
                            <FormItem className="col-span-2"><FormLabel className={i > 0 ? "sr-only" : ""}>{t("inv_quantity")}</FormLabel>
                              <FormControl><Input type="number" step="0.0001" {...field} data-testid={`input-adjust-qty-${i}`} /></FormControl><FormMessage /></FormItem>
                          )} />
                          <FormField control={adjustForm.control} name={`lines.${i}.unitCost`} render={({ field }) => (
                            <FormItem className="col-span-3"><FormLabel className={i > 0 ? "sr-only" : ""}>{t("inv_unit_cost")}</FormLabel>
                              <FormControl><Input type="number" step="0.0001" {...field} /></FormControl><FormMessage /></FormItem>
                          )} />
                          <Button type="button" size="icon" variant="ghost" onClick={() => adjustLines.remove(i)} disabled={adjustLines.fields.length === 1} className="col-span-1">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" onClick={() => adjustLines.append({ productId: 0 as any, description: "", quantity: 1, unitCost: 0 })}>
                        <Plus className="me-1 h-4 w-4" /> {t("inv_add_line")}
                      </Button>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{t("inv_cancel")}</Button>
                      <Button type="submit" disabled={adjustMut.isPending} data-testid="button-submit-adjustment">{t("inv_save")}</Button>
                    </div>
                  </form>
                </Form>
              </TabsContent>

              {/* TRANSFER */}
              <TabsContent value="transfer">
                <Form {...transferForm}>
                  <form onSubmit={transferForm.handleSubmit((d) => transferMut.mutate(d))} className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <FormField control={transferForm.control} name="txnDate" render={({ field }) => (
                        <FormItem><FormLabel>{t("inv_txn_date")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={transferForm.control} name="locationId" render={({ field }) => (
                        <FormItem><FormLabel>{t("inv_location")}</FormLabel>
                          <Select value={field.value ? String(field.value) : ""} onValueChange={(v) => field.onChange(Number(v))}>
                            <FormControl><SelectTrigger data-testid="select-transfer-from"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>{(locations ?? []).map((l) => (
                              <SelectItem key={l.id} value={String(l.id)}>{isAr ? l.nameAr : (l.nameEn || l.nameAr)}</SelectItem>
                            ))}</SelectContent>
                          </Select><FormMessage /></FormItem>
                      )} />
                      <FormField control={transferForm.control} name="destLocationId" render={({ field }) => (
                        <FormItem><FormLabel>{t("inv_dest_location")}</FormLabel>
                          <Select value={field.value ? String(field.value) : ""} onValueChange={(v) => field.onChange(Number(v))}>
                            <FormControl><SelectTrigger data-testid="select-transfer-to"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>{(locations ?? []).map((l) => (
                              <SelectItem key={l.id} value={String(l.id)}>{isAr ? l.nameAr : (l.nameEn || l.nameAr)}</SelectItem>
                            ))}</SelectContent>
                          </Select><FormMessage /></FormItem>
                      )} />
                    </div>
                    <div className="space-y-2">
                      {transferLines.fields.map((f, i) => (
                        <div key={f.id} className="grid grid-cols-12 gap-2 items-end">
                          <FormField control={transferForm.control} name={`lines.${i}.productId`} render={({ field }) => (
                            <FormItem className="col-span-8"><FormLabel className={i > 0 ? "sr-only" : ""}>{t("inv_item")}</FormLabel>
                              <Select value={field.value ? String(field.value) : ""} onValueChange={(v) => field.onChange(Number(v))}>
                                <FormControl><SelectTrigger data-testid={`select-transfer-product-${i}`}><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>{(products ?? []).filter((p) => !p.isService).map((p) => (
                                  <SelectItem key={p.id} value={String(p.id)}>{p.sku} — {isAr ? p.nameAr : (p.nameEn || p.nameAr)}</SelectItem>
                                ))}</SelectContent>
                              </Select><FormMessage /></FormItem>
                          )} />
                          <FormField control={transferForm.control} name={`lines.${i}.quantity`} render={({ field }) => (
                            <FormItem className="col-span-3"><FormLabel className={i > 0 ? "sr-only" : ""}>{t("inv_quantity")}</FormLabel>
                              <FormControl><Input type="number" step="0.0001" {...field} data-testid={`input-transfer-qty-${i}`} /></FormControl><FormMessage /></FormItem>
                          )} />
                          <Button type="button" size="icon" variant="ghost" onClick={() => transferLines.remove(i)} disabled={transferLines.fields.length === 1} className="col-span-1">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" onClick={() => transferLines.append({ productId: 0 as any, description: "", quantity: 1 })}>
                        <Plus className="me-1 h-4 w-4" /> {t("inv_add_line")}
                      </Button>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{t("inv_cancel")}</Button>
                      <Button type="submit" disabled={transferMut.isPending} data-testid="button-submit-transfer">{t("inv_save")}</Button>
                    </div>
                  </form>
                </Form>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("nav_inv_transactions")}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <ListSkeleton rows={6} /> : (rows ?? []).length === 0 ? (
            <EmptyState icon={<ArrowLeftRight className="h-6 w-6" />} title={t("inv_no_data")} description="" />
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t("inv_no")}</TableHead>
                <TableHead>{t("inv_txn_date")}</TableHead>
                <TableHead>{t("inv_txn_type")}</TableHead>
                <TableHead>{t("inv_location")}</TableHead>
                <TableHead className="text-end">{t("inv_total_cost")}</TableHead>
                <TableHead>{t("inv_status")}</TableHead>
                <TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(rows ?? []).map((r) => (
                  <TableRow key={r.id} data-testid={`row-txn-${r.id}`}>
                    <TableCell className="font-mono">{r.number}</TableCell>
                    <TableCell>{r.txnDate}</TableCell>
                    <TableCell>{txnTypeBadge(r.type)}</TableCell>
                    <TableCell>
                      {locName(r.locationId)}
                      {r.destLocationId ? <span className="mx-1 text-muted-foreground">→ {locName(r.destLocationId)}</span> : null}
                    </TableCell>
                    <TableCell className="text-end">{formatMoney(Number(r.totalAmount ?? 0))}</TableCell>
                    <TableCell>
                      {r.status === "reversed" ? <Badge variant="destructive">{t("inv_reversed")}</Badge> : <Badge variant="secondary">{t("inv_posted")}</Badge>}
                    </TableCell>
                    <TableCell>
                      {r.status !== "reversed" && r.type !== "sale" && (
                        <WriteGuard>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-reverse-${r.id}`}
                            onClick={() => {
                              if (confirm(t("inv_confirm_reverse"))) reverseMut.mutate(r.id);
                            }}
                          >
                            <Undo2 className="me-1 h-4 w-4" /> {t("inv_reverse")}
                          </Button>
                        </WriteGuard>
                      )}
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
