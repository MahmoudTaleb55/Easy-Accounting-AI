import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  insertBankTransactionSchema, BANK_TXN_TYPES,
  type BankAccount, type BankTransactionWithAccount,
} from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocale } from "@/contexts/locale-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Minus, ListOrdered } from "lucide-react";
import { WriteGuard } from "@/components/auth/write-guard";
import { format } from "date-fns";
import { ar as arLocale, enUS } from "date-fns/locale";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

const formSchema = insertBankTransactionSchema.extend({
  amount: z.coerce.number().positive("يجب أن يكون المبلغ أكبر من صفر"),
  txnDate: z.string().min(1),
});
type FormValues = z.infer<typeof formSchema>;

const TXN_TYPE_META: Record<string, { ar: string; en: string; icon: React.ReactNode; color: string }> = {
  deposit:    { ar: "إيداع",    en: "Deposit",    icon: <ArrowDownLeft className="h-3.5 w-3.5" />, color: "text-success" },
  withdrawal: { ar: "سحب",     en: "Withdrawal", icon: <ArrowUpRight className="h-3.5 w-3.5" />,  color: "text-destructive" },
  transfer:   { ar: "تحويل",   en: "Transfer",   icon: <ArrowLeftRight className="h-3.5 w-3.5" />, color: "text-primary" },
  fee:        { ar: "رسوم",    en: "Fee",        icon: <Minus className="h-3.5 w-3.5" />,          color: "text-warning" },
};

function amountSign(type: string, isCredit: boolean): string {
  if (type === "deposit") return "+";
  if (type === "withdrawal" || type === "fee") return "−";
  if (type === "transfer") return isCredit ? "+" : "−";
  return "";
}

export default function BankingTransactionsPage() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const dfLocale = ar ? arLocale : enUS;
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [filterAccount, setFilterAccount] = useState<string>("all");

  const { data: accounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["/api/banking/accounts"],
  });

  const { data: transactions = [], isLoading } = useQuery<BankTransactionWithAccount[]>({
    queryKey: ["/api/banking/transactions"],
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      bankAccountId: undefined as any,
      txnType: "deposit",
      amount: 0,
      description: "",
      txnDate: new Date().toISOString().slice(0, 10),
    },
  });

  const txnType = form.watch("txnType");

  const createMutation = useMutation({
    mutationFn: (data: FormValues) => apiRequest("POST", "/api/banking/transactions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/banking/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/banking/accounts"] });
      toast({ title: ar ? "تمت إضافة المعاملة" : "Transaction recorded" });
      setOpen(false);
      form.reset();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const filtered = filterAccount === "all"
    ? transactions
    : transactions.filter((t) => String(t.bankAccountId) === filterAccount);

  function getAmountDisplay(t: BankTransactionWithAccount, currentAccountId?: number) {
    const amt = parseFloat(t.amount);
    const isInbound = t.txnType === "deposit" ||
      (t.txnType === "transfer" && t.counterpartBankAccountId === currentAccountId);
    const sign = isInbound ? "+" : "−";
    const color = isInbound ? "text-success" : "text-destructive";
    return { sign, color, amt };
  }

  const accountIdNum = filterAccount !== "all" ? parseInt(filterAccount) : undefined;

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground" data-testid="text-page-title">
            {ar ? "معاملات البنك" : "Bank Transactions"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {ar
              ? "تسجيل الإيداعات والسحوبات والتحويلات مع ترحيل آلي للقيود"
              : "Record deposits, withdrawals & transfers with automatic journal posting"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length === 0 ? (
            <Link href="/app/banking/accounts">
              <Button size="sm" variant="outline">
                {ar ? "أضف حساباً أولاً" : "Add an account first"}
              </Button>
            </Link>
          ) : (
            <WriteGuard>
              <Button size="sm" onClick={() => setOpen(true)} data-testid="button-add-transaction">
                <Plus className="h-4 w-4 me-1" />
                {ar ? "معاملة جديدة" : "New transaction"}
              </Button>
            </WriteGuard>
          )}
        </div>
      </div>

      {/* Filter by account */}
      {accounts.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant={filterAccount === "all" ? "default" : "outline"}
            onClick={() => setFilterAccount("all")}
          >
            {ar ? "الكل" : "All"}
          </Button>
          {accounts.map((a) => (
            <Button
              key={a.id}
              size="sm"
              variant={filterAccount === String(a.id) ? "default" : "outline"}
              onClick={() => setFilterAccount(String(a.id))}
            >
              {ar ? a.nameAr : a.nameEn}
            </Button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-lg">
          <ListOrdered className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {ar ? "لا توجد معاملات بعد" : "No transactions yet"}
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>{ar ? "المرجع" : "Ref"}</TableHead>
                <TableHead>{ar ? "التاريخ" : "Date"}</TableHead>
                <TableHead>{ar ? "الحساب" : "Account"}</TableHead>
                <TableHead>{ar ? "النوع" : "Type"}</TableHead>
                <TableHead>{ar ? "البيان" : "Description"}</TableHead>
                <TableHead className={ar ? "text-start" : "text-end"}>{ar ? "المبلغ" : "Amount"}</TableHead>
                <TableHead>{ar ? "قيد" : "JE"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t) => {
                const meta = TXN_TYPE_META[t.txnType] ?? TXN_TYPE_META.deposit;
                const { sign, color, amt } = getAmountDisplay(t, accountIdNum);
                return (
                  <TableRow key={t.id} data-testid={`row-bank-txn-${t.id}`}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{t.reference}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(new Date(t.txnDate), "dd MMM yyyy", { locale: dfLocale })}
                    </TableCell>
                    <TableCell className="text-sm">
                      {ar ? t.bankAccount?.nameAr : t.bankAccount?.nameEn}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("gap-1 text-xs", meta.color)}>
                        {meta.icon}
                        {ar ? meta.ar : meta.en}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{t.description}</TableCell>
                    <TableCell className={cn("font-mono text-sm tabular-nums font-medium", color, ar ? "text-start" : "text-end")}>
                      {sign}{amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      {t.journalEntryId ? (
                        <Link href="/app/journal">
                          <span className="text-xs text-primary underline-offset-2 hover:underline cursor-pointer">
                            JE
                          </span>
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* New Transaction Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-add-transaction">
          <DialogHeader>
            <DialogTitle>{ar ? "تسجيل معاملة بنكية" : "Record bank transaction"}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={form.handleSubmit((v) => createMutation.mutate(v))}
            className="space-y-4"
          >
            <div className="space-y-1">
              <Label>{ar ? "الحساب البنكي" : "Bank account"}</Label>
              <Select
                value={form.watch("bankAccountId") ? String(form.watch("bankAccountId")) : ""}
                onValueChange={(v) => form.setValue("bankAccountId", parseInt(v))}
              >
                <SelectTrigger data-testid="select-bank-account">
                  <SelectValue placeholder={ar ? "اختر حساباً" : "Select account"} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {ar ? a.nameAr : a.nameEn} — {a.bankName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.bankAccountId && (
                <p className="text-xs text-destructive">{ar ? "مطلوب" : "Required"}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{ar ? "نوع المعاملة" : "Type"}</Label>
                <Select
                  value={form.watch("txnType")}
                  onValueChange={(v) => form.setValue("txnType", v as any)}
                >
                  <SelectTrigger data-testid="select-txn-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BANK_TXN_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {ar ? TXN_TYPE_META[t].ar : TXN_TYPE_META[t].en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{ar ? "المبلغ" : "Amount"}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  data-testid="input-amount"
                  {...form.register("amount")}
                />
                {form.formState.errors.amount && (
                  <p className="text-xs text-destructive">{form.formState.errors.amount.message}</p>
                )}
              </div>
            </div>

            {txnType === "transfer" && (
              <div className="space-y-1">
                <Label>{ar ? "التحويل إلى" : "Transfer to"}</Label>
                <Select
                  value={form.watch("counterpartBankAccountId") ? String(form.watch("counterpartBankAccountId")) : ""}
                  onValueChange={(v) => form.setValue("counterpartBankAccountId", parseInt(v))}
                >
                  <SelectTrigger data-testid="select-counterpart-account">
                    <SelectValue placeholder={ar ? "اختر حساب الوجهة" : "Select destination account"} />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts
                      .filter((a) => String(a.id) !== String(form.watch("bankAccountId")))
                      .map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {ar ? a.nameAr : a.nameEn} — {a.bankName}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label>{ar ? "التاريخ" : "Date"}</Label>
              <Input type="date" data-testid="input-txn-date" {...form.register("txnDate")} />
            </div>

            <div className="space-y-1">
              <Label>{ar ? "البيان" : "Description"}</Label>
              <Input data-testid="input-description" {...form.register("description")} placeholder={ar ? "وصف المعاملة" : "Transaction description"} />
              {form.formState.errors.description && (
                <p className="text-xs text-destructive">{form.formState.errors.description.message}</p>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {ar ? "إلغاء" : "Cancel"}
              </Button>
              <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-transaction">
                {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin me-2" />}
                {ar ? "تسجيل" : "Record"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
