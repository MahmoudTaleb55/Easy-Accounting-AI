import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertBankAccountSchema, type BankAccount, BANK_ACCOUNT_TYPES } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocale } from "@/contexts/locale-context";
import { useSettings } from "@/lib/format";
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
import { Loader2, Plus, Trash2, Landmark, CreditCard, PiggyBank } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { z } from "zod";

const formSchema = insertBankAccountSchema.extend({
  openingBalance: z.coerce.number().min(0).default(0),
});
type FormValues = z.infer<typeof formSchema>;

const ACCOUNT_TYPE_LABELS: Record<string, { ar: string; en: string; icon: typeof Landmark }> = {
  checking: { ar: "حساب جاري", en: "Checking", icon: Landmark },
  savings:  { ar: "حساب توفير", en: "Savings",  icon: PiggyBank },
  credit:   { ar: "بطاقة ائتمان", en: "Credit Card", icon: CreditCard },
};

const COMMON_BANKS_AR = [
  "البنك الأهلي السعودي", "بنك الرياض", "البنك العربي الوطني",
  "بنك سامبا", "البنك السعودي الفرنسي", "بنك البلاد",
  "بنك الإنماء", "البنك السعودي للاستثمار", "بنك الجزيرة",
  "مصرف الراجحي", "بنك الخليج", "بنك أبوظبي الأول",
];

export default function BankingAccountsPage() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const { toast } = useToast();
  const { can } = useAuth();
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: accounts = [], isLoading } = useQuery<BankAccount[]>({
    queryKey: ["/api/banking/accounts"],
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nameAr: "", nameEn: "", bankName: "",
      iban: "", accountType: "checking", currency: settings.currencyCode || "SAR", openingBalance: 0,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: FormValues) => apiRequest("POST", "/api/banking/accounts", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/banking/accounts"] });
      toast({ title: ar ? "تم إضافة الحساب البنكي" : "Bank account added" });
      setOpen(false);
      form.reset();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/banking/accounts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/banking/accounts"] });
      toast({ title: ar ? "تم حذف الحساب" : "Account removed" });
      setDeleteId(null);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground" data-testid="text-page-title">
            {ar ? "الحسابات البنكية" : "Bank Accounts"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {ar
              ? "ربط حسابات بنكية وتتبع التدفق النقدي تلقائياً"
              : "Link bank accounts and track cash flow automatically"}
          </p>
        </div>
        {can.write && (
          <Button size="sm" onClick={() => setOpen(true)} data-testid="button-add-account">
            <Plus className="h-4 w-4 me-1" />
            {ar ? "إضافة حساب" : "Add account"}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-lg">
          <Landmark className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {ar ? "لا توجد حسابات بنكية مُضافة بعد" : "No bank accounts linked yet"}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {ar ? "أضف حساباً للبدء في تتبع معاملاتك البنكية" : "Add an account to start tracking bank transactions"}
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>{ar ? "الحساب" : "Account"}</TableHead>
                <TableHead>{ar ? "البنك" : "Bank"}</TableHead>
                <TableHead>{ar ? "النوع" : "Type"}</TableHead>
                <TableHead>{ar ? "رقم IBAN" : "IBAN"}</TableHead>
                <TableHead>{ar ? "العملة" : "Currency"}</TableHead>
                <TableHead className="text-end">{ar ? "" : ""}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((acct) => {
                const typeInfo = ACCOUNT_TYPE_LABELS[acct.accountType] ?? ACCOUNT_TYPE_LABELS.checking;
                const Icon = typeInfo.icon;
                return (
                  <TableRow key={acct.id} data-testid={`row-bank-account-${acct.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{ar ? acct.nameAr : acct.nameEn}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{acct.bankName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {ar ? typeInfo.ar : typeInfo.en}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {acct.iban || "—"}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{acct.currency}</TableCell>
                    <TableCell className="text-end">
                      {can.write && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteId(acct.id)}
                          data-testid={`button-delete-account-${acct.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Account Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-add-account">
          <DialogHeader>
            <DialogTitle>{ar ? "إضافة حساب بنكي" : "Add bank account"}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={form.handleSubmit((v) => createMutation.mutate(v))}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{ar ? "الاسم بالعربية" : "Arabic name"}</Label>
                <Input data-testid="input-name-ar" {...form.register("nameAr")} />
                {form.formState.errors.nameAr && (
                  <p className="text-xs text-destructive">{form.formState.errors.nameAr.message}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label>{ar ? "الاسم بالإنجليزية" : "English name"}</Label>
                <Input data-testid="input-name-en" {...form.register("nameEn")} />
              </div>
            </div>

            <div className="space-y-1">
              <Label>{ar ? "اسم البنك" : "Bank name"}</Label>
              <Input
                list="bank-list"
                data-testid="input-bank-name"
                {...form.register("bankName")}
                placeholder={ar ? "مثال: مصرف الراجحي" : "e.g. Al Rajhi Bank"}
              />
              <datalist id="bank-list">
                {COMMON_BANKS_AR.map((b) => <option key={b} value={b} />)}
              </datalist>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{ar ? "نوع الحساب" : "Account type"}</Label>
                <Select
                  value={form.watch("accountType")}
                  onValueChange={(v) => form.setValue("accountType", v as any)}
                >
                  <SelectTrigger data-testid="select-account-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BANK_ACCOUNT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {ar ? ACCOUNT_TYPE_LABELS[t].ar : ACCOUNT_TYPE_LABELS[t].en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{ar ? "العملة" : "Currency"}</Label>
                <Select
                  value={form.watch("currency")}
                  onValueChange={(v) => form.setValue("currency", v)}
                >
                  <SelectTrigger data-testid="select-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["SAR","AED","KWD","QAR","USD","EUR","EGP","JOD"].map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label>{ar ? "رقم IBAN" : "IBAN"} <span className="text-muted-foreground text-xs">({ar ? "اختياري" : "optional"})</span></Label>
              <Input
                data-testid="input-iban"
                {...form.register("iban")}
                placeholder="SA0000000000000000000000"
                className="font-mono uppercase"
              />
            </div>

            <div className="space-y-1">
              <Label>{ar ? "الرصيد الافتتاحي" : "Opening balance"}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                data-testid="input-opening-balance"
                {...form.register("openingBalance")}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {ar ? "إلغاء" : "Cancel"}
              </Button>
              <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-account">
                {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin me-2" />}
                {ar ? "إضافة" : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{ar ? "حذف الحساب البنكي؟" : "Remove bank account?"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {ar
              ? "سيتم إخفاء الحساب ولن يظهر في القائمة. لن تُحذف المعاملات المرتبطة به."
              : "The account will be hidden. Linked transactions will not be deleted."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>{ar ? "إلغاء" : "Cancel"}</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
              data-testid="button-confirm-delete-account"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin me-2" />}
              {ar ? "حذف" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
