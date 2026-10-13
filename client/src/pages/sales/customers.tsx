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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { WriteGuard } from "@/components/auth/write-guard";
import { Plus, Wallet, Eye } from "lucide-react";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { insertCustomerSchema, type Customer, type SalesInvoice } from "@shared/schema";
import type { z } from "zod";

type CustomerForm = z.infer<typeof insertCustomerSchema>;

export default function SalesCustomersPage() {
  const t = useT();
  const formatMoney = useFormatMoney();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);

  const { data: customers, isLoading } = useQuery<Customer[]>({
    queryKey: ["/api/sales/customers"],
  });

  const form = useForm<CustomerForm>({
    resolver: zodResolver(insertCustomerSchema),
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
    mutationFn: async (input: CustomerForm) => {
      const res = await apiRequest("POST", "/api/sales/customers", input);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales/customers"] });
      setCreateOpen(false);
      form.reset();
      toast({ title: t("toast_saved") });
    },
    onError: (err: unknown) => {
      toast({
        title: t("salesinv_save_failed"),
        description: t(mapErrorKey(err)),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-8" data-testid="sales-customers-page">
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-2 max-w-2xl">
          <div className="eyebrow text-muted-foreground/80">
            {t("sales_portal")}
          </div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {t("salescust_title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {t("salescust_sub")}
          </p>
        </div>
        <WriteGuard>
          <Button
            data-testid="button-new-customer"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4 me-2" />
            {t("salescust_new")}
          </Button>
        </WriteGuard>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{t("salescust_new")}</DialogTitle>
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
                        <FormLabel>{t("salescust_name_ar")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} data-testid="input-customer-name-ar" />
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
                        <FormLabel>{t("salescust_name_en")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} data-testid="input-customer-name-en" />
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
                          <FormLabel>{t("salescust_code")}</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} data-testid="input-customer-code" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="taxNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("salescust_tax")}</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} data-testid="input-customer-tax" />
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
                          <FormLabel>{t("salescust_phone")}</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} data-testid="input-customer-phone" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("salescust_email")}</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} data-testid="input-customer-email" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={createMut.isPending}
                    data-testid="button-submit-customer"
                  >
                    {createMut.isPending ? t("sales_saving") : t("sales_save")}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("salescust_list_title")}</CardTitle>
          <CardDescription>
            {t("salescust_list_desc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <ListSkeleton rows={5} />}
          {!isLoading && (customers?.length ?? 0) === 0 && (
            <EmptyState
              title={t("salescust_empty")}
              description={t("salescust_empty_desc")}
            />
          )}
          {!isLoading && (customers?.length ?? 0) > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("salescust_col_name")}</TableHead>
                  <TableHead>{t("salescust_code")}</TableHead>
                  <TableHead>{t("salescust_phone")}</TableHead>
                  <TableHead className="text-end">{t("salescust_col_balance")}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers!.map((c) => (
                  <CustomerRow
                    key={c.id}
                    customer={c}
                    onView={() => setSelected(c)}
                    formatMoney={formatMoney}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-customer-detail">
          {selected && <CustomerDetail customer={selected} formatMoney={formatMoney} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CustomerRow({
  customer,
  onView,
  formatMoney,
}: {
  customer: Customer;
  onView: () => void;
  formatMoney: (v: number) => string;
}) {
  const { data } = useQuery<{ balance: number }>({
    queryKey: ["/api/sales/customers", customer.id, "balance"],
  });
  return (
    <TableRow data-testid={`row-customer-${customer.id}`}>
      <TableCell className="font-medium" data-testid={`text-customer-name-${customer.id}`}>
        {customer.nameAr || customer.nameEn}
      </TableCell>
      <TableCell className="text-muted-foreground">{customer.code || "—"}</TableCell>
      <TableCell className="text-muted-foreground">{customer.phone || "—"}</TableCell>
      <TableCell
        className="text-end font-mono"
        data-testid={`text-customer-balance-${customer.id}`}
      >
        {formatMoney(data?.balance ?? 0)}
      </TableCell>
      <TableCell className="text-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={onView}
          data-testid={`button-view-customer-${customer.id}`}
        >
          <Eye className="size-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function CustomerDetail({
  customer,
  formatMoney,
}: {
  customer: Customer;
  formatMoney: (v: number) => string;
}) {
  const t = useT();
  const { data: balance } = useQuery<{ balance: number }>({
    queryKey: ["/api/sales/customers", customer.id, "balance"],
  });
  const { data: history } = useQuery<SalesInvoice[]>({
    queryKey: ["/api/sales/customers", customer.id, "history"],
  });
  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle data-testid="text-customer-detail-name">
          {customer.nameAr || customer.nameEn}
        </DialogTitle>
      </DialogHeader>
      <div className="rounded-md border p-4 flex items-center gap-3 bg-muted/30">
        <Wallet className="size-5 text-primary" />
        <div className="flex-1">
          <div className="eyebrow text-muted-foreground">
            {t("salescust_open_ar")}
          </div>
          <div
            className="text-xl font-mono font-semibold"
            data-testid="text-customer-detail-balance"
          >
            {formatMoney(balance?.balance ?? 0)}
          </div>
        </div>
      </div>
      <div>
        <div className="text-sm font-medium mb-2">
          {t("salescust_recent_inv")}
        </div>
        {(history?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("salescust_no_inv")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("sales_number_hash")}</TableHead>
                <TableHead>{t("sales_date")}</TableHead>
                <TableHead>{t("sales_status")}</TableHead>
                <TableHead className="text-end">{t("sales_total")}</TableHead>
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
