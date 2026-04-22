import { useState, useMemo } from "react"
import { format } from "date-fns"
import { ar, enUS } from "date-fns/locale"
import { useTransactions, useDeleteTransaction } from "@/hooks/use-transactions"
import { TransactionForm } from "@/components/transactions/transaction-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
} from "@/components/ui/alert-dialog"
import {
  Plus,
  ArrowDownRight,
  ArrowUpRight,
  Trash2,
  Search,
  Inbox,
  History,
} from "lucide-react"
import { useLocale } from "@/contexts/locale-context"
import { useFormatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"
import { HistoryDrawer } from "@/components/audit/history-drawer"
import { EmptyState } from "@/components/feedback/empty-state"
import { ErrorState } from "@/components/feedback/error-state"
import { ListSkeleton } from "@/components/feedback/list-skeleton"
import type { Transaction } from "@shared/schema"

type Filter = "all" | "income" | "expense"

export default function Transactions() {
  const { locale } = useLocale()
  const fmt = useFormatMoney()
  const dfLocale = locale === "ar" ? ar : enUS
  const { data: transactions, isLoading, isError, refetch } = useTransactions()
  const deleteMutation = useDeleteTransaction()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [historyTx, setHistoryTx] = useState<Transaction | null>(null)

  const t = useMemo(
    () => ({
      eyebrow: locale === "ar" ? "المعاملات" : "Transactions",
      title: locale === "ar" ? "كل دخل ومصروف، في مكان واحد." : "Every dollar in and out, in one place.",
      subtitle:
        locale === "ar"
          ? "ابحث وفلتر وأضف معاملات بسرعة. كل قيد ينشأ تلقائياً في اليومية."
          : "Search, filter, and add entries fast. Every record auto-posts to the journal.",
      add: locale === "ar" ? "معاملة جديدة" : "New transaction",
      addDialogTitle: locale === "ar" ? "إضافة معاملة" : "Add transaction",
      addDialogDesc:
        locale === "ar"
          ? "أدخل تفاصيل المعاملة لحفظها وترحيلها إلى دفتر اليومية."
          : "Enter details to save and post this entry to the journal.",
      searchPh:
        locale === "ar"
          ? "ابحث بالوصف أو الفئة أو المبلغ…"
          : "Search description, category, or amount…",
      filterAll: locale === "ar" ? "الكل" : "All",
      filterIncome: locale === "ar" ? "إيرادات" : "Revenue",
      filterExpense: locale === "ar" ? "مصروفات" : "Expenses",
      emptyTitleHas: locale === "ar" ? "لا نتائج" : "No results",
      emptyTitleNone: locale === "ar" ? "لا توجد معاملات بعد" : "No transactions yet",
      emptyBodyHas:
        locale === "ar"
          ? "حاول تعديل البحث أو إزالة الفلتر."
          : "Try adjusting your search or clearing the filter.",
      emptyBodyNone:
        locale === "ar"
          ? "أضف أول معاملة من الزر أعلاه أو من المساعد الذكي."
          : "Add your first transaction with the button above or the AI assistant.",
      delTitle: locale === "ar" ? "حذف المعاملة؟" : "Delete this transaction?",
      delDesc:
        locale === "ar"
          ? "هذا الإجراء لا يمكن التراجع عنه. سيتم إلغاء القيد المقابل في اليومية."
          : "This cannot be undone. The matching journal entry will be reversed.",
      delCancel: locale === "ar" ? "إلغاء" : "Cancel",
      delConfirm: locale === "ar" ? "نعم، احذف" : "Yes, delete",
      count: locale === "ar" ? "معاملة" : "transactions",
    }),
    [locale]
  )

  const filtered = useMemo(() => {
    if (!transactions) return []
    const q = search.trim().toLowerCase()
    return [...transactions]
      .filter((tx) => filter === "all" || tx.type === filter)
      .filter(
        (tx) =>
          !q ||
          tx.description.toLowerCase().includes(q) ||
          tx.category.toLowerCase().includes(q) ||
          String(tx.amount).includes(q)
      )
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
  }, [transactions, search, filter])

  const filterTabs: { key: Filter; label: string }[] = [
    { key: "all", label: t.filterAll },
    { key: "income", label: t.filterIncome },
    { key: "expense", label: t.filterExpense },
  ]

  return (
    <div className="space-y-8" data-testid="page-transactions">
      <header className="flex items-start justify-between gap-6 flex-wrap">
        <div className="space-y-2 max-w-2xl">
          <div className="eyebrow text-muted-foreground/80">{t.eyebrow}</div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {t.title}
          </h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-transaction">
              <Plus className="w-4 h-4" />
              {t.add}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{t.addDialogTitle}</DialogTitle>
              <DialogDescription>{t.addDialogDesc}</DialogDescription>
            </DialogHeader>
            <TransactionForm onSuccess={() => setIsDialogOpen(false)} />
          </DialogContent>
        </Dialog>
      </header>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchPh}
            className="ps-9 h-10"
            data-testid="input-search"
          />
        </div>
        <div
          role="tablist"
          aria-label={t.eyebrow}
          className="inline-flex items-center gap-0.5 bg-muted/50 border border-border rounded-md p-0.5 h-10"
        >
          {filterTabs.map((opt) => {
            const selected = filter === opt.key
            return (
              <button
                key={opt.key}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => setFilter(opt.key)}
                data-testid={`button-filter-${opt.key}`}
                className={cn(
                  "px-3.5 h-full text-xs font-medium rounded transition-colors",
                  selected
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Count */}
      {!isLoading && filtered.length > 0 && (
        <div className="text-xs text-muted-foreground -mt-4">
          <span className="font-numeric tabular-nums font-medium text-foreground">
            {filtered.length}
          </span>{" "}
          {t.count}
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <ListSkeleton rows={6} testId="skeleton-transactions" />
      ) : isError ? (
        <ErrorState
          onRetry={() => refetch()}
          testId="error-transactions"
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Inbox className="w-5 h-5" />}
          title={search || filter !== "all" ? t.emptyTitleHas : t.emptyTitleNone}
          description={search || filter !== "all" ? t.emptyBodyHas : t.emptyBodyNone}
          action={
            !(search || filter !== "all")
              ? { label: t.add, onClick: () => setIsDialogOpen(true), testId: "button-empty-add-transaction" }
              : undefined
          }
          testId="empty-transactions"
        />
      ) : (
        <Card variant="default" className="p-0 overflow-hidden">
          <ul className="divide-y divide-border" data-testid="list-transactions">
            {filtered.map((tx) => {
              const isIncome = tx.type === "income"
              return (
                <li
                  key={tx.id}
                  className="px-5 sm:px-6 py-3.5 flex items-center justify-between gap-4 hover:bg-muted/40 transition-colors"
                  data-testid={`row-transaction-${tx.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={cn(
                        "inline-flex items-center justify-center w-7 h-7 rounded-md border shrink-0",
                        isIncome
                          ? "bg-success/10 border-success/20 text-success"
                          : "bg-expense/10 border-expense/20 text-expense"
                      )}
                      aria-hidden
                    >
                      {isIncome ? (
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowDownRight className="w-3.5 h-3.5" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {tx.description}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                        <span className="uppercase tracking-wider font-medium text-muted-foreground/80">
                          {tx.category}
                        </span>
                        <span className="text-muted-foreground/50">·</span>
                        <span className="font-numeric tabular-nums">
                          {format(new Date(tx.date || new Date()), "d MMM yyyy", { locale: dfLocale })}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div
                      className={cn(
                        "text-sm font-semibold font-numeric tabular-nums",
                        isIncome ? "text-success" : "text-foreground"
                      )}
                    >
                      {isIncome ? "+" : "−"} {fmt(Number(tx.amount))}
                    </div>

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-foreground"
                      data-testid={`button-history-${tx.id}`}
                      aria-label={locale === "ar" ? "السجل" : "History"}
                      onClick={() => setHistoryTx(tx)}
                    >
                      <History className="w-3.5 h-3.5" />
                    </Button>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-destructive"
                          data-testid={`button-delete-${tx.id}`}
                          aria-label={t.delConfirm}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t.delTitle}</AlertDialogTitle>
                          <AlertDialogDescription>{t.delDesc}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel data-testid="button-cancel-delete">
                            {t.delCancel}
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteMutation.mutate(tx.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            data-testid="button-confirm-delete"
                          >
                            {t.delConfirm}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <HistoryDrawer
        open={!!historyTx}
        onOpenChange={(o) => { if (!o) setHistoryTx(null) }}
        title={historyTx?.description || ""}
        reference={historyTx ? `TX-${historyTx.id}` : undefined}
        entityType="transaction"
        entityId={historyTx?.id}
      />
    </div>
  )
}
