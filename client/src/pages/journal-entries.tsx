import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, BookText, Trash2, Scale } from "lucide-react";
import type { Account } from "@shared/schema";

interface JELine {
  accountId: number;
  debit: number;
  credit: number;
  description?: string;
}
interface JE {
  id: number;
  reference: string;
  entryDate: string;
  description: string;
  source: string;
  lines: (JELine & { account?: Account })[];
}

const fmt = (n: number) => n.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function JournalEntriesPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data: entries, isLoading } = useQuery<JE[]>({ queryKey: ["/api/journal-entries"] });
  const { data: accounts } = useQuery<Account[]>({ queryKey: ["/api/accounts"] });
  const postable = useMemo(() => (accounts || []).filter((a) => !a.isHeader), [accounts]);

  const [description, setDescription] = useState("");
  const [entryDate, setEntryDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<JELine[]>([
    { accountId: 0, debit: 0, credit: 0 },
    { accountId: 0, debit: 0, credit: 0 },
  ]);

  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/journal-entries", {
        description,
        entryDate,
        source: "manual",
        lines: lines.filter((l) => l.accountId && (l.debit > 0 || l.credit > 0)),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/trial-balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/balance-sheet"] });
      toast({ title: "تم تسجيل القيد ✅" });
      setOpen(false);
      setDescription("");
      setLines([{ accountId: 0, debit: 0, credit: 0 }, { accountId: 0, debit: 0, credit: 0 }]);
    },
    onError: (err: any) => toast({ title: "فشل تسجيل القيد", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/journal-entries/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/trial-balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/balance-sheet"] });
      toast({ title: "تم الحذف" });
    },
  });

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-6xl mx-auto" dir="rtl">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 p-3 rounded-2xl"><BookText className="w-7 h-7 text-primary" /></div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">قيود اليومية</h1>
            <p className="text-sm text-muted-foreground mt-1">تسجيل وعرض قيود محاسبية مزدوجة (مدين/دائن)</p>
          </div>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-entry"><Plus className="w-4 h-4 ml-1" /> قيد جديد</Button>
          </DialogTrigger>
          <DialogContent dir="rtl" className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>تسجيل قيد يومية</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>التاريخ</Label>
                  <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} data-testid="input-entry-date" />
                </div>
                <div>
                  <Label>الوصف</Label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="بيان القيد" data-testid="input-entry-description"/>
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="text-right">
                      <th className="p-2 font-medium">الحساب</th>
                      <th className="p-2 font-medium w-28">مدين</th>
                      <th className="p-2 font-medium w-28">دائن</th>
                      <th className="p-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-1.5">
                          <Select
                            value={l.accountId ? String(l.accountId) : ""}
                            onValueChange={(v) => {
                              const next = [...lines];
                              next[i].accountId = Number(v);
                              setLines(next);
                            }}
                          >
                            <SelectTrigger className="h-8" data-testid={`select-line-account-${i}`}><SelectValue placeholder="اختر حساب" /></SelectTrigger>
                            <SelectContent>
                              {postable.map((a) => (
                                <SelectItem key={a.id} value={String(a.id)}>
                                  {a.code} — {a.nameAr}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-1.5">
                          <Input
                            type="number" step="0.01" min="0" value={l.debit || ""}
                            onChange={(e) => {
                              const v = Number(e.target.value || 0);
                              const next = [...lines];
                              next[i].debit = v;
                              if (v > 0) next[i].credit = 0;
                              setLines(next);
                            }}
                            className="h-8 text-left tabular-nums"
                            data-testid={`input-line-debit-${i}`}
                          />
                        </td>
                        <td className="p-1.5">
                          <Input
                            type="number" step="0.01" min="0" value={l.credit || ""}
                            onChange={(e) => {
                              const v = Number(e.target.value || 0);
                              const next = [...lines];
                              next[i].credit = v;
                              if (v > 0) next[i].debit = 0;
                              setLines(next);
                            }}
                            className="h-8 text-left tabular-nums"
                            data-testid={`input-line-credit-${i}`}
                          />
                        </td>
                        <td className="p-1.5 text-center">
                          {lines.length > 2 && (
                            <Button variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                              data-testid={`button-remove-line-${i}`}>
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/40 font-semibold">
                    <tr>
                      <td className="p-2 text-right">الإجمالي</td>
                      <td className="p-2 text-left tabular-nums" data-testid="text-total-debit">{fmt(totalDebit)}</td>
                      <td className="p-2 text-left tabular-nums" data-testid="text-total-credit">{fmt(totalCredit)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={() => setLines([...lines, { accountId: 0, debit: 0, credit: 0 }])} data-testid="button-add-line">
                  <Plus className="w-3.5 h-3.5 ml-1" /> إضافة سطر
                </Button>
                <div className={`flex items-center gap-2 text-sm ${isBalanced ? "text-emerald-600" : "text-amber-600"}`}>
                  <Scale className="w-4 h-4" />
                  {isBalanced ? "القيد متوازن ✓" : `الفرق: ${fmt(Math.abs(totalDebit - totalCredit))}`}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!isBalanced || !description.trim() || createMutation.isPending}
                data-testid="button-save-entry"
              >
                حفظ القيد
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : !entries?.length ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">لا توجد قيود بعد. ابدأ بإضافة قيد جديد.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {entries.map((je) => {
            const td = je.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
            return (
              <Card key={je.id} data-testid={`card-entry-${je.id}`}>
                <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded">{je.reference}</span>
                      <span>{je.description}</span>
                    </CardTitle>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                      <span>{format(new Date(je.entryDate), "d MMM yyyy", { locale: ar })}</span>
                      <Badge variant="outline" className="text-[10px] py-0">
                        {je.source === "transaction" ? "تلقائي" : je.source === "ai" ? "AI" : "يدوي"}
                      </Badge>
                      <span className="font-semibold text-foreground tabular-nums">{fmt(td)} ر.س</span>
                    </div>
                  </div>
                  {je.source !== "transaction" && (
                    <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(je.id)} data-testid={`button-delete-entry-${je.id}`}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground border-b">
                      <tr><th className="text-right py-1.5">الحساب</th><th className="text-left py-1.5 w-24">مدين</th><th className="text-left py-1.5 w-24">دائن</th></tr>
                    </thead>
                    <tbody>
                      {je.lines.map((l, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-1.5">
                            <span className="font-mono text-xs text-muted-foreground ml-2">{l.account?.code}</span>
                            {l.account?.nameAr || "—"}
                          </td>
                          <td className="py-1.5 text-left tabular-nums">{Number(l.debit) > 0 ? fmt(Number(l.debit)) : ""}</td>
                          <td className="py-1.5 text-left tabular-nums">{Number(l.credit) > 0 ? fmt(Number(l.credit)) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
