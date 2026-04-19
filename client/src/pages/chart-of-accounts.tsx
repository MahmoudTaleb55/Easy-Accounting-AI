import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus, BookOpen, Search } from "lucide-react";
import type { Account } from "@shared/schema";

const TYPE_LABELS: Record<string, { ar: string; color: string }> = {
  asset:     { ar: "أصول",        color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  liability: { ar: "خصوم",        color: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  equity:    { ar: "حقوق ملكية",  color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  revenue:   { ar: "إيرادات",     color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  expense:   { ar: "مصروفات",     color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
};

const TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"];

export default function ChartOfAccountsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", nameAr: "", nameEn: "", type: "expense", subtype: "operating_expense" });

  const { data: accounts, isLoading } = useQuery<Account[]>({ queryKey: ["/api/accounts"] });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/accounts", { ...form, isHeader: false });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "تم إضافة الحساب بنجاح" });
      setOpen(false);
      setForm({ code: "", nameAr: "", nameEn: "", type: "expense", subtype: "operating_expense" });
    },
    onError: (err: any) => toast({ title: "فشل الإنشاء", description: err.message, variant: "destructive" }),
  });

  const grouped = useMemo(() => {
    if (!accounts) return {} as Record<string, Account[]>;
    const filt = accounts.filter(
      (a) =>
        !search ||
        a.code.includes(search) ||
        a.nameAr.includes(search) ||
        a.nameEn.toLowerCase().includes(search.toLowerCase())
    );
    return filt.reduce<Record<string, Account[]>>((acc, a) => {
      (acc[a.type] ||= []).push(a);
      return acc;
    }, {});
  }, [accounts, search]);

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-6xl mx-auto" dir="rtl">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 p-3 rounded-2xl">
            <BookOpen className="w-7 h-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">دليل الحسابات</h1>
            <p className="text-sm text-muted-foreground mt-1">شجرة الحسابات وفق المعايير الدولية IFRS</p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="ابحث عن حساب…"
              className="pr-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-accounts"
            />
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-account"><Plus className="w-4 h-4 ml-1" /> إضافة حساب</Button>
            </DialogTrigger>
            <DialogContent dir="rtl" className="sm:max-w-md">
              <DialogHeader><DialogTitle>إضافة حساب جديد</DialogTitle></DialogHeader>
              <div className="grid gap-3 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>الكود</Label>
                    <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="6200" data-testid="input-account-code"/>
                  </div>
                  <div>
                    <Label>النوع</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                      <SelectTrigger data-testid="select-account-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TYPE_ORDER.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t].ar}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>الاسم بالعربية</Label>
                  <Input value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} data-testid="input-account-name-ar"/>
                </div>
                <div>
                  <Label>الاسم بالإنجليزية</Label>
                  <Input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} data-testid="input-account-name-en"/>
                </div>
                <div>
                  <Label>التصنيف الفرعي</Label>
                  <Input value={form.subtype} onChange={(e) => setForm({ ...form, subtype: e.target.value })} placeholder="operating_expense" data-testid="input-account-subtype"/>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.code || !form.nameAr || !form.nameEn} data-testid="button-save-account">
                  حفظ
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {TYPE_ORDER.filter((t) => grouped[t]?.length).map((type) => (
            <Card key={type} data-testid={`card-type-${type}`}>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-lg">{TYPE_LABELS[type].ar}</CardTitle>
                <Badge variant="secondary" className={TYPE_LABELS[type].color}>{grouped[type].length}</Badge>
              </CardHeader>
              <CardContent className="space-y-1">
                {grouped[type].map((a) => (
                  <div
                    key={a.id}
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm ${
                      a.isHeader ? "font-bold bg-muted/40" : "hover:bg-muted/40"
                    }`}
                    style={{ paddingInlineStart: a.isHeader ? "0.75rem" : "1.5rem" }}
                    data-testid={`row-account-${a.code}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">{a.code}</span>
                      <span className="truncate">{a.nameAr}</span>
                    </div>
                    <span className="text-xs text-muted-foreground hidden sm:block">{a.nameEn}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
