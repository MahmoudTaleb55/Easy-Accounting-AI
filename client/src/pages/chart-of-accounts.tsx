import { useEffect, useMemo, useState } from "react"
import { useLocation, useSearch } from "wouter"
import { JournalEntryRefLink } from "@/components/journal/journal-entry-ref-link"
import { useQuery, useMutation } from "@tanstack/react-query"
import { format } from "date-fns"
import { ar, enUS } from "date-fns/locale"
import { apiRequest, queryClient } from "@/lib/queryClient"
import { useToast } from "@/hooks/use-toast"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CardGridSkeleton } from "@/components/feedback/list-skeleton"
import { EmptyState } from "@/components/feedback/empty-state"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { WriteGuard, useCanWrite } from "@/components/auth/write-guard"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, Download, Plus, Search, Sparkles, Trash2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { Account } from "@shared/schema"
import {
  buildLedgerCsv,
  buildLedgerCsvFilename,
} from "@/pages/chart-of-accounts-ledger-csv"
import {
  computeBalanceByAccountId,
  type BalanceBreakdown,
} from "@/pages/chart-of-accounts-rollup"
import { useLocale } from "@/contexts/locale-context"
import { useAuth } from "@/hooks/use-auth"
import { useFormatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { PeriodChip } from "@/components/dashboard/period-chip"
import { usePeriod } from "@/contexts/period-context"
import {
  computeLedgerRunningBalances,
  isDebitNormalAccountType,
  type LedgerAccountType,
} from "@/pages/chart-of-accounts-ledger"

/* ------------------------------------------------------------------ */
/* Account ledger drawer types                                         */
/* The /api/journal-entries endpoint returns each entry with its line  */
/* array; we filter client-side to the selected account so the drawer  */
/* shares cache with the journal page (no extra round-trip).           */
/* ------------------------------------------------------------------ */
interface LedgerJELine {
  accountId: number
  debit: string | number
  credit: string | number
  description?: string | null
}
interface LedgerJE {
  id: number
  reference: string
  entryDate: string
  description: string | null
  lines: LedgerJELine[]
}

/* ------------------------------------------------------------------ */
/* Type styling — token-based, no raw hex                               */
/* ------------------------------------------------------------------ */

type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense"
const TYPE_ORDER: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"]

const typeLabel: Record<AccountType, { ar: string; en: string }> = {
  asset: { ar: "أصول", en: "Assets" },
  liability: { ar: "خصوم", en: "Liabilities" },
  equity: { ar: "حقوق ملكية", en: "Equity" },
  revenue: { ar: "إيرادات", en: "Revenue" },
  expense: { ar: "مصروفات", en: "Expenses" },
}

// Each type maps to one of the chart-N tokens for a coherent palette.
const typeAccent: Record<AccountType, string> = {
  asset: "bg-[hsl(var(--chart-1))]",
  liability: "bg-[hsl(var(--chart-3))]",
  equity: "bg-[hsl(var(--chart-5))]",
  revenue: "bg-[hsl(var(--chart-2))]",
  expense: "bg-[hsl(var(--chart-4))]",
}

interface TreeNode {
  account: Account
  children: TreeNode[]
}

const STORAGE_KEY_PREFIX = "coa-expanded-v1"
const PERIOD_STORAGE_KEY_PREFIX = "coa-balance-period-v1"

type BalancePeriod = "month" | "year" | "all"
const BALANCE_PERIODS: BalancePeriod[] = ["month", "year", "all"]

interface BalanceRow {
  accountId: number
  debit: number
  credit: number
  balance: number
}
interface BalancesResponse {
  period: BalancePeriod
  rows: BalanceRow[]
}

export default function ChartOfAccountsPage() {
  const { locale } = useLocale()
  const { toast } = useToast()
  const { activeCompanyId } = useAuth()
  const canWrite = useCanWrite()
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)
  const [, setLocation] = useLocation()
  const queryString = useSearch()

  // Quick-create deep-link from the topbar Plus-menu / command palette:
  // `?new=1` should auto-open the add-account dialog. Strip the param
  // after opening so reload / back doesn't re-open it.
  useEffect(() => {
    const params = new URLSearchParams(queryString)
    if (params.get("new") === "1" && canWrite) {
      setOpen(true)
      setLocation("/app/accounts", { replace: true })
    }
  }, [queryString, canWrite, setLocation])
  const [form, setForm] = useState({
    code: "",
    nameAr: "",
    nameEn: "",
    type: "expense" as AccountType,
    subtype: "operating_expense",
  })

  const t = useMemo(
    () => ({
      eyebrow: locale === "ar" ? "دليل الحسابات" : "Chart of accounts",
      title:
        locale === "ar"
          ? "بنية حساباتك، وفق IFRS."
          : "Your account structure, IFRS-aligned.",
      subtitle:
        locale === "ar"
          ? "خمس فئات: أصول، خصوم، حقوق ملكية، إيرادات، مصروفات."
          : "Five buckets: assets, liabilities, equity, revenue, expenses.",
      add: locale === "ar" ? "حساب جديد" : "New account",
      addTitle: locale === "ar" ? "إضافة حساب" : "Add account",
      addDesc:
        locale === "ar"
          ? "حدّد الكود والنوع والاسم لإضافة حساب جديد إلى الدليل."
          : "Set code, type, and name to add a new account to the chart.",
      searchPh: locale === "ar" ? "ابحث عن حساب…" : "Search accounts…",
      code: locale === "ar" ? "الكود" : "Code",
      type: locale === "ar" ? "النوع" : "Type",
      nameAr: locale === "ar" ? "الاسم بالعربية" : "Arabic name",
      nameEn: locale === "ar" ? "الاسم بالإنجليزية" : "English name",
      subtype: locale === "ar" ? "التصنيف الفرعي" : "Subtype",
      save: locale === "ar" ? "حفظ" : "Save",
      created: locale === "ar" ? "تم إضافة الحساب" : "Account added",
      createFailed: locale === "ar" ? "فشل الإنشاء" : "Could not create account",
      empty: locale === "ar" ? "لا حسابات مطابقة" : "No matching accounts",
      noAccounts:
        locale === "ar"
          ? "لا يوجد دليل حسابات بعد"
          : "No chart of accounts yet",
      noAccountsDesc:
        locale === "ar"
          ? "ابدأ بإضافة حساب يدوياً، أو استعد الدليل الافتراضي المتوافق مع IFRS لتنطلق فوراً."
          : "Add an account manually, or restore the default IFRS-ready chart to start in one click.",
      restoreDefaults:
        locale === "ar" ? "استعادة الدليل الافتراضي" : "Restore default chart",
      restoredOk:
        locale === "ar"
          ? "تم زرع الدليل الافتراضي"
          : "Default chart of accounts seeded",
      restoreFailed:
        locale === "ar"
          ? "تعذّر استعادة الدليل الافتراضي"
          : "Could not restore the default chart",
      ledgerTitle: locale === "ar" ? "حركة الحساب" : "Account ledger",
      ledgerDesc:
        locale === "ar"
          ? "كل سطر مدين/دائن مرحَّل إلى هذا الحساب، مع رابط إلى قيد اليومية الأصلي."
          : "Every debit/credit posted to this account, each linked back to its journal entry.",
      ledgerDate: locale === "ar" ? "التاريخ" : "Date",
      ledgerMemo: locale === "ar" ? "البيان" : "Memo",
      ledgerDebit: locale === "ar" ? "مدين" : "Debit",
      ledgerCredit: locale === "ar" ? "دائن" : "Credit",
      ledgerJE: locale === "ar" ? "القيد" : "Entry",
      ledgerEmpty:
        locale === "ar"
          ? "لا حركة على هذا الحساب بعد"
          : "No postings to this account yet",
      ledgerEmptyHint:
        locale === "ar"
          ? "ستظهر هنا أسطر القيود فور ترحيل أول قيد يستخدم الحساب."
          : "Lines will appear here as soon as a journal entry posts to this account.",
      // Period-aware empty title — substitutes the active range so users can
      // tell at a glance which window they're looking through. Date strings
      // are formatted by the sheet (it owns the locale + period context) and
      // spliced in via the {start}/{end} placeholders below.
      ledgerEmptyPeriodRange:
        locale === "ar"
          ? "لا حركة على هذا الحساب بين {start} و{end}"
          : "No postings between {start} and {end}",
      ledgerEmptyPeriodHint:
        locale === "ar"
          ? "جرّب توسيع نطاق الفترة من الأعلى لاستعراض المزيد من الحركات."
          : "Try widening the period range above to see more postings.",
      // Inline jump-to-YTD shortcut, surfaced when the active window is
      // narrower than the whole year so users don't have to hunt for the
      // chip dropdown to broaden their view.
      ledgerEmptyPeriodSwitchYtd:
        locale === "ar"
          ? "عرض منذ بداية السنة"
          : "Switch to year-to-date",
      ledgerJumpPast: (date: string) =>
        locale === "ar"
          ? `الانتقال إلى أحدث حركة سابقة (${date})`
          : `Jump to latest earlier posting (${date})`,
      ledgerJumpFuture: (date: string) =>
        locale === "ar"
          ? `الانتقال إلى أقرب حركة قادمة (${date})`
          : `Jump to nearest upcoming posting (${date})`,
      ledgerOpenAria: locale === "ar" ? "فتح حركة الحساب" : "Open account ledger",
      ledgerJEAria:
        locale === "ar" ? "فتح قيد اليومية" : "Open journal entry",
      ledgerTotalDebit: locale === "ar" ? "إجمالي المدين" : "Total debit",
      ledgerTotalCredit: locale === "ar" ? "إجمالي الدائن" : "Total credit",
      ledgerBalance: locale === "ar" ? "الرصيد" : "Balance",
      ledgerOpening: locale === "ar" ? "الرصيد الافتتاحي" : "Opening balance",
      ledgerClosing: locale === "ar" ? "الرصيد الختامي" : "Closing balance",
      ledgerDownload: locale === "ar" ? "تنزيل CSV" : "Download CSV",
      ledgerDownloadAria:
        locale === "ar"
          ? "تنزيل حركة الحساب كملف CSV"
          : "Download account ledger as CSV",
      ledgerCsvFilenamePrefix: locale === "ar" ? "حركة-حساب" : "ledger",
      periodLabel: locale === "ar" ? "نطاق الأرصدة" : "Balances scope",
      periodMonth: locale === "ar" ? "هذا الشهر" : "This month",
      periodYear: locale === "ar" ? "هذه السنة" : "This year",
      periodAll: locale === "ar" ? "كل الفترات" : "All time",
      balanceAria: locale === "ar" ? "الرصيد الحالي" : "Current balance",
      balanceBreakdownDebit: locale === "ar" ? "مدين" : "Debit",
      balanceBreakdownCredit: locale === "ar" ? "دائن" : "Credit",
      balanceBreakdownNet: locale === "ar" ? "صافي" : "Net",
      balanceBreakdownAria:
        locale === "ar"
          ? "تفصيل الرصيد لهذه الفترة"
          : "Balance breakdown for this period",
    }),
    [locale]
  )

  // Account ledger drawer — chosen account row whose postings we surface.
  // Held in state instead of the URL so reload returns to the COA tree itself,
  // which is the more informative landing.
  const [ledgerAccount, setLedgerAccount] = useState<Account | null>(null)

  const { data: accounts, isLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
  })

  /* ------------------------------------------------------------------ */
  /* Period selector — scopes the trailing balance column. Persisted     */
  /* per-workspace in localStorage so flipping back to this page (or to  */
  /* another workspace) restores the owner's last choice. We hydrate     */
  /* lazily once the active workspace id is known to avoid clobbering    */
  /* the saved value on first paint.                                      */
  /* ------------------------------------------------------------------ */
  const periodStorageKey = activeCompanyId
    ? `${PERIOD_STORAGE_KEY_PREFIX}:${activeCompanyId}`
    : null
  const [period, setPeriod] = useState<BalancePeriod>("all")
  const [periodHydratedFor, setPeriodHydratedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!periodStorageKey) return
    if (periodHydratedFor === periodStorageKey) return
    try {
      const raw = localStorage.getItem(periodStorageKey)
      if (raw && (BALANCE_PERIODS as string[]).includes(raw)) {
        setPeriod(raw as BalancePeriod)
      } else {
        setPeriod("all")
      }
    } catch {
      setPeriod("all")
    }
    setPeriodHydratedFor(periodStorageKey)
  }, [periodStorageKey, periodHydratedFor])

  useEffect(() => {
    if (!periodStorageKey || periodHydratedFor !== periodStorageKey) return
    try {
      localStorage.setItem(periodStorageKey, period)
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [period, periodStorageKey, periodHydratedFor])

  // Custom queryFn here because the default fetcher in lib/queryClient.ts
  // builds the URL by joining the queryKey segments with "/" — for a
  // querystring-driven endpoint like this one we'd otherwise hit
  // /api/accounts/balances/<period> (404) instead of the documented
  // /api/accounts/balances?period=<period>. The queryKey still includes the
  // period so cache + invalidation are scoped correctly.
  const { data: balances, isLoading: balancesLoading, isError: balancesError } =
    useQuery<BalancesResponse>({
      queryKey: ["/api/accounts/balances", period],
      queryFn: async () => {
        const res = await apiRequest(
          "GET",
          `/api/accounts/balances?period=${encodeURIComponent(period)}`,
        )
        return res.json()
      },
    })

  const fmt = useFormatMoney()

  /* ------------------------------------------------------------------ */
  /* Roll up balances onto header rows. The `/api/accounts/balances`     */
  /* endpoint returns one row per posting account; header rows aren't    */
  /* posted to directly, so their displayed balance is the sum of every  */
  /* descendant leaf in their subtree. The actual rollup lives in        */
  /* `chart-of-accounts-rollup.ts` so the unit suite can pin the         */
  /* multi-level descendant-sum contract without spinning up the page    */
  /* — see `__tests__/chart-of-accounts-rollup.test.ts`.                  */
  /*                                                                      */
  /* The helper now returns a `{ debit, credit, balance }` breakdown per  */
  /* account so the trailing-balance hover/popover (task #224) can show   */
  /* the period's gross debit and credit alongside the net. Headers sum   */
  /* each side independently across the subtree — the same pattern as     */
  /* the net — which avoids ever having to re-derive a parent's gross     */
  /* movement from a (potentially small) net.                              */
  /* ------------------------------------------------------------------ */
  const balanceByAccountId = useMemo(
    () => computeBalanceByAccountId(accounts, balances?.rows),
    [accounts, balances],
  )

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/accounts", { ...form, isHeader: false })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] })
      toast({ title: t.created })
      setOpen(false)
      setForm({
        code: "",
        nameAr: "",
        nameEn: "",
        type: "expense",
        subtype: "operating_expense",
      })
    },
    onError: (err: any) =>
      toast({ title: t.createFailed, description: err.message, variant: "destructive" }),
  })

  const restoreMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/accounts/restore-defaults", {})
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] })
      toast({ title: t.restoredOk })
    },
    onError: (err: any) =>
      toast({
        title: t.restoreFailed,
        description: err.message,
        variant: "destructive",
      }),
  })

  // Track which account the user is about to delete so the confirm dialog
  // can render the account name + code, and so the dialog can stay closed
  // until the user actually clicks the trash icon. Stored as the full
  // Account row (not just an id) because the alert dialog needs the human-
  // readable code/name to surface a clear "you're about to delete X" line.
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null)
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/accounts/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] })
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/balances"] })
      toast({
        title: locale === "ar" ? "تم الحذف" : "Account deleted",
      })
      setAccountToDelete(null)
    },
    onError: (err: any) => {
      // The server returns Arabic messages with status 404 (missing account)
      // or 409 (still has postings or children). Surface the message verbatim
      // so the owner knows exactly which safety rule blocked the delete.
      toast({
        title: locale === "ar" ? "تعذّر الحذف" : "Delete failed",
        description: err?.message,
        variant: "destructive",
      })
    },
  })

  /* ------------------------------------------------------------------ */
  /* Tree build — group by type, link parent → children via parentId.    */
  /* When searching, only matching accounts (and all their ancestors)    */
  /* survive the visibility filter, and the ancestors auto-expand so the */
  /* match is actually reachable in the rendered tree.                   */
  /* ------------------------------------------------------------------ */
  const tree = useMemo(() => {
    if (!accounts) return null
    const byId = new Map<number, Account>(accounts.map((a) => [a.id, a]))

    const q = search.trim().toLowerCase()
    const matches = (a: Account) =>
      !q ||
      a.code.toLowerCase().includes(q) ||
      a.nameAr.toLowerCase().includes(q) ||
      a.nameEn.toLowerCase().includes(q)

    let visibleIds: Set<number> | null = null
    const autoExpand = new Set<string>()
    if (q) {
      visibleIds = new Set<number>()
      for (const a of accounts) {
        if (!matches(a)) continue
        visibleIds.add(a.id)
        let p = a.parentId != null ? byId.get(a.parentId) : undefined
        while (p) {
          visibleIds.add(p.id)
          autoExpand.add(p.code)
          p = p.parentId != null ? byId.get(p.parentId) : undefined
        }
      }
    }
    const isVisible = (a: Account) => visibleIds === null || visibleIds.has(a.id)

    const kidsByParentId = new Map<number, Account[]>()
    const roots: Account[] = []
    for (const a of accounts) {
      if (!isVisible(a)) continue
      const parent = a.parentId != null ? byId.get(a.parentId) : undefined
      // A "root within a type card" is anything whose parent is missing,
      // hidden by the search filter, or sits in a different type bucket.
      if (!parent || !isVisible(parent) || parent.type !== a.type) {
        roots.push(a)
        continue
      }
      const arr = kidsByParentId.get(parent.id) ?? []
      arr.push(a)
      kidsByParentId.set(parent.id, arr)
    }

    function build(a: Account): TreeNode {
      const kids = (kidsByParentId.get(a.id) ?? [])
        .slice()
        .sort((x, y) => x.code.localeCompare(y.code))
        .map(build)
      return { account: a, children: kids }
    }

    const byType: Record<AccountType, TreeNode[]> = {
      asset: [],
      liability: [],
      equity: [],
      revenue: [],
      expense: [],
    }
    roots.sort((x, y) => x.code.localeCompare(y.code))
    for (const r of roots) {
      byType[r.type as AccountType].push(build(r))
    }
    const visibleCount = visibleIds === null ? accounts.length : visibleIds.size
    return { byType, autoExpand, visibleCount, totalCount: accounts.length }
  }, [accounts, search])

  /* ------------------------------------------------------------------ */
  /* Expansion state — persisted per-workspace in localStorage.          */
  /* Default (no saved value): expand the top-level header in each type. */
  /* ------------------------------------------------------------------ */
  const storageKey = activeCompanyId
    ? `${STORAGE_KEY_PREFIX}:${activeCompanyId}`
    : null
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [hydratedFor, setHydratedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!storageKey || !tree) return
    if (hydratedFor === storageKey) return
    let initial: Set<string>
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const arr = JSON.parse(raw) as unknown
        initial = new Set(Array.isArray(arr) ? arr.map(String) : [])
      } else {
        initial = new Set<string>()
        for (const type of TYPE_ORDER) {
          for (const r of tree.byType[type]) initial.add(r.account.code)
        }
      }
    } catch {
      initial = new Set<string>()
      for (const type of TYPE_ORDER) {
        for (const r of tree.byType[type]) initial.add(r.account.code)
      }
    }
    setExpanded(initial)
    setHydratedFor(storageKey)
  }, [storageKey, tree, hydratedFor])

  useEffect(() => {
    if (!storageKey || hydratedFor !== storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(expanded)))
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [expanded, storageKey, hydratedFor])

  function toggle(code: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const isExpanded = (code: string) =>
    expanded.has(code) || tree?.autoExpand.has(code) === true

  return (
    <div className="space-y-8" data-testid="page-chart-of-accounts">
      {/* Header */}
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
          <ToggleGroup
            type="single"
            value={period}
            onValueChange={(v) => {
              // Radix's single-mode ToggleGroup emits "" when the user clicks
              // the currently active item (toggling it off). We don't want a
              // null/empty scope, so we ignore that case and keep the prior
              // selection — there's always a defined period.
              if (v && (BALANCE_PERIODS as string[]).includes(v)) {
                setPeriod(v as BalancePeriod)
              }
            }}
            size="sm"
            variant="outline"
            aria-label={t.periodLabel}
            className="bg-card rounded-md p-0.5 border border-border"
            data-testid="toggle-balance-period"
          >
            <ToggleGroupItem value="month" data-testid="toggle-balance-period-month" className="text-xs px-2.5 h-7">
              {t.periodMonth}
            </ToggleGroupItem>
            <ToggleGroupItem value="year" data-testid="toggle-balance-period-year" className="text-xs px-2.5 h-7">
              {t.periodYear}
            </ToggleGroupItem>
            <ToggleGroupItem value="all" data-testid="toggle-balance-period-all" className="text-xs px-2.5 h-7">
              {t.periodAll}
            </ToggleGroupItem>
          </ToggleGroup>

          <div className="relative w-full sm:w-64">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={t.searchPh}
              className="ps-9 h-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-accounts"
            />
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <WriteGuard>
              <Button data-testid="button-add-account" onClick={() => setOpen(true)}>
                <Plus className="w-4 h-4" /> {t.add}
              </Button>
            </WriteGuard>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t.addTitle}</DialogTitle>
                <DialogDescription>{t.addDesc}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>{t.code}</Label>
                    <Input
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value })}
                      placeholder="6200"
                      className="font-numeric"
                      data-testid="input-account-code"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t.type}</Label>
                    <Select
                      value={form.type}
                      onValueChange={(v) => setForm({ ...form, type: v as AccountType })}
                    >
                      <SelectTrigger data-testid="select-account-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TYPE_ORDER.map((tt) => (
                          <SelectItem key={tt} value={tt}>
                            {locale === "ar" ? typeLabel[tt].ar : typeLabel[tt].en}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>{t.nameAr}</Label>
                  <Input
                    value={form.nameAr}
                    onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
                    data-testid="input-account-name-ar"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t.nameEn}</Label>
                  <Input
                    value={form.nameEn}
                    onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                    data-testid="input-account-name-en"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t.subtype}</Label>
                  <Input
                    value={form.subtype}
                    onChange={(e) => setForm({ ...form, subtype: e.target.value })}
                    placeholder="operating_expense"
                    className="font-mono text-xs"
                    data-testid="input-account-subtype"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={
                    createMutation.isPending ||
                    !form.code ||
                    !form.nameAr ||
                    !form.nameEn
                  }
                  data-testid="button-save-account"
                >
                  {t.save}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {/* Grid */}
      {isLoading || !tree ? (
        <CardGridSkeleton count={4} cols={2} height="h-56" />
      ) : tree.totalCount === 0 ? (
        <EmptyState
          title={t.noAccounts}
          description={t.noAccountsDesc}
          icon={<Sparkles className="w-5 h-5" />}
          action={
            canWrite
              ? {
                  label: t.restoreDefaults,
                  onClick: () => restoreMutation.mutate(),
                  testId: "button-restore-default-coa",
                }
              : undefined
          }
          testId="empty-coa-no-accounts"
        />
      ) : TYPE_ORDER.filter((tt) => tree.byType[tt].length).length === 0 ? (
        <EmptyState
          title={t.empty}
          description={
            locale === "ar"
              ? "جرّب كلمة بحث أخرى أو امسح المرشّح للعودة إلى كامل الدليل."
              : "Try a different search term or clear the filter to see the full chart."
          }
          testId="empty-coa"
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {TYPE_ORDER.filter((tt) => tree.byType[tt].length).map((type) => (
            <Card
              key={type}
              variant="default"
              className="overflow-hidden p-0"
              data-testid={`card-type-${type}`}
            >
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className={cn("inline-block h-3.5 w-1 rounded-sm", typeAccent[type])}
                  />
                  <h3 className="text-sm font-semibold text-foreground">
                    {locale === "ar" ? typeLabel[type].ar : typeLabel[type].en}
                  </h3>
                </div>
                <span className="text-xs font-numeric tabular-nums text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded border border-border">
                  {countNodes(tree.byType[type])}
                </span>
              </div>
              <ul
                className="divide-y divide-border"
                data-testid={`tree-type-${type}`}
              >
                {tree.byType[type].map((node) => (
                  <TreeRow
                    key={node.account.id}
                    node={node}
                    depth={0}
                    locale={locale}
                    isExpanded={isExpanded}
                    onToggle={toggle}
                    onOpenLedger={setLedgerAccount}
                    openLedgerAria={t.ledgerOpenAria}
                    balanceByAccountId={balanceByAccountId}
                    balancesLoading={balancesLoading}
                    balancesError={balancesError}
                    formatMoney={fmt}
                    balanceAria={t.balanceAria}
                    breakdownLabels={{
                      debit: t.balanceBreakdownDebit,
                      credit: t.balanceBreakdownCredit,
                      net: t.balanceBreakdownNet,
                      aria: t.balanceBreakdownAria,
                    }}
                    canDelete={canWrite}
                    onDelete={setAccountToDelete}
                  />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {/*
        Confirm dialog for deleting a single account. Driven by
        `accountToDelete`: opening it requires clicking the row's trash
        icon (so accidental keyboard navigation can never trigger it),
        and closing it via Cancel or backdrop click resets the state to
        null. The action button stays in "Deleting…" state while the
        mutation is pending so the user gets clear feedback that the
        request is in flight.
      */}
      <AlertDialog
        open={accountToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setAccountToDelete(null)
        }}
      >
        <AlertDialogContent data-testid="dialog-delete-account">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {locale === "ar" ? "حذف الحساب" : "Delete account"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {accountToDelete && (
                locale === "ar" ? (
                  <>
                    سيتم حذف الحساب{" "}
                    <span className="font-medium text-foreground">
                      {accountToDelete.code} — {accountToDelete.nameAr}
                    </span>
                    . هذا الإجراء لا يمكن التراجع عنه. لا يمكن حذف حساب يحتوي
                    على قيود مسجلة أو حسابات فرعية.
                  </>
                ) : (
                  <>
                    Account{" "}
                    <span className="font-medium text-foreground">
                      {accountToDelete.code} — {accountToDelete.nameEn}
                    </span>
                    {" "}will be deleted. This cannot be undone. Accounts with
                    posted journal lines or sub-accounts cannot be deleted.
                  </>
                )
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-account">
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Prevent the dialog from auto-closing — we close it from the
                // mutation `onSuccess` so the spinner stays visible until the
                // server actually confirms. If the request fails, the dialog
                // stays open so the user can read the error toast and decide
                // whether to retry.
                e.preventDefault()
                if (accountToDelete) {
                  deleteMutation.mutate(accountToDelete.id)
                }
              }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-account"
            >
              {deleteMutation.isPending
                ? locale === "ar"
                  ? "جارٍ الحذف…"
                  : "Deleting…"
                : locale === "ar"
                ? "حذف"
                : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AccountLedgerSheet
        account={ledgerAccount}
        onClose={() => setLedgerAccount(null)}
        labels={{
          title: t.ledgerTitle,
          description: t.ledgerDesc,
          date: t.ledgerDate,
          memo: t.ledgerMemo,
          debit: t.ledgerDebit,
          credit: t.ledgerCredit,
          je: t.ledgerJE,
          empty: t.ledgerEmpty,
          emptyHint: t.ledgerEmptyHint,
          emptyPeriodRange: t.ledgerEmptyPeriodRange,
          emptyPeriodHint: t.ledgerEmptyPeriodHint,
          emptyPeriodSwitchYtd: t.ledgerEmptyPeriodSwitchYtd,
          jumpPast: t.ledgerJumpPast,
          jumpFuture: t.ledgerJumpFuture,
          jeAria: t.ledgerJEAria,
          totalDebit: t.ledgerTotalDebit,
          totalCredit: t.ledgerTotalCredit,
          balance: t.ledgerBalance,
          opening: t.ledgerOpening,
          closing: t.ledgerClosing,
          download: t.ledgerDownload,
          downloadAria: t.ledgerDownloadAria,
          csvFilenamePrefix: t.ledgerCsvFilenamePrefix,
        }}
      />
    </div>
  )
}

function countNodes(nodes: TreeNode[]): number {
  let n = 0
  for (const node of nodes) {
    n += 1 + countNodes(node.children)
  }
  return n
}

interface BreakdownLabels {
  debit: string
  credit: string
  net: string
  aria: string
}

interface TreeRowProps {
  node: TreeNode
  depth: number
  locale: string
  isExpanded: (code: string) => boolean
  onToggle: (code: string) => void
  onOpenLedger: (account: Account) => void
  openLedgerAria: string
  balanceByAccountId: Map<number, BalanceBreakdown>
  balancesLoading: boolean
  balancesError: boolean
  formatMoney: (n: number | string | null | undefined) => string
  balanceAria: string
  breakdownLabels: BreakdownLabels
  // Delete affordance — wired only for users who can write (owner/accountant).
  // Read-only viewers receive `canDelete=false` and never see the trash icon.
  // The handler opens the confirm dialog at the page level; the actual
  // network call lives in `deleteMutation` so the dialog can show "Deleting…"
  // state without each row tracking its own pending flag.
  canDelete: boolean
  onDelete: (account: Account) => void
}

function TreeRow({
  node,
  depth,
  locale,
  isExpanded,
  onToggle,
  onOpenLedger,
  openLedgerAria,
  balanceByAccountId,
  balancesLoading,
  balancesError,
  formatMoney,
  balanceAria,
  breakdownLabels,
  canDelete,
  onDelete,
}: TreeRowProps) {
  const { account } = node
  const hasChildren = node.children.length > 0
  const expanded = hasChildren && isExpanded(account.code)
  // RTL-aware caret: when collapsed, point in the natural reading direction
  // ("forward" — right in LTR, left in RTL); when expanded, point down.
  const Caret = expanded ? ChevronDown : locale === "ar" ? ChevronLeft : ChevronRight

  // Indent by depth using logical inline-start so RTL mirrors automatically.
  // Base is 1.25rem (matches the previous flat layout) plus 1rem per level.
  const inlineStart = `${1.25 + depth * 1}rem`

  // Header rows are organisational containers and never get postings, so we
  // suppress the ledger affordance on them. Postable accounts open the
  // ledger drawer on click.
  const openable = !account.isHeader

  // Trailing balance: leaves show their own posted balance; headers show the
  // sum of every descendant leaf in their subtree (rolled up by the parent).
  // A leaf with no postings still has a current balance — zero — so we render
  // the formatted zero rather than blanking the cell, matching the trial
  // balance view. Header rows render the rolled-up total with a muted weight
  // so they read as totals rather than primary values.
  const breakdown =
    balanceByAccountId.get(account.id) ?? { debit: 0, credit: 0, balance: 0 }
  const balance = breakdown.balance

  return (
    <>
      <li
        className={cn(
          "px-5 py-2.5 flex items-center gap-3 text-sm",
          account.isHeader
            ? "bg-muted/30 font-medium"
            : "hover:bg-muted/30 transition-colors group"
        )}
        style={{ paddingInlineStart: inlineStart }}
        data-testid={`row-account-${account.code}`}
        data-depth={depth}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(account.code)}
            aria-expanded={expanded}
            aria-label={
              locale === "ar"
                ? expanded
                  ? "طيّ الفرع"
                  : "فتح الفرع"
                : expanded
                ? "Collapse"
                : "Expand"
            }
            className={cn(
              "shrink-0 inline-flex items-center justify-center w-5 h-5 -m-0.5 rounded",
              "text-muted-foreground hover:text-foreground hover:bg-muted",
              "transition-colors"
            )}
            data-testid={`toggle-account-${account.code}`}
          >
            <Caret className="w-4 h-4" />
          </button>
        ) : (
          <span aria-hidden className="shrink-0 inline-block w-5 h-5" />
        )}

        {openable ? (
          <button
            type="button"
            onClick={() => onOpenLedger(account)}
            className={cn(
              "flex items-center gap-3 min-w-0 flex-1 text-start rounded-sm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            )}
            aria-label={`${openLedgerAria} — ${account.code} ${account.nameAr}`}
            data-testid={`button-open-ledger-${account.code}`}
          >
            <span className="font-numeric text-[11px] text-muted-foreground tabular-nums w-12 shrink-0">
              {account.code}
            </span>
            <span className="truncate text-foreground">{account.nameAr}</span>
            <BookOpen
              className="w-3.5 h-3.5 text-muted-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              aria-hidden
            />
          </button>
        ) : (
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="font-numeric text-[11px] text-muted-foreground tabular-nums w-12 shrink-0">
              {account.code}
            </span>
            <span className="truncate text-foreground">{account.nameAr}</span>
          </div>
        )}
        <span className="text-[11px] text-muted-foreground hidden sm:block truncate max-w-[30%]">
          {account.nameEn}
        </span>
        {/*
          Delete button — shown only for leaf accounts (no children) and only
          when the viewer has write access. Header rows (`isHeader`) are
          structural roll-up rows in the seeded chart; deleting them would
          orphan their entire subtree and make periodic reports unreadable,
          so we hide the affordance there. The button stays at zero opacity
          until the row is hovered/focused so the long balance line remains
          uncluttered for daily browsing.
        */}
        {canDelete && !account.isHeader && !hasChildren && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(account)
            }}
            className={cn(
              "shrink-0 inline-flex items-center justify-center w-6 h-6 rounded",
              "text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10",
              "opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            )}
            aria-label={
              locale === "ar"
                ? `حذف الحساب ${account.code} ${account.nameAr}`
                : `Delete account ${account.code} ${account.nameAr}`
            }
            data-testid={`button-delete-account-${account.code}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
        {balancesLoading ? (
          <Skeleton
            className="h-4 w-20 ms-auto shrink-0"
            data-testid={`skeleton-balance-${account.code}`}
          />
        ) : balancesError ? (
          // If the balances request failed, surface a single muted "·" rather
          // than rendering "0" / "—" — those would silently look like a real
          // computed balance and mislead the owner about what's in the bucket.
          <span
            className="ms-auto shrink-0 text-muted-foreground/60 text-[12.5px]"
            data-testid={`text-balance-${account.code}-error`}
            title={
              locale === "ar"
                ? "تعذّر تحميل الأرصدة"
                : "Could not load balances"
            }
          >
            ·
          </span>
        ) : (
          // The trailing balance doubles as a hover/touch trigger for the
          // period's debit/credit/net breakdown. Tooltip handles desktop
          // hover + keyboard focus; Popover handles touch & click. Sharing
          // a single <button> trigger via `asChild` keeps both surfaces in
          // sync without rendering extra DOM. Test IDs are preserved so
          // existing balance assertions keep working.
          <Tooltip delayDuration={150}>
            <Popover>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "ms-auto shrink-0 font-numeric tabular-nums text-[12.5px]",
                      "rounded-sm cursor-default",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                      account.isHeader
                        ? "text-muted-foreground font-normal"
                        : "text-foreground"
                    )}
                    aria-label={`${balanceAria} — ${formatMoney(balance)}. ${breakdownLabels.debit}: ${formatMoney(breakdown.debit)}. ${breakdownLabels.credit}: ${formatMoney(breakdown.credit)}.`}
                    data-testid={`text-balance-${account.code}`}
                  >
                    {formatMoney(balance)}
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="end"
                className="p-0"
                data-testid={`tooltip-balance-${account.code}`}
              >
                <BalanceBreakdownContent
                  breakdown={breakdown}
                  labels={breakdownLabels}
                  formatMoney={formatMoney}
                  accountCode={account.code}
                />
              </TooltipContent>
              <PopoverContent
                side="top"
                align="end"
                className="w-auto p-2.5"
                data-testid={`popover-balance-${account.code}`}
              >
                <BalanceBreakdownContent
                  breakdown={breakdown}
                  labels={breakdownLabels}
                  formatMoney={formatMoney}
                  accountCode={account.code}
                />
              </PopoverContent>
            </Popover>
          </Tooltip>
        )}
      </li>
      {expanded &&
        node.children.map((child) => (
          <TreeRow
            key={child.account.id}
            node={child}
            depth={depth + 1}
            locale={locale}
            isExpanded={isExpanded}
            onToggle={onToggle}
            onOpenLedger={onOpenLedger}
            openLedgerAria={openLedgerAria}
            balanceByAccountId={balanceByAccountId}
            balancesLoading={balancesLoading}
            balancesError={balancesError}
            formatMoney={formatMoney}
            balanceAria={balanceAria}
            breakdownLabels={breakdownLabels}
            canDelete={canDelete}
            onDelete={onDelete}
          />
        ))}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* BalanceBreakdownContent                                             */
/* Shared body of the trailing-balance hover tooltip and click/touch   */
/* popover. Renders the period's debit, credit, and net side-by-side   */
/* using the same numeric font + tabular numerals as the row itself,   */
/* so the two figures line up visually whether the surface is open or  */
/* not. Layout uses logical (start/end) alignment so the breakdown     */
/* mirrors automatically in RTL.                                        */
/* ------------------------------------------------------------------ */
interface BalanceBreakdownContentProps {
  breakdown: BalanceBreakdown
  labels: BreakdownLabels
  formatMoney: (n: number | string | null | undefined) => string
  accountCode: string
}

function BalanceBreakdownContent({
  breakdown,
  labels,
  formatMoney,
  accountCode,
}: BalanceBreakdownContentProps) {
  return (
    <div
      className="font-numeric tabular-nums text-xs min-w-[10rem]"
      role="group"
      aria-label={labels.aria}
    >
      <div className="flex items-baseline justify-between gap-6 px-2 py-1">
        <span className="text-popover-foreground/70">{labels.debit}</span>
        <span
          className="text-popover-foreground"
          data-testid={`text-balance-breakdown-debit-${accountCode}`}
        >
          {formatMoney(breakdown.debit)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-6 px-2 py-1">
        <span className="text-popover-foreground/70">{labels.credit}</span>
        <span
          className="text-popover-foreground"
          data-testid={`text-balance-breakdown-credit-${accountCode}`}
        >
          {formatMoney(breakdown.credit)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-6 px-2 py-1 mt-0.5 border-t border-border/60">
        <span className="text-popover-foreground/70 font-medium">
          {labels.net}
        </span>
        <span
          className="text-popover-foreground font-medium"
          data-testid={`text-balance-breakdown-net-${accountCode}`}
        >
          {formatMoney(breakdown.balance)}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Account ledger drawer                                               */
/* Mirror of task #105: just like JE → originating event, ledger rows  */
/* now expose a one-click jump back to /app/journal#je-<id>. The JE    */
/* page reads the hash, scrolls into view, and pulses a highlight.     */
/* ------------------------------------------------------------------ */
interface AccountLedgerSheetLabels {
  title: string
  description: string
  date: string
  memo: string
  debit: string
  credit: string
  je: string
  empty: string
  emptyHint: string
  // Template containing `{start}` and `{end}` placeholders that the sheet
  // fills in with locale-formatted dates from the active period range.
  emptyPeriodRange: string
  emptyPeriodHint: string
  emptyPeriodSwitchYtd: string
  /** Localised "Jump to latest earlier posting (<date>)" — receives the
      formatted nearest-posting date so the button can name it explicitly. */
  jumpPast: (date: string) => string
  /** Localised "Jump to nearest upcoming posting (<date>)" — same shape
      as `jumpPast` but for postings dated after the current period. */
  jumpFuture: (date: string) => string
  jeAria: string
  totalDebit: string
  totalCredit: string
  balance: string
  opening: string
  closing: string
  download: string
  downloadAria: string
  // Localized prefix for the exported CSV filename (e.g. "ledger" or
  // "حركة-حساب"). The full name is built as `<prefix>-<code>-<timestamp>.csv`
  // so finance users can keep multiple exports straight in their downloads
  // folder without renaming each one.
  csvFilenamePrefix: string
}

interface AccountLedgerSheetProps {
  account: Account | null
  onClose: () => void
  labels: AccountLedgerSheetLabels
}

interface LedgerPosting {
  jeId: number
  reference: string
  entryDate: string
  description: string | null
  lineMemo: string | null
  debit: number
  credit: number
  // Stable position of the line within its JE — used as the chronological
  // tie-breaker when several lines on the same entry post to this account.
  lineIndex: number
  // Running balance after this posting, signed per the account's normal side
  // (asset/expense → debit-normal; liability/equity/revenue → credit-normal).
  balance: number
}

function AccountLedgerSheet({ account, onClose, labels }: AccountLedgerSheetProps) {
  const { locale } = useLocale()
  const fmt = useFormatMoney()
  const dfLocale = locale === "ar" ? ar : enUS
  const { period, setPeriodKey, setPeriodToInclude } = usePeriod()

  // Reuse the journal-entries cache so flipping between this drawer and the
  // /app/journal page is instantaneous. Only fetch when the drawer opens to
  // avoid a needless round-trip on the first COA visit.
  const { data: entries, isLoading } = useQuery<LedgerJE[]>({
    queryKey: ["/api/journal-entries"],
    enabled: !!account,
  })

  // The running-balance column needs to know which side of the ledger this
  // account "lives" on. Mirrors the trial-balance endpoint in
  // server/routes.ts (~line 487): asset/expense are debit-normal, the
  // rest are credit-normal. Both sides delegate to the same helper in
  // chart-of-accounts-ledger.ts so the rule (and the dedicated unit test
  // around it) can't silently drift between the drawer and the report.
  const isDebitNormal = account
    ? isDebitNormalAccountType(account.type as LedgerAccountType)
    : false

  // Full history for the account, regardless of period. Two reasons to keep
  // it around:
  //   1. The "no postings ever" vs "no postings in this period" empty
  //      states need to know whether the account has any history at all.
  //   2. The running balance is accumulated chronologically from t=0, so a
  //      period-filtered row still shows the same balance it would on the
  //      full ledger — and the opening balance for the filtered window can
  //      be read off the postings immediately before period.start.
  const allPostings = useMemo<LedgerPosting[]>(() => {
    if (!account || !entries) return []
    const raw: Array<Omit<LedgerPosting, "balance">> = []
    for (const je of entries) {
      let lineIndex = 0
      for (const l of je.lines) {
        if (l.accountId !== account.id) {
          lineIndex++
          continue
        }
        const debit = Number(l.debit ?? 0)
        const credit = Number(l.credit ?? 0)
        if (debit === 0 && credit === 0) {
          lineIndex++
          continue
        }
        raw.push({
          jeId: je.id,
          reference: je.reference,
          entryDate: je.entryDate,
          description: je.description,
          lineMemo: l.description ?? null,
          debit,
          credit,
          lineIndex,
        })
        lineIndex++
      }
    }
    // Sign convention + oldest-first accumulation + newest-first display
    // order all live in the helper — keep the page free of arithmetic so
    // the trial-balance route stays the only other place that signs a
    // running total.
    return computeLedgerRunningBalances(raw, account.type as LedgerAccountType)
  }, [account, entries])

  // Apply the global period filter. Compare on millisecond timestamps so a
  // posting on the very last day of the range (e.g. end-of-month) is included.
  const postings = useMemo<LedgerPosting[]>(() => {
    const startMs = period.start.getTime()
    const endMs = period.end.getTime()
    return allPostings.filter((p) => {
      const ms = new Date(p.entryDate).getTime()
      return ms >= startMs && ms <= endMs
    })
  }, [allPostings, period.start, period.end])

  const totalDebit = postings.reduce((s, r) => s + r.debit, 0)
  const totalCredit = postings.reduce((s, r) => s + r.credit, 0)
  // Opening balance for the active period — sum of signed contributions of
  // every posting in the full history that occurred *before* period.start.
  // For an unbounded view this collapses to 0; for a narrow window it
  // reflects "where the account stood before any of the displayed rows."
  const openingBalance = useMemo(() => {
    const startMs = period.start.getTime()
    let bal = 0
    for (const p of allPostings) {
      const ms = new Date(p.entryDate).getTime()
      if (ms < startMs) {
        bal += isDebitNormal ? p.debit - p.credit : p.credit - p.debit
      }
    }
    return bal
  }, [allPostings, period.start, isDebitNormal])
  // Closing balance is the running balance after the most recent posting in
  // the filtered window. Each row's `balance` was accumulated chronologically
  // from t=0, so postings[0] (newest in the window) already includes all
  // history up to and including itself — exactly the closing balance we want.
  const closingBalance =
    postings.length > 0
      ? postings[0].balance
      : openingBalance
  // When the account has history but none of it falls inside the active
  // period, we want a different message than "no postings ever".
  const hasAnyHistory = allPostings.length > 0

  // Trigger a CSV download of the visible postings (same columns and
  // newest-first order as the on-screen table, plus the opening/closing
  // subtotal block). Format details — RFC-4180 quoting, BOM, ISO dates,
  // bare numeric cells — live in `chart-of-accounts-ledger-csv.ts` so
  // they can be unit-tested without spinning up the drawer.
  const handleDownloadCsv = () => {
    if (!account || postings.length === 0) return
    const csv = buildLedgerCsv(
      postings,
      { openingBalance, closingBalance, totalDebit, totalCredit },
      {
        date: labels.date,
        memo: labels.memo,
        debit: labels.debit,
        credit: labels.credit,
        balance: labels.balance,
        je: labels.je,
        opening: labels.opening,
        closing: labels.closing,
      },
    )
    const filename = buildLedgerCsvFilename(
      labels.csvFilenamePrefix,
      account.code,
      new Date(),
    )
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // For the period-empty state, surface a one-click "jump to nearest
  // posting" affordance so users don't have to guess which window will
  // surface activity. Closest is measured as absolute ms distance from
  // either period boundary — so for a posting before the window we
  // measure to `period.start`, and for one after we measure to
  // `period.end`. Returning the side ("past"/"future") lets the button
  // copy itself reflect the direction of the jump.
  const nearestPosting = useMemo(() => {
    if (!hasAnyHistory) return null
    const startMs = period.start.getTime()
    const endMs = period.end.getTime()
    let best: { date: Date; side: "past" | "future"; distance: number } | null = null
    for (const p of allPostings) {
      const ms = new Date(p.entryDate).getTime()
      if (ms >= startMs && ms <= endMs) continue // shouldn't happen — we're in the empty state
      const side: "past" | "future" = ms < startMs ? "past" : "future"
      const distance = side === "past" ? startMs - ms : ms - endMs
      if (!best || distance < best.distance) {
        best = { date: new Date(p.entryDate), side, distance }
      }
    }
    return best
  }, [allPostings, hasAnyHistory, period.start, period.end])

  return (
    <Sheet open={!!account} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side={locale === "ar" ? "left" : "right"}
        className="w-full sm:max-w-2xl overflow-y-auto"
        data-testid="sheet-account-ledger"
      >
        <SheetHeader className="text-start">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <SheetTitle className="flex items-center gap-2.5">
                <BookOpen className="w-4 h-4 text-muted-foreground" aria-hidden />
                <span>{labels.title}</span>
              </SheetTitle>
              <SheetDescription>{labels.description}</SheetDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Mirrors other surfaces (reports, insights) — keeping the chip
                  inline lets users re-scope the ledger without leaving the drawer. */}
              <PeriodChip showCompare={false} className="shrink-0" />
              {/* Disabled until there's something to export — exporting an
                  empty window would just produce header-only noise. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadCsv}
                disabled={postings.length === 0}
                aria-label={labels.downloadAria}
                title={labels.downloadAria}
                className="gap-2 shrink-0"
                data-testid="button-ledger-download-csv"
              >
                <Download className="w-4 h-4" aria-hidden />
                <span>{labels.download}</span>
              </Button>
            </div>
          </div>
        </SheetHeader>

        {account && (
          <div className="mt-4 rounded-md border border-border bg-muted/30 px-4 py-3">
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <span className="font-numeric text-xs text-muted-foreground tabular-nums">
                {account.code}
              </span>
              <span className="text-sm font-medium text-foreground" data-testid="text-ledger-account-name">
                {account.nameAr}
              </span>
              <span className="text-xs text-muted-foreground">{account.nameEn}</span>
            </div>
          </div>
        )}

        <div className="mt-4">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : postings.length === 0 ? (
            <div
              className="rounded-md border border-dashed border-border px-4 py-8 text-center"
              data-testid={hasAnyHistory ? "empty-account-ledger-period" : "empty-account-ledger"}
            >
              {hasAnyHistory ? (
                <>
                  {/* Spell out the active window so users immediately see
                      *which* period they're looking through, mirroring the
                      chip's start/end formatting (short month + day, year on
                      the end). Splice the formatted dates into the localized
                      template so RTL/LTR phrasing stays natural. */}
                  <p
                    className="text-sm font-medium text-foreground"
                    data-testid="text-ledger-empty-period-range"
                  >
                    {labels.emptyPeriodRange
                      .replace(
                        "{start}",
                        period.start.toLocaleDateString(
                          locale === "ar" ? "ar-SA" : "en-US",
                          { month: "short", day: "numeric" },
                        ),
                      )
                      .replace(
                        "{end}",
                        period.end.toLocaleDateString(
                          locale === "ar" ? "ar-SA" : "en-US",
                          { month: "short", day: "numeric", year: "numeric" },
                        ),
                      )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {labels.emptyPeriodHint}
                  </p>
                  {/* When the window is already YTD there's nothing to
                      broaden to — suppress the shortcut to avoid a no-op
                      action that would just reselect the current key. */}
                  {period.key !== "ytd" && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() => setPeriodKey("ytd")}
                      className="mt-2 h-auto p-0 text-xs"
                      data-testid="button-ledger-empty-switch-ytd"
                    >
                      {labels.emptyPeriodSwitchYtd}
                    </Button>
                  )}
                  {/* Jump-to-nearest is the more direct "snap to a window
                      that actually contains a posting" affordance — kept
                      alongside the YTD shortcut because the two solve
                      different problems: YTD broadens the window, while
                      jump-to-nearest hops to a date the YTD window may
                      still miss (e.g. postings >1 year away). Only renders
                      when nearestPosting resolved to a real out-of-window
                      posting. */}
                  {nearestPosting && (
                    <div className="mt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPeriodToInclude(nearestPosting.date)}
                        data-testid="button-ledger-jump-nearest"
                      >
                        {nearestPosting.side === "past"
                          ? labels.jumpPast(format(nearestPosting.date, "d MMM yyyy", { locale: dfLocale }))
                          : labels.jumpFuture(format(nearestPosting.date, "d MMM yyyy", { locale: dfLocale }))}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-foreground">
                    {labels.empty}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {labels.emptyHint}
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto table-sticky-first">
              <table className="w-full text-sm" data-testid="table-account-ledger">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/30">
                  <tr>
                    <th className="text-start px-3 py-2 font-medium">{labels.date}</th>
                    <th className="text-start px-3 py-2 font-medium">{labels.memo}</th>
                    <th className="text-end px-3 py-2 font-medium w-24">{labels.debit}</th>
                    <th className="text-end px-3 py-2 font-medium w-24">{labels.credit}</th>
                    {/* Running balance hides on narrow viewports — the drawer
                        gets cramped on phones and the per-row balance is the
                        most expendable column there. */}
                    <th className="hidden md:table-cell text-end px-3 py-2 font-medium w-28">
                      {labels.balance}
                    </th>
                    <th className="text-end px-3 py-2 font-medium w-20">{labels.je}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {postings.map((p, i) => (
                    <tr key={`${p.jeId}-${p.lineIndex}-${i}`} data-testid={`row-ledger-${p.jeId}-${i}`}>
                      <td className="px-3 py-2 text-foreground font-numeric tabular-nums whitespace-nowrap">
                        {format(new Date(p.entryDate), "d MMM yyyy", { locale: dfLocale })}
                      </td>
                      <td className="px-3 py-2 text-foreground">
                        <div className="truncate max-w-[18rem]">
                          {p.lineMemo || p.description || "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-end font-numeric tabular-nums text-foreground">
                        {p.debit > 0 ? fmt(p.debit) : ""}
                      </td>
                      <td className="px-3 py-2 text-end font-numeric tabular-nums text-foreground">
                        {p.credit > 0 ? fmt(p.credit) : ""}
                      </td>
                      <td
                        className="hidden md:table-cell px-3 py-2 text-end font-numeric tabular-nums text-foreground whitespace-nowrap"
                        data-testid={`text-ledger-running-balance-${p.jeId}-${i}`}
                      >
                        {fmt(p.balance)}
                      </td>
                      <td className="px-3 py-2 text-end">
                        <JournalEntryRefLink
                          id={p.jeId}
                          className="font-numeric tabular-nums text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none rounded-sm"
                          data-testid={`link-ledger-je-${p.jeId}`}
                          title={`${labels.jeAria} ${p.reference}`}
                          ariaLabel={`${labels.jeAria} ${p.reference}`}
                          onLiveClick={() => onClose()}
                        >
                          {p.reference || `JE #${p.jeId}`}
                        </JournalEntryRefLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/*
                  Subtotal block. Two narrow rows make the math at a glance:
                    • Opening balance — what the account stood at before any
                      of the displayed postings (always 0 for the all-time
                      view; surfaced explicitly so the column reads cleanly).
                    • Closing balance — the running balance after the most
                      recent posting, plus the column totals on the side.
                */}
                <tfoot className="bg-muted/40 text-xs">
                  <tr data-testid="row-ledger-opening">
                    <td
                      className="px-3 py-2 text-muted-foreground font-medium"
                      colSpan={4}
                    >
                      {labels.opening}
                    </td>
                    <td
                      className="hidden md:table-cell px-3 py-2 text-end font-numeric tabular-nums text-foreground"
                      data-testid="text-ledger-opening-balance"
                    >
                      {fmt(openingBalance)}
                    </td>
                    <td />
                  </tr>
                  <tr data-testid="row-ledger-closing">
                    <td className="px-3 py-2 text-muted-foreground font-medium">
                      {labels.closing}
                    </td>
                    <td className="px-3 py-2" />
                    <td
                      className="px-3 py-2 text-end font-numeric tabular-nums text-foreground"
                      data-testid="text-ledger-total-debit"
                    >
                      {fmt(totalDebit)}
                    </td>
                    <td
                      className="px-3 py-2 text-end font-numeric tabular-nums text-foreground"
                      data-testid="text-ledger-total-credit"
                    >
                      {fmt(totalCredit)}
                    </td>
                    <td
                      className="hidden md:table-cell px-3 py-2 text-end font-numeric tabular-nums font-medium text-foreground"
                      data-testid="text-ledger-balance"
                    >
                      {fmt(closingBalance)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
