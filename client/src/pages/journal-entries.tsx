import { useEffect, useMemo, useState } from "react"
import { Link, useLocation } from "wouter"
import { useQuery, useMutation } from "@tanstack/react-query"
import { apiRequest, queryClient } from "@/lib/queryClient"
import { useToast } from "@/hooks/use-toast"
import { format, type Locale } from "date-fns"
import { ar, enUS } from "date-fns/locale"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { WriteGuard } from "@/components/auth/write-guard"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Plus, Trash2, Scale, History } from "lucide-react"
import { HistoryDrawer, HistoryTimeline } from "@/components/audit/history-drawer"
import { EmptyState } from "@/components/feedback/empty-state"
import { ErrorState } from "@/components/feedback/error-state"
import { CardGridSkeleton } from "@/components/feedback/list-skeleton"
import type { Account, JournalEntrySourceLink } from "@shared/schema"
import { useLocale } from "@/contexts/locale-context"
import { usePeriod } from "@/contexts/period-context"
import { PeriodChip } from "@/components/dashboard/period-chip"
import { useFormatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"

interface JELine {
  accountId: number
  debit: number
  credit: number
  description?: string
}
interface JE {
  id: number
  reference: string
  entryDate: string
  description: string
  source: string
  createdAt?: string
  lines: (JELine & { account?: Account })[]
  sourceLink?: JournalEntrySourceLink
}

export default function JournalEntriesPage() {
  const { locale } = useLocale()
  const fmt = useFormatMoney()
  const { period } = usePeriod()
  const dfLocale = locale === "ar" ? ar : enUS
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [historyEntry, setHistoryEntry] = useState<JE | null>(null)
  const [detailEntry, setDetailEntry] = useState<JE | null>(null)
  const [location] = useLocation()
  const [highlightId, setHighlightId] = useState<number | null>(null)

  const t = useMemo(
    () => ({
      sourceFromPrefix: locale === "ar" ? "من:" : "From:",
      sourceKindPayroll: locale === "ar" ? "كشف رواتب" : "Payroll",
      sourceKindDepreciation: locale === "ar" ? "إهلاك" : "Depreciation",
      sourceKindImpairment: locale === "ar" ? "انخفاض قيمة" : "Impairment",
      sourceKindRevaluation: locale === "ar" ? "إعادة تقييم" : "Revaluation",
      sourceKindDisposal: locale === "ar" ? "استبعاد" : "Disposal",
      sourceLinkAria: locale === "ar" ? "فتح المصدر" : "Open source",
      eyebrow: locale === "ar" ? "قيود اليومية" : "Journal entries",
      title:
        locale === "ar"
          ? "كل قيد، متوازن، مرحَّل."
          : "Every entry, balanced, posted.",
      subtitle:
        locale === "ar"
          ? "اليومية مزدوجة القيد. كل سطر يُعرض بمدين ودائن مع المرجع والمصدر."
          : "Double-entry by design. Every line shows debit, credit, reference, and source.",
      add: locale === "ar" ? "قيد جديد" : "New entry",
      addTitle: locale === "ar" ? "تسجيل قيد يومية" : "Post a journal entry",
      addDesc:
        locale === "ar"
          ? "حدّد التاريخ والبيان وسطور المدين والدائن. القيد لن يُحفظ إلا متوازناً."
          : "Set date, memo, and debit/credit lines. The entry only posts when balanced.",
      date: locale === "ar" ? "التاريخ" : "Date",
      memo: locale === "ar" ? "البيان" : "Memo",
      memoPh: locale === "ar" ? "وصف القيد" : "Entry description",
      account: locale === "ar" ? "الحساب" : "Account",
      debit: locale === "ar" ? "مدين" : "Debit",
      credit: locale === "ar" ? "دائن" : "Credit",
      total: locale === "ar" ? "الإجمالي" : "Total",
      addLine: locale === "ar" ? "إضافة سطر" : "Add line",
      balanced: locale === "ar" ? "القيد متوازن" : "Entry is balanced",
      diff: locale === "ar" ? "الفرق" : "Difference",
      save: locale === "ar" ? "حفظ القيد" : "Post entry",
      created: locale === "ar" ? "تم تسجيل القيد" : "Entry posted",
      saveFailed: locale === "ar" ? "فشل تسجيل القيد" : "Could not post entry",
      deleted: locale === "ar" ? "تم الحذف" : "Deleted",
      empty: locale === "ar" ? "لا توجد قيود بعد" : "No entries yet",
      emptyHint:
        locale === "ar"
          ? "ابدأ بإضافة أول قيد يدوي، أو أنشئ معاملة من المساعد الذكي."
          : "Add your first manual entry, or create a transaction from the assistant.",
      pickAccount: locale === "ar" ? "اختر حساباً" : "Pick account",
      sourceManual: locale === "ar" ? "يدوي" : "Manual",
      sourceAuto: locale === "ar" ? "تلقائي" : "Auto",
      sourceAi: "AI",
      detailDesc:
        locale === "ar"
          ? "أسطر القيد وسجل التغييرات في مكان واحد."
          : "Entry lines and change history in one place.",
      tabLines: locale === "ar" ? "الأسطر" : "Lines",
      tabChanges: locale === "ar" ? "التغييرات" : "Changes",
    }),
    [locale]
  )

  const { data: allEntries, isLoading, isError, refetch } = useQuery<JE[]>({
    queryKey: ["/api/journal-entries"],
  })
  // Read the deep-link target up front so we can always render the linked
  // entry, even if it falls outside the active period filter. The banner below
  // signals to the user that it's an out-of-period match.
  const initialHashId = useMemo(() => {
    if (typeof window === "undefined") return null
    const m = window.location.hash.match(/^#je-(\d+)$/)
    return m ? Number(m[1]) : null
  }, [])
  const [hashTargetId, setHashTargetId] = useState<number | null>(initialHashId)
  const entries = useMemo(() => {
    if (!allEntries) return undefined
    const startMs = period.start.getTime()
    const endMs = period.end.getTime()
    return allEntries.filter((je) => {
      const ms = new Date(je.entryDate).getTime()
      if (ms >= startMs && ms <= endMs) return true
      // Always keep the deep-linked entry visible so the link can resolve.
      return hashTargetId != null && je.id === hashTargetId
    })
  }, [allEntries, period, hashTargetId])
  const { data: accounts } = useQuery<Account[]>({ queryKey: ["/api/accounts"] })
  const postable = useMemo(() => (accounts || []).filter((a) => !a.isHeader), [accounts])

  // Re-read #je-<id> from the URL hash whenever the route or hash changes so
  // navigating from another page (e.g., the payroll-runs table on /app/hr)
  // lands on the correct entry.
  useEffect(() => {
    const read = () => {
      const m = window.location.hash.match(/^#je-(\d+)$/)
      setHashTargetId(m ? Number(m[1]) : null)
    }
    read()
    window.addEventListener("hashchange", read)
    return () => window.removeEventListener("hashchange", read)
  }, [location])

  // Resolve the target entry against the unfiltered list so we can detect when
  // it lives outside the current period and surface a hint banner.
  const targetEntry = useMemo(
    () => (hashTargetId == null ? null : (allEntries || []).find((e) => e.id === hashTargetId) || null),
    [allEntries, hashTargetId]
  )
  const targetOutOfPeriod = useMemo(() => {
    if (!targetEntry) return false
    const ms = new Date(targetEntry.entryDate).getTime()
    return ms < period.start.getTime() || ms > period.end.getTime()
  }, [targetEntry, period])

  // Once the target entry is rendered, scroll to it and pulse a highlight ring
  // for a few seconds so the user can spot it in a long list.
  useEffect(() => {
    if (hashTargetId == null) return
    const inView = (entries || []).some((e) => e.id === hashTargetId)
    if (!inView) return
    const el = document.getElementById(`je-${hashTargetId}`)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    setHighlightId(hashTargetId)
    const t = window.setTimeout(() => setHighlightId(null), 2400)
    return () => window.clearTimeout(t)
  }, [hashTargetId, entries])

  const [description, setDescription] = useState("")
  const [entryDate, setEntryDate] = useState<string>(new Date().toISOString().slice(0, 10))
  const [lines, setLines] = useState<JELine[]>([
    { accountId: 0, debit: 0, credit: 0 },
    { accountId: 0, debit: 0, credit: 0 },
  ])

  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0)
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/journal-entries", {
        description,
        entryDate,
        source: "manual",
        lines: lines.filter((l) => l.accountId && (l.debit > 0 || l.credit > 0)),
      })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] })
      queryClient.invalidateQueries({ queryKey: ["/api/reports/trial-balance"] })
      queryClient.invalidateQueries({ queryKey: ["/api/reports/balance-sheet"] })
      toast({ title: t.created })
      setOpen(false)
      setDescription("")
      setLines([
        { accountId: 0, debit: 0, credit: 0 },
        { accountId: 0, debit: 0, credit: 0 },
      ])
    },
    onError: (err: any) =>
      toast({ title: t.saveFailed, description: err.message, variant: "destructive" }),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/journal-entries/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] })
      queryClient.invalidateQueries({ queryKey: ["/api/reports/trial-balance"] })
      queryClient.invalidateQueries({ queryKey: ["/api/reports/balance-sheet"] })
      toast({ title: t.deleted })
    },
  })

  return (
    <div className="space-y-8" data-testid="page-journal-entries">
      <header className="flex items-end justify-between gap-6 flex-wrap">
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
        <Dialog open={open} onOpenChange={setOpen}>
          <WriteGuard>
            <Button data-testid="button-new-entry" onClick={() => setOpen(true)}>
              <Plus className="w-4 h-4" />
              {t.add}
            </Button>
          </WriteGuard>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t.addTitle}</DialogTitle>
              <DialogDescription>{t.addDesc}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t.date}</Label>
                  <Input
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="font-numeric"
                    data-testid="input-entry-date"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t.memo}</Label>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t.memoPh}
                    data-testid="input-entry-description"
                  />
                </div>
              </div>

              <div className="border border-border rounded-md table-sticky-first">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-start font-medium">{t.account}</th>
                      <th className="px-3 py-2 text-end font-medium w-28">{t.debit}</th>
                      <th className="px-3 py-2 text-end font-medium w-28">{t.credit}</th>
                      <th className="px-2 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lines.map((l, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1.5">
                          <Select
                            value={l.accountId ? String(l.accountId) : ""}
                            onValueChange={(v) => {
                              const next = [...lines]
                              next[i].accountId = Number(v)
                              setLines(next)
                            }}
                          >
                            <SelectTrigger
                              className="h-9"
                              data-testid={`select-line-account-${i}`}
                            >
                              <SelectValue placeholder={t.pickAccount} />
                            </SelectTrigger>
                            <SelectContent>
                              {postable.map((a) => (
                                <SelectItem key={a.id} value={String(a.id)}>
                                  <span className="font-numeric text-xs text-muted-foreground me-2">
                                    {a.code}
                                  </span>
                                  {a.nameAr}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={l.debit || ""}
                            onChange={(e) => {
                              const v = Number(e.target.value || 0)
                              const next = [...lines]
                              next[i].debit = v
                              if (v > 0) next[i].credit = 0
                              setLines(next)
                            }}
                            className="h-9 text-end font-numeric tabular-nums"
                            data-testid={`input-line-debit-${i}`}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={l.credit || ""}
                            onChange={(e) => {
                              const v = Number(e.target.value || 0)
                              const next = [...lines]
                              next[i].credit = v
                              if (v > 0) next[i].debit = 0
                              setLines(next)
                            }}
                            className="h-9 text-end font-numeric tabular-nums"
                            data-testid={`input-line-credit-${i}`}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {lines.length > 2 && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() =>
                                setLines(lines.filter((_, idx) => idx !== i))
                              }
                              data-testid={`button-remove-line-${i}`}
                              aria-label="Remove line"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/40 text-sm font-semibold border-t border-border">
                    <tr>
                      <td className="px-3 py-2 text-start text-muted-foreground uppercase tracking-wider text-[11px]">
                        {t.total}
                      </td>
                      <td
                        className="px-3 py-2 text-end font-numeric tabular-nums"
                        data-testid="text-total-debit"
                      >
                        {fmt(totalDebit)}
                      </td>
                      <td
                        className="px-3 py-2 text-end font-numeric tabular-nums"
                        data-testid="text-total-credit"
                      >
                        {fmt(totalCredit)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setLines([...lines, { accountId: 0, debit: 0, credit: 0 }])
                  }
                  data-testid="button-add-line"
                >
                  <Plus className="w-3.5 h-3.5" /> {t.addLine}
                </Button>
                <div
                  className={cn(
                    "flex items-center gap-2 text-xs font-medium",
                    isBalanced ? "text-success" : "text-warning"
                  )}
                >
                  <Scale className="w-3.5 h-3.5" />
                  <span className="font-numeric tabular-nums">
                    {isBalanced
                      ? t.balanced
                      : `${t.diff}: ${fmt(Math.abs(totalDebit - totalCredit))}`}
                  </span>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={
                  !isBalanced || !description.trim() || createMutation.isPending
                }
                data-testid="button-save-entry"
              >
                {t.save}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </header>

      {/* Linked entry hint when the deep-linked JE is filtered out by the period */}
      {targetEntry && targetOutOfPeriod && (
        <div
          className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground flex items-start justify-between gap-3 flex-wrap"
          data-testid="banner-linked-entry-out-of-period"
        >
          <div className="flex-1 min-w-0">
            <div className="font-medium">
              {locale === "ar"
                ? `القيد المطلوب ${targetEntry.reference} خارج الفترة المختارة`
                : `Linked entry ${targetEntry.reference} is outside the selected period`}
            </div>
            <div className="text-xs text-muted-foreground mt-1 font-numeric tabular-nums">
              {format(new Date(targetEntry.entryDate), "d MMM yyyy", { locale: dfLocale })}
              {" · "}
              {targetEntry.description}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const el = document.getElementById(`je-${targetEntry.id}`)
              if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "center" })
                setHighlightId(targetEntry.id)
                window.setTimeout(() => setHighlightId(null), 2400)
              }
            }}
            data-testid="button-jump-linked-entry"
          >
            {locale === "ar" ? "عرض القيد" : "Show entry"}
          </Button>
        </div>
      )}

      {/* Entries list */}
      {isLoading ? (
        <CardGridSkeleton count={4} cols={1} height="h-28" />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} testId="error-journal" />
      ) : !entries?.length ? (
        <EmptyState title={t.empty} description={t.emptyHint} testId="empty-journal" />
      ) : (
        <div className="space-y-3">
          {entries.map((je) => {
            const td = je.lines.reduce((s, l) => s + Number(l.debit || 0), 0)
            const sourceLabel =
              je.source === "transaction"
                ? t.sourceAuto
                : je.source === "ai"
                ? t.sourceAi
                : t.sourceManual
            return (
              <Card
                key={je.id}
                id={`je-${je.id}`}
                variant="default"
                className={cn(
                  "overflow-hidden p-0 scroll-mt-24 transition-all duration-500",
                  highlightId === je.id && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                )}
                data-testid={`card-entry-${je.id}`}
                data-highlighted={highlightId === je.id ? "true" : undefined}
              >
                <div className="px-5 py-3.5 flex items-start justify-between gap-4 border-b border-border">
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => setDetailEntry(je)}
                      className="flex items-center gap-2.5 flex-wrap text-start hover:underline"
                      data-testid={`link-entry-${je.id}`}
                    >
                      <span className="font-numeric text-[11px] tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
                        {je.reference}
                      </span>
                      <h3 className="text-sm font-medium text-foreground truncate">
                        {je.description}
                      </h3>
                    </button>
                    <div className="flex items-center gap-2.5 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                      <span className="font-numeric tabular-nums">
                        {format(new Date(je.entryDate), "d MMM yyyy", { locale: dfLocale })}
                      </span>
                      <span className="text-muted-foreground/50">·</span>
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
                        {sourceLabel}
                      </Badge>
                      <span className="text-muted-foreground/50">·</span>
                      <span className="font-numeric tabular-nums font-semibold text-foreground">
                        {fmt(td)}
                      </span>
                      {je.sourceLink && (
                        <>
                          <span className="text-muted-foreground/50">·</span>
                          <SourceLinkBadge
                            link={je.sourceLink}
                            labels={{
                              fromPrefix: t.sourceFromPrefix,
                              payroll: t.sourceKindPayroll,
                              depreciation: t.sourceKindDepreciation,
                              impairment: t.sourceKindImpairment,
                              revaluation: t.sourceKindRevaluation,
                              disposal: t.sourceKindDisposal,
                              aria: t.sourceLinkAria,
                            }}
                          />
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setHistoryEntry(je)}
                      data-testid={`button-history-entry-${je.id}`}
                      aria-label={locale === "ar" ? "السجل" : "History"}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <History className="w-3.5 h-3.5" />
                    </Button>
                    {je.source !== "transaction" && (
                      <WriteGuard>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => deleteMutation.mutate(je.id)}
                          data-testid={`button-delete-entry-${je.id}`}
                          aria-label={locale === "ar" ? "حذف القيد" : "Delete entry"}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </WriteGuard>
                    )}
                  </div>
                </div>
                <div className="table-sticky-first">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/30">
                    <tr>
                      <th className="text-start px-5 py-2 font-medium">{t.account}</th>
                      <th className="text-end px-5 py-2 font-medium w-28">{t.debit}</th>
                      <th className="text-end px-5 py-2 font-medium w-28">{t.credit}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {je.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="px-5 py-2">
                          <span className="font-numeric text-[11px] text-muted-foreground tabular-nums me-2">
                            {l.account?.code}
                          </span>
                          <span className="text-foreground">
                            {l.account?.nameAr || "—"}
                          </span>
                        </td>
                        <td className="px-5 py-2 text-end font-numeric tabular-nums text-foreground">
                          {Number(l.debit) > 0 ? fmt(Number(l.debit)) : ""}
                        </td>
                        <td className="px-5 py-2 text-end font-numeric tabular-nums text-foreground">
                          {Number(l.credit) > 0 ? fmt(Number(l.credit)) : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <HistoryDrawer
        open={!!historyEntry}
        onOpenChange={(o) => { if (!o) setHistoryEntry(null) }}
        title={historyEntry?.description || ""}
        reference={historyEntry?.reference}
        entityType="journal_entry"
        entityId={historyEntry?.id}
      />
      {detailEntry && (
        <JournalEntryDetailDialog
          entry={detailEntry}
          onClose={() => setDetailEntry(null)}
          labels={{
            description: t.detailDesc,
            tabLines: t.tabLines,
            tabChanges: t.tabChanges,
            account: t.account,
            debit: t.debit,
            credit: t.credit,
            total: t.total,
            sourceManual: t.sourceManual,
            sourceAuto: t.sourceAuto,
            sourceAi: t.sourceAi,
          }}
          dfLocale={dfLocale}
          fmt={fmt}
        />
      )}
    </div>
  )
}

interface JournalEntryDetailDialogProps {
  entry: JE
  onClose: () => void
  labels: {
    description: string
    tabLines: string
    tabChanges: string
    account: string
    debit: string
    credit: string
    total: string
    sourceManual: string
    sourceAuto: string
    sourceAi: string
  }
  dfLocale: Locale
  fmt: ReturnType<typeof useFormatMoney>
}

function JournalEntryDetailDialog({ entry, onClose, labels, dfLocale, fmt }: JournalEntryDetailDialogProps) {
  const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit || 0), 0)
  const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit || 0), 0)
  const sourceLabel =
    entry.source === "transaction"
      ? labels.sourceAuto
      : entry.source === "ai"
      ? labels.sourceAi
      : labels.sourceManual
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-entry-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-numeric text-[11px] tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
              {entry.reference}
            </span>
            <span className="truncate">{entry.description}</span>
          </DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
          <span className="font-numeric tabular-nums">
            {format(new Date(entry.entryDate), "d MMM yyyy", { locale: dfLocale })}
          </span>
          <span className="text-muted-foreground/50">·</span>
          <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
            {sourceLabel}
          </Badge>
        </div>
        <Tabs defaultValue="lines" className="mt-3">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="lines" data-testid="tab-entry-lines">{labels.tabLines}</TabsTrigger>
            <TabsTrigger value="changes" data-testid="tab-entry-changes">{labels.tabChanges}</TabsTrigger>
          </TabsList>
          <TabsContent value="lines" className="mt-4">
            <div className="border border-border rounded-md table-sticky-first">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">{labels.account}</th>
                    <th className="px-3 py-2 text-end font-medium w-28">{labels.debit}</th>
                    <th className="px-3 py-2 text-end font-medium w-28">{labels.credit}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entry.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">
                        <span className="font-numeric text-[11px] text-muted-foreground tabular-nums me-2">
                          {l.account?.code}
                        </span>
                        <span className="text-foreground">
                          {l.account?.nameAr || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-end font-numeric tabular-nums text-foreground">
                        {Number(l.debit) > 0 ? fmt(Number(l.debit)) : ""}
                      </td>
                      <td className="px-3 py-2 text-end font-numeric tabular-nums text-foreground">
                        {Number(l.credit) > 0 ? fmt(Number(l.credit)) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40 text-sm font-semibold border-t border-border">
                  <tr>
                    <td className="px-3 py-2 text-start text-muted-foreground uppercase tracking-wider text-[11px]">
                      {labels.total}
                    </td>
                    <td
                      className="px-3 py-2 text-end font-numeric tabular-nums"
                      data-testid="text-entry-detail-total-debit"
                    >
                      {fmt(totalDebit)}
                    </td>
                    <td
                      className="px-3 py-2 text-end font-numeric tabular-nums"
                      data-testid="text-entry-detail-total-credit"
                    >
                      {fmt(totalCredit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </TabsContent>
          <TabsContent value="changes" className="mt-4" data-testid="tab-content-entry-changes">
            <div className="rounded-md border border-border max-h-96 overflow-hidden flex flex-col">
              <HistoryTimeline
                entityType="journal_entry"
                entityId={entry.id}
                className="flex-1 min-h-0"
              />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

// Localised month name (Arabic + English) used in the JE source-link badge so
// "From: Payroll 11/2025" reads naturally in both locales.
const MONTH_NAMES_AR = [
  "يناير","فبراير","مارس","أبريل","مايو","يونيو",
  "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر",
]
const MONTH_NAMES_EN = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
]

interface SourceLinkBadgeLabels {
  fromPrefix: string
  payroll: string
  depreciation: string
  impairment: string
  revaluation: string
  disposal: string
  aria: string
}

// Renders a small "From: Payroll 11/2025" badge that deep-links back to the
// originating row (payroll run, depreciation run, or fixed-asset event).
// The parent component is responsible for hiding this when `link` is absent
// — i.e. when the source row no longer exists.
function SourceLinkBadge({
  link,
  labels,
}: {
  link: JournalEntrySourceLink
  labels: SourceLinkBadgeLabels
}) {
  const { locale } = useLocale()
  const months = locale === "ar" ? MONTH_NAMES_AR : MONTH_NAMES_EN

  const labelBody = (() => {
    if (link.kind === "payroll_run" && link.period) {
      return `${labels.payroll} ${months[link.period.month - 1]} ${link.period.year}`
    }
    if (link.kind === "depreciation_run" && link.period) {
      return `${labels.depreciation} ${months[link.period.month - 1]} ${link.period.year}`
    }
    const kindLabel =
      link.kind === "impairment" ? labels.impairment
      : link.kind === "revaluation" ? labels.revaluation
      : labels.disposal
    const assetTag = link.assetCode || link.assetName
    return assetTag ? `${kindLabel} — ${assetTag}` : kindLabel
  })()

  return (
    <Link
      href={link.href}
      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted hover:border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={`${labels.fromPrefix} ${labelBody}`}
      aria-label={labels.aria}
      data-testid={`link-je-source-${link.kind}-${link.id}`}
    >
      <span className="text-muted-foreground">{labels.fromPrefix}</span>
      <span>{labelBody}</span>
    </Link>
  )
}
