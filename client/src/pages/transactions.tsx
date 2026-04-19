import { useState, useMemo } from "react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { useTransactions, useDeleteTransaction } from "@/hooks/use-transactions";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, ArrowDownRight, ArrowUpRight, Trash2, ReceiptText, Calendar, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type Filter = "all" | "income" | "expense";

export default function Transactions() {
  const { data: transactions, isLoading } = useTransactions();
  const deleteMutation = useDeleteTransaction();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    if (!transactions) return [];
    const q = search.trim().toLowerCase();
    return [...transactions]
      .filter((t) => filter === "all" || t.type === filter)
      .filter(
        (t) =>
          !q ||
          t.description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          String(t.amount).includes(q)
      )
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  }, [transactions, search, filter]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">إدارة المعاملات</h1>
          <p className="text-muted-foreground mt-2 font-medium">سجل وتتبع جميع إيراداتك ومصروفاتك بسهولة.</p>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="h-12 px-6 rounded-xl font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 transition-all">
              <Plus className="w-5 h-5 ml-2" />
              إضافة معاملة جديدة
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] p-6 rounded-3xl border-none shadow-2xl" dir="rtl">
            <DialogHeader className="mb-6">
              <DialogTitle className="text-2xl font-extrabold">إضافة معاملة</DialogTitle>
              <DialogDescription className="text-base mt-2">
                أدخل تفاصيل المعاملة الجديدة لحفظها في سجلاتك.
              </DialogDescription>
            </DialogHeader>
            <TransactionForm onSuccess={() => setIsDialogOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث عن معاملة، فئة، أو مبلغ..."
            className="h-12 rounded-2xl bg-card border-2 pr-12 focus:border-primary/40 transition-all font-medium"
            data-testid="input-search"
          />
        </div>
        <div className="flex gap-2 bg-card rounded-2xl p-1.5 border border-border/50">
          {([
            { key: "all", label: "الكل" },
            { key: "income", label: "إيرادات" },
            { key: "expense", label: "مصروفات" },
          ] as { key: Filter; label: string }[]).map((opt) => (
            <button
              key={opt.key}
              onClick={() => setFilter(opt.key)}
              data-testid={`button-filter-${opt.key}`}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                filter === opt.key
                  ? opt.key === "income"
                    ? "bg-emerald-500 text-white shadow-md"
                    : opt.key === "expense"
                    ? "bg-rose-500 text-white shadow-md"
                    : "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-card rounded-2xl p-6 shadow-sm border border-border/50 flex justify-between items-center">
              <div className="flex items-center gap-4">
                <Skeleton className="w-12 h-12 rounded-xl" />
                <div className="space-y-2">
                  <Skeleton className="w-40 h-5" />
                  <Skeleton className="w-24 h-4" />
                </div>
              </div>
              <Skeleton className="w-24 h-8 rounded-lg" />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="bg-card rounded-3xl p-16 text-center shadow-sm border border-border/50 flex flex-col items-center justify-center">
            <div className="w-20 h-20 bg-primary/5 rounded-full flex items-center justify-center mb-4">
              <ReceiptText className="w-10 h-10 text-primary/50" />
            </div>
            <h3 className="text-2xl font-bold text-foreground mb-2">
              {search || filter !== "all" ? "لا توجد نتائج" : "سجلك المالي فارغ"}
            </h3>
            <p className="text-muted-foreground max-w-sm text-lg">
              {search || filter !== "all"
                ? "جرب تعديل البحث أو إزالة التصفية."
                : "لم تقم بإضافة أي معاملات بعد. اضغط على الزر أعلاه للبدء."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((tx) => (
              <div 
                key={tx.id} 
                className="bg-card hover:bg-muted/10 rounded-2xl p-4 sm:p-6 shadow-sm shadow-black/5 border border-border/50 hover:shadow-md transition-all group flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-center gap-4">
                  <div className={`shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center transition-transform group-hover:rotate-6 ${
                    tx.type === 'income' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'
                  }`}>
                    {tx.type === 'income' ? <ArrowUpRight className="w-7 h-7" /> : <ArrowDownRight className="w-7 h-7" />}
                  </div>
                  <div>
                    <h3 className="font-extrabold text-foreground text-xl mb-1">{tx.description}</h3>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground font-medium">
                      <span className="px-2.5 py-1 bg-secondary rounded-lg text-secondary-foreground font-bold">
                        {tx.category}
                      </span>
                      <span className="flex items-center gap-1.5 opacity-80">
                        <Calendar className="w-4 h-4" />
                        {format(new Date(tx.date || new Date()), 'd MMMM yyyy - h:mm a', { locale: ar })}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center justify-between sm:justify-end gap-6 w-full sm:w-auto border-t sm:border-0 pt-4 sm:pt-0 border-border/50">
                  <div className={`font-black text-2xl tracking-tight flex items-center gap-1.5 ${
                    tx.type === 'income' ? 'text-emerald-600' : 'text-rose-600'
                  }`}>
                    {tx.type === 'income' ? '+' : '-'}
                    {Number(tx.amount).toLocaleString('ar-SA')}
                    <span className="text-base font-bold opacity-70">ر.س</span>
                  </div>
                  
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl transition-colors">
                        <Trash2 className="w-5 h-5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="rounded-3xl border-none shadow-2xl p-6" dir="rtl">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-2xl font-bold">هل أنت متأكد من الحذف؟</AlertDialogTitle>
                        <AlertDialogDescription className="text-base font-medium mt-2 text-foreground/70">
                          هذا الإجراء لا يمكن التراجع عنه. سيتم حذف المعاملة "{tx.description}" نهائياً من سجلاتك.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter className="mt-6 flex gap-3 sm:gap-0">
                        <AlertDialogCancel className="h-12 rounded-xl font-bold">إلغاء</AlertDialogCancel>
                        <AlertDialogAction 
                          onClick={() => deleteMutation.mutate(tx.id)}
                          className="h-12 rounded-xl font-bold bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          نعم، احذف
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
