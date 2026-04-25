import { useEffect, useMemo, useState } from "react"
import { useQuery, useMutation } from "@tanstack/react-query"
import { apiRequest, queryClient } from "@/lib/queryClient"
import { useToast } from "@/hooks/use-toast"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
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
import { WriteGuard, useCanWrite } from "@/components/auth/write-guard"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Search, Sparkles } from "lucide-react"
import type { Account } from "@shared/schema"
import { useLocale } from "@/contexts/locale-context"
import { useAuth } from "@/hooks/use-auth"
import { cn } from "@/lib/utils"

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

export default function ChartOfAccountsPage() {
  const { locale } = useLocale()
  const { toast } = useToast()
  const { activeCompanyId } = useAuth()
  const canWrite = useCanWrite()
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)
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
    }),
    [locale]
  )

  const { data: accounts, isLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
  })

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

        <div className="flex items-center gap-2">
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
                  />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
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

interface TreeRowProps {
  node: TreeNode
  depth: number
  locale: string
  isExpanded: (code: string) => boolean
  onToggle: (code: string) => void
}

function TreeRow({ node, depth, locale, isExpanded, onToggle }: TreeRowProps) {
  const { account } = node
  const hasChildren = node.children.length > 0
  const expanded = hasChildren && isExpanded(account.code)
  // RTL-aware caret: when collapsed, point in the natural reading direction
  // ("forward" — right in LTR, left in RTL); when expanded, point down.
  const Caret = expanded ? ChevronDown : locale === "ar" ? ChevronLeft : ChevronRight

  // Indent by depth using logical inline-start so RTL mirrors automatically.
  // Base is 1.25rem (matches the previous flat layout) plus 1rem per level.
  const inlineStart = `${1.25 + depth * 1}rem`

  return (
    <>
      <li
        className={cn(
          "px-5 py-2.5 flex items-center gap-3 text-sm",
          account.isHeader ? "bg-muted/30 font-medium" : "hover:bg-muted/30 transition-colors"
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

        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="font-numeric text-[11px] text-muted-foreground tabular-nums w-12 shrink-0">
            {account.code}
          </span>
          <span className="truncate text-foreground">{account.nameAr}</span>
        </div>
        <span className="text-[11px] text-muted-foreground hidden sm:block truncate max-w-[40%]">
          {account.nameEn}
        </span>
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
          />
        ))}
    </>
  )
}
