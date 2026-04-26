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
  const { locale } = useLocale();
  const isAr = locale === "ar";
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
      toast({ title: isAr ? "تم حفظ العميل" : "Customer saved" });
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
    <div className="space-y-8" data-testid="sales-customers-page">
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-2 max-w-2xl">
          <div className="eyebrow text-muted-foreground/80">
            {isAr ? "بوابة المبيعات" : "Sales Portal"}
          </div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {isAr ? "العملاء" : "Customers"}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {isAr
              ? "أنشئ عملاءك وتتبّع أرصدتهم وفواتيرهم — مع تسجيل تلقائي في دفتر الأستاذ."
              : "Create customers, track their AR balance and invoice history — auto-posted to the ledger."}
          </p>
        </div>
        <WriteGuard>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-customer">
                <Plus className="size-4 me-2" />
                {isAr ? "عميل جديد" : "New customer"}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{isAr ? "عميل جديد" : "New customer"}</DialogTitle>
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
                        <FormLabel>{isAr ? "الاسم بالإنجليزية" : "English name"}</FormLabel>
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
                          <FormLabel>{isAr ? "الكود" : "Code"}</FormLabel>
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
                          <FormLabel>{isAr ? "الرقم الضريبي" : "Tax number"}</FormLabel>
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
                          <FormLabel>{isAr ? "الهاتف" : "Phone"}</FormLabel>
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
                          <FormLabel>{isAr ? "البريد" : "Email"}</FormLabel>
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
                    {createMut.isPending
                      ? isAr ? "جارٍ الحفظ…" : "Saving…"
                      : isAr ? "حفظ" : "Save"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </WriteGuard>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{isAr ? "قائمة العملاء" : "Customers"}</CardTitle>
          <CardDescription>
            {isAr ? "اضغط على عميل لرؤية رصيده وفواتيره" : "Click a customer to view balance and invoices"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <ListSkeleton rows={5} />}
          {!isLoading && (customers?.length ?? 0) === 0 && (
            <EmptyState
              title={isAr ? "لا يوجد عملاء بعد" : "No customers yet"}
              description={isAr ? "أضف أول عميل لبدء فوترة المبيعات." : "Add your first customer to start invoicing."}
            />
          )}
          {!isLoading && (customers?.length ?? 0) > 0 && (
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
                {customers!.map((c) => (
                  <CustomerRow
                    key={c.id}
                    customer={c}
                    onView={() => setSelected(c)}
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
        <DialogContent className="max-w-2xl" data-testid="dialog-customer-detail">
          {selected && <CustomerDetail customer={selected} isAr={isAr} formatMoney={formatMoney} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CustomerRow({
  customer,
  onView,
  formatMoney,
  isAr,
}: {
  customer: Customer;
  onView: () => void;
  formatMoney: (v: number) => string;
  isAr: boolean;
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
  isAr,
  formatMoney,
}: {
  customer: Customer;
  isAr: boolean;
  formatMoney: (v: number) => string;
}) {
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
            {isAr ? "الرصيد المستحق" : "Open AR balance"}
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
          {isAr ? "آخر الفواتير" : "Recent invoices"}
        </div>
        {(history?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isAr ? "لا فواتير بعد." : "No invoices yet."}
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
