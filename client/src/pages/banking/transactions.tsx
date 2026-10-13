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
import { useT, type StringKey } from "@/i18n/dict";
import { mapErrorKey } from "@/lib/error-messages";
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

function makeSchema(tr: (k: StringKey) => string) {
  return insertBankTransactionSchema.extend({
    amount: z.coerce.number().positive(tr("bank_txn_err_amount")),
    txnDate: z.string().min(1),
  });
}
type FormValues = z.infer<ReturnType<typeof makeSchema>>;

const TXN_TYPE_META: Record<string, { key: StringKey; icon: React.ReactNode; color: string }> = {
  deposit:    { key: "bank_txn_deposit",    icon: <ArrowDownLeft className="h-3.5 w-3.5" />, color: "text-success" },
  withdrawal: { key: "bank_txn_withdrawal", icon: <ArrowUpRight className="h-3.5 w-3.5" />,  color: "text-destructive" },
  transfer:   { key: "bank_txn_transfer",   icon: <ArrowLeftRight className="h-3.5 w-3.5" />, color: "text-primary" },
  fee:        { key: "bank_txn_fee",        icon: <Minus className="h-3.5 w-3.5" />,          color: "text-warning" },
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
  const tr = useT();
  const dfLocale = ar ? arLocale : enUS;
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [filterAccount, setFilterAccount] = useState<string>("all");
  const formSchema = makeSchema(tr);

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
      toast({ title: tr("bank_txn_toast_added") });
      setOpen(false);
      form.reset();
    },
    onError: (e: unknown) => toast({ title: tr(mapErrorKey(e)), variant: "destructive" }),
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
            {tr("bank_txn_title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {tr("bank_txn_sub")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length === 0 ? (
            <Link href="/app/banking/accounts">
              <Button size="sm" variant="outline">
                {tr("bank_txn_add_account_first")}
              </Button>
            </Link>
          ) : (
            <WriteGuard>
              <Button size="sm" onClick={() => setOpen(true)} data-testid="button-add-transaction">
                <Plus className="h-4 w-4 me-1" />
                {tr("bank_txn_new")}
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
            {tr("bank_txn_filter_all")}
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
            {tr("bank_txn_empty")}
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>{tr("bank_txn_col_ref")}</TableHead>
                <TableHead>{tr("bank_txn_col_date")}</TableHead>
                <TableHead>{tr("bank_txn_col_account")}</TableHead>
                <TableHead>{tr("bank_txn_col_type")}</TableHead>
                <TableHead>{tr("bank_txn_col_desc")}</TableHead>
                <TableHead className={ar ? "text-start" : "text-end"}>{tr("bank_txn_col_amount")}</TableHead>
                <TableHead>{tr("bank_txn_col_je")}</TableHead>
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
                        {tr(meta.key)}
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
            <DialogTitle>{tr("bank_txn_dialog_title")}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={form.handleSubmit((v) => createMutation.mutate(v))}
            className="space-y-4"
          >
            <div className="space-y-1">
              <Label>{tr("bank_txn_account")}</Label>
              <Select
                value={form.watch("bankAccountId") ? String(form.watch("bankAccountId")) : ""}
                onValueChange={(v) => form.setValue("bankAccountId", parseInt(v))}
              >
                <SelectTrigger data-testid="select-bank-account">
                  <SelectValue placeholder={tr("bank_txn_select_account")} />
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
                <p className="text-xs text-destructive">{tr("bank_txn_required")}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{tr("bank_txn_type")}</Label>
                <Select
                  value={form.watch("txnType")}
                  onValueChange={(v) => form.setValue("txnType", v as any)}
                >
                  <SelectTrigger data-testid="select-txn-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BANK_TXN_TYPES.map((bt) => (
                      <SelectItem key={bt} value={bt}>
                        {tr(TXN_TYPE_META[bt].key)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{tr("bank_txn_amount")}</Label>
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
                <Label>{tr("bank_txn_transfer_to")}</Label>
                <Select
                  value={form.watch("counterpartBankAccountId") ? String(form.watch("counterpartBankAccountId")) : ""}
                  onValueChange={(v) => form.setValue("counterpartBankAccountId", parseInt(v))}
                >
                  <SelectTrigger data-testid="select-counterpart-account">
                    <SelectValue placeholder={tr("bank_txn_select_dest")} />
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
              <Label>{tr("bank_txn_date")}</Label>
              <Input type="date" data-testid="input-txn-date" {...form.register("txnDate")} />
            </div>

            <div className="space-y-1">
              <Label>{tr("bank_txn_desc")}</Label>
              <Input data-testid="input-description" {...form.register("description")} placeholder={tr("bank_txn_desc_ph")} />
              {form.formState.errors.description && (
                <p className="text-xs text-destructive">{form.formState.errors.description.message}</p>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {tr("bank_txn_cancel")}
              </Button>
              <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-transaction">
                {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin me-2" />}
                {tr("bank_txn_record")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
