import { useEffect, useState, useMemo } from "react"
import { useLocation, useSearch } from "wouter"
import { JournalEntryRefLink } from "@/components/journal/journal-entry-ref-link"
import { format, type Locale } from "date-fns"
import { ar, enUS } from "date-fns/locale"
import { useTransactions, useDeleteTransaction } from "@/hooks/use-transactions"
import { TransactionForm } from "@/components/transactions/transaction-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
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
import { WriteGuard, useCanWrite } from "@/components/auth/write-guard"
import {
  Plus,
  ArrowDownRight,
  ArrowUpRight,
  Trash2,
  Search,
  Inbox,
} from "lucide-react"
import { useLocale } from "@/contexts/locale-context"
import { usePeriod } from "@/contexts/period-context"
import { PeriodChip } from "@/components/dashboard/period-chip"
import { useFormatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"
import { HistoryTimeline } from "@/components/audit/history-drawer"
import { EmptyState } from "@/components/feedback/empty-state"
import { ErrorState } from "@/components/feedback/error-state"
import { ListSkeleton } from "@/components/feedback/list-skeleton"
import type { TransactionWithJournal } from "@shared/schema"

type Filter = "all" | "income" | "expense"

export default function Transactions() {
  const { locale } = useLocale()
  const fmt = useFormatMoney()
  const { period } = usePeriod()
  const dfLocale = locale === "ar" ? ar : enUS
  const { data: transactions, isLoading, isError, refetch } = useTransactions()
  const deleteMutation = useDeleteTransaction()
  const canWrite = useCanWrite()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [detailTx, setDetailTx] = useState<TransactionWithJournal | null>(null)
  const [, setLocation] = useLocation()
  const queryString = useSearch()

  // Quick-create deep-link: visiting `/app/transactions?new=1` from the
  // topbar Plus-menu (or the command palette) should drop the user
  // straight into the create dialog. We strip the param after consuming
  // it so a refresh or back-navigation doesn't re-open the dialog.
  useEffect(() => {
    const params = new URLSearchParams(queryString)
    if (params.get("new") === "1" && canWrite) {
      setIsDialogOpen(true)
      setLocation("/app/transactions", { replace: true })
    }
  }, [queryString, canWrite, setLocation])

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
      detailDesc:
        locale === "ar"
          ? "تفاصيل المعاملة وسجل التغييرات في مكان واحد."
          : "Transaction details and change history in one place.",
      tabSummary: locale === "ar" ? "الملخص" : "Summary",
      tabChanges: locale === "ar" ? "التغييرات" : "Changes",
      detailDate: locale === "ar" ? "التاريخ" : "Date",
      detailCategory: locale === "ar" ? "الفئة" : "Category",
      detailType: locale === "ar" ? "النوع" : "Type",
      detailAmount: locale === "ar" ? "المبلغ" : "Amount",
      typeIncome: locale === "ar" ? "إيراد" : "Revenue",
      typeExpense: locale === "ar" ? "مصروف" : "Expense",
      openDetailAria: locale === "ar" ? "فتح تفاصيل المعاملة" : "Open transaction details",
      // "Posted as JE-…" deep-link in the detail dialog. Bilingual to match
      // the rest of the dialog and the SourceLinkBadge on the JE page.
      jePostedAs: locale === "ar" ? "مُرحّل في" : "Posted as",
      jeOpenAria: locale === "ar" ? "فتح القيد المحاسبي" : "Open journal entry",
    }),
    [locale]
  )

  const filtered = useMemo(() => {
    if (!transactions) return []
    const q = search.trim().toLowerCase()
    const startMs = period.start.getTime()
    const endMs = period.end.getTime()
    return [...transactions]
      .filter((tx) => {
        if (!tx.date) return false
        const ms = new Date(tx.date).getTime()
        return ms >= startMs && ms <= endMs
      })
      .filter((tx) => filter === "all" || tx.type === filter)
      .filter(
        (tx) =>
          !q ||
          tx.description.toLowerCase().includes(q) ||
          tx.category.toLowerCase().includes(q) ||
          String(tx.amount).includes(q)
      )
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
  }, [transactions, search, filter, period])

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

        <div className="flex items-center gap-2 flex-wrap">
          <PeriodChip />
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <WriteGuard>
            <Button
              data-testid="button-add-transaction"
              onClick={() => setIsDialogOpen(true)}
            >
              <Plus className="w-4 h-4" />
              {t.add}
            </Button>
          </WriteGuard>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{t.addDialogTitle}</DialogTitle>
              <DialogDescription>{t.addDialogDesc}</DialogDescription>
            </DialogHeader>
            <TransactionForm onSuccess={() => setIsDialogOpen(false)} />
          </DialogContent>
        </Dialog>
        </div>
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
            !(search || filter !== "all") && canWrite
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
                      <button
                        type="button"
                        onClick={() => setDetailTx(tx)}
                        aria-label={t.openDetailAria}
                        className="text-start text-sm font-medium text-foreground truncate hover:underline focus-visible:underline focus-visible:outline-none rounded-sm"
                        data-testid={`link-transaction-${tx.id}`}
                      >
                        {tx.description}
                      </button>
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

                    {canWrite ? (
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
                    ) : (
                      <WriteGuard>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-destructive"
                          data-testid={`button-delete-${tx.id}`}
                          aria-label={t.delConfirm}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </WriteGuard>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {detailTx && (
        <TransactionDetailDialog
          tx={detailTx}
          onClose={() => setDetailTx(null)}
          labels={{
            description: t.detailDesc,
            tabSummary: t.tabSummary,
            tabChanges: t.tabChanges,
            date: t.detailDate,
            category: t.detailCategory,
            type: t.detailType,
            amount: t.detailAmount,
            typeIncome: t.typeIncome,
            typeExpense: t.typeExpense,
            jePostedAs: t.jePostedAs,
            jeOpenAria: t.jeOpenAria,
          }}
          dfLocale={dfLocale}
          fmt={fmt}
        />
      )}
    </div>
  )
}

interface TransactionDetailDialogProps {
  tx: TransactionWithJournal
  onClose: () => void
  labels: {
    description: string
    tabSummary: string
    tabChanges: string
    date: string
    category: string
    type: string
    amount: string
    typeIncome: string
    typeExpense: string
    jePostedAs: string
    jeOpenAria: string
  }
  dfLocale: Locale
  fmt: ReturnType<typeof useFormatMoney>
}

function TransactionDetailDialog({ tx, onClose, labels, dfLocale, fmt }: TransactionDetailDialogProps) {
  const isIncome = tx.type === "income"
  const typeLabel = isIncome ? labels.typeIncome : labels.typeExpense
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-transaction-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-numeric text-[11px] tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
              TX-{tx.id}
            </span>
            <span className="truncate">{tx.description}</span>
          </DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
          <span className="font-numeric tabular-nums">
            {format(new Date(tx.date || new Date()), "d MMM yyyy", { locale: dfLocale })}
          </span>
          <span className="text-muted-foreground/50">·</span>
          <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
            {typeLabel}
          </Badge>
        </div>
        <Tabs defaultValue="summary" className="mt-3">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="summary" data-testid="tab-transaction-summary">{labels.tabSummary}</TabsTrigger>
            <TabsTrigger value="changes" data-testid="tab-transaction-changes">{labels.tabChanges}</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="mt-4">
            <dl className="grid grid-cols-3 gap-y-3 gap-x-4 text-sm">
              <dt className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                {labels.date}
              </dt>
              <dd
                className="col-span-2 text-foreground font-numeric tabular-nums"
                data-testid="text-transaction-detail-date"
              >
                {format(new Date(tx.date || new Date()), "d MMM yyyy", { locale: dfLocale })}
              </dd>
              <dt className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                {labels.category}
              </dt>
              <dd
                className="col-span-2 text-foreground"
                data-testid="text-transaction-detail-category"
              >
                {tx.category}
              </dd>
              <dt className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                {labels.type}
              </dt>
              <dd className="col-span-2" data-testid="text-transaction-detail-type">
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
                  {typeLabel}
                </Badge>
              </dd>
              <dt className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                {labels.amount}
              </dt>
              <dd
                className={cn(
                  "col-span-2 font-semibold font-numeric tabular-nums",
                  isIncome ? "text-success" : "text-foreground"
                )}
                data-testid="text-transaction-detail-amount"
              >
                {isIncome ? "+" : "−"} {fmt(Number(tx.amount))}
              </dd>
            </dl>
            {tx.journalEntryId != null && (
              // Deep-link to the auto-posted JE. Mirrors the
              // SourceLinkBadge styling on the JE page so the cross-link
              // pattern reads consistently in both directions. The
              // `/app/journal#je-<id>` hash is consumed by
              // `client/src/pages/journal-entries.tsx` (initialHashId +
              // hashchange listener) which scrolls + highlights the row.
              // Hidden when no JE is linked yet (still posting, posting
              // failed, or legacy row pre-auto-post bridge). When the JE
              // has been cascade-reversed, `JournalEntryRefLink` swaps in
              // a tombstone affordance instead of letting the click 404.
              <div className="mt-4 pt-3 border-t border-border/60">
                <JournalEntryRefLink
                  id={tx.journalEntryId}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  ariaLabel={labels.jeOpenAria}
                  data-testid="link-transaction-journal-entry"
                >
                  <span className="text-muted-foreground">{labels.jePostedAs}</span>
                  <span
                    className="font-numeric tabular-nums"
                    data-testid="text-transaction-journal-entry-reference"
                  >
                    {tx.journalEntryReference || `JE-${tx.journalEntryId}`}
                  </span>
                  <ArrowUpRight className="w-3 h-3" aria-hidden />
                </JournalEntryRefLink>
              </div>
            )}
          </TabsContent>
          <TabsContent value="changes" className="mt-4" data-testid="tab-content-transaction-changes">
            <div className="rounded-md border border-border max-h-96 overflow-hidden flex flex-col">
              <HistoryTimeline
                entityType="transaction"
                entityId={tx.id}
                className="flex-1 min-h-0"
              />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
