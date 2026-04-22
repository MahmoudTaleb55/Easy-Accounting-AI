import { useMemo, useState } from "react"
import { useQuery, useMutation } from "@tanstack/react-query"
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
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Plus, Search } from "lucide-react"
import type { Account } from "@shared/schema"
import { useLocale } from "@/contexts/locale-context"
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

export default function ChartOfAccountsPage() {
  const { locale } = useLocale()
  const { toast } = useToast()
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

  const grouped = useMemo(() => {
    if (!accounts) return {} as Record<AccountType, Account[]>
    const filt = accounts.filter(
      (a) =>
        !search ||
        a.code.includes(search) ||
        a.nameAr.includes(search) ||
        a.nameEn.toLowerCase().includes(search.toLowerCase())
    )
    return filt.reduce<Record<string, Account[]>>((acc, a) => {
      ;(acc[a.type] ||= []).push(a)
      return acc
    }, {}) as Record<AccountType, Account[]>
  }, [accounts, search])

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
            <DialogTrigger asChild>
              <Button data-testid="button-add-account">
                <Plus className="w-4 h-4" /> {t.add}
              </Button>
            </DialogTrigger>
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
      {isLoading ? (
        <CardGridSkeleton count={4} cols={2} height="h-56" />
      ) : TYPE_ORDER.filter((tt) => grouped[tt]?.length).length === 0 ? (
        <EmptyState
          title={t.empty}
          description={
            locale === "ar"
              ? "ابدأ بإضافة حساب أو استورد دليلاً جاهزاً متوافقاً مع IFRS."
              : "Add an account to begin, or import an IFRS-ready chart."
          }
          testId="empty-coa"
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {TYPE_ORDER.filter((tt) => grouped[tt]?.length).map((type) => (
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
                  {grouped[type].length}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {grouped[type].map((a) => (
                  <li
                    key={a.id}
                    className={cn(
                      "px-5 py-2.5 flex items-center justify-between gap-3 text-sm",
                      a.isHeader ? "bg-muted/30 font-medium" : "hover:bg-muted/30 transition-colors"
                    )}
                    style={{ paddingInlineStart: a.isHeader ? "1.25rem" : "2rem" }}
                    data-testid={`row-account-${a.code}`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="font-numeric text-[11px] text-muted-foreground tabular-nums w-12 shrink-0">
                        {a.code}
                      </span>
                      <span className="truncate text-foreground">{a.nameAr}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground hidden sm:block truncate max-w-[40%]">
                      {a.nameEn}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
