import { useEffect, useMemo, useState } from "react";
import { JournalEntryRefLink } from "@/components/journal/journal-entry-ref-link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, invalidateAccountBalances, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/company-context";
import { useFormatMoney } from "@/lib/format";
import { useT, type StringKey } from "@/i18n/dict";
import { useLocale } from "@/contexts/locale-context";
import { mapErrorKey } from "@/lib/error-messages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
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
} from "@/components/ui/alert-dialog";
import { WriteGuard, OwnerGuard, useCanManageWorkspace } from "@/components/auth/write-guard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Plus, Trash2, Calculator, ArrowDownCircle, RefreshCw, Truck, AlertCircle } from "lucide-react";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { HistoryTimeline } from "@/components/audit/history-drawer";
import { PeriodChip } from "@/components/dashboard/period-chip";
import { usePeriod } from "@/contexts/period-context";
import type { Account, AssetCategory, AssetComponent, Company, FixedAsset, FxRate, DepreciationMethod } from "@shared/schema";

const METHODS: Array<{ value: DepreciationMethod; labelKey: StringKey }> = [
  { value: "straight_line", labelKey: "asset_m_straight" },
  { value: "declining_balance", labelKey: "asset_m_declining" },
  { value: "double_declining", labelKey: "asset_m_double_declining" },
  { value: "syd", labelKey: "asset_m_syd" },
  { value: "units_of_production", labelKey: "asset_m_units" },
  { value: "custom", labelKey: "asset_m_custom" },
];

const STATUS_LABEL: Record<string, StringKey> = {
  active: "asset_st_active",
  disposed: "asset_st_disposed",
  fully_depreciated: "asset_st_fully_dep",
};

type FixedAssetWithCarrying = FixedAsset & { carryingAmount: number };

interface AssetDetail extends FixedAssetWithCarrying {
  components: AssetComponent[];
  schedule: ScheduleRow[];
  impairments: ImpairmentEvent[];
  revaluations: RevaluationEvent[];
  disposals: DisposalEvent[];
  depreciations: DepreciationPostingRow[];
}

interface DepreciationPostingRow { runId: number; year: number; month: number; amount: number; journalEntryId: number | null }

interface ScheduleRow {
  id: number;
  periodYear: number;
  periodMonth: number;
  plannedAmount: string;
  status: string;
}
type AssetEventKind = "impairment" | "revaluation" | "disposal";

interface ImpairmentEvent { id: number; eventDate: string; recoverableAmount: string; lossAmount: string; journalEntryId: number | null; notes?: string; createdAt?: string | null }
interface RevaluationEvent { id: number; eventDate: string; fairValue: string; method: string; surplusDelta: string; plImpact: string; journalEntryId: number | null; notes?: string; createdAt?: string | null }
interface DisposalEvent { id: number; eventDate: string; proceeds: string; method: string; gainLoss: string; surplusTransferred: string; journalEntryId: number | null; notes?: string; createdAt?: string | null }

interface DepreciationRunListItem {
  id: number;
  companyId: number;
  year: number;
  month: number;
  status: string;
  totalAmount: string;
  journalEntryId: number | null;
}

interface ImpairmentPreview { carrying: number; recoverableAmount: number; amount: number; isReversal: boolean; hypotheticalCarrying: number; reversalCap: number; newCarrying: number }
interface RevaluationPreview {
  result: { newGrossCost: number; newAccumDep: number; newAccumImp: number; surplusDelta: number; plImpact: number; priorLossReversal: number };
  current: { cost: number; accumDep: number; accumImp: number; surplus: number; priorPLLoss: number };
}
interface DisposalPreview { result: { gainLoss: number; surplusTransferred: number }; carrying: number }
interface DepreciationPreview {
  postings: Array<{ assetId: number; componentId?: number | null; amount: number; categoryId: number; assetName: string }>;
  total: number;
  byCategory: Array<{ categoryId: number; categoryName: string; amount: number }>;
  needsUsage: Array<{ assetId: number; componentId: number | null; assetName: string; method: string }>;
}

interface UsageEntry { assetId: number; componentId: number | null; units: number }

function useAssetMoneyFmt() {
  const fmtMoney = useFormatMoney();
  return (n: number | string | null | undefined, withSymbol: unknown = "") =>
    fmtMoney(n, { decimals: 2, symbol: Boolean(withSymbol) });
}

export default function FixedAssetsPage() {
  const t = useT();
  const { activeCompany } = useCompany();
  const canManage = useCanManageWorkspace();
  // Controlled tabs so JE source-link badges can deep-link to a specific
  // sub-section of this page: `#dr-<id>` opens the depreciation runs tab,
  // `#asset-<id>` opens the register so AssetRegister can pop the detail
  // dialog for the originating asset.
  const [tab, setTab] = useState<string>(() => initialFaTabFromHash());

  useEffect(() => {
    const sync = () => setTab((cur) => mapHashToFaTab(window.location.hash, cur));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return (
    <div className="space-y-8" data-testid="page-fixed-assets">
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-2 max-w-2xl">
          <div className="eyebrow text-muted-foreground/80">{t("asset_eyebrow")}</div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {t("asset_page_title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {t("asset_page_sub")}
          </p>
        </div>
        <PeriodChip />
      </header>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className={`grid ${canManage ? "grid-cols-5" : "grid-cols-3"} w-full`}>
          <TabsTrigger value="register" data-testid="tab-register">{t("asset_tab_register")}</TabsTrigger>
          <TabsTrigger value="depreciation" data-testid="tab-depreciation">{t("asset_tab_depreciation")}</TabsTrigger>
          <TabsTrigger value="categories" data-testid="tab-categories">{t("asset_tab_categories")}</TabsTrigger>
          {canManage && <TabsTrigger value="companies" data-testid="tab-companies">{t("asset_tab_companies")}</TabsTrigger>}
          {canManage && <TabsTrigger value="fx" data-testid="tab-fx">{t("asset_tab_fx")}</TabsTrigger>}
        </TabsList>

        <TabsContent value="register" className="mt-6">
          {activeCompany ? <AssetRegister company={activeCompany} /> : <Skeleton className="h-40" />}
        </TabsContent>
        <TabsContent value="depreciation" className="mt-6">
          {activeCompany ? <DepreciationPanel company={activeCompany} /> : <Skeleton className="h-40" />}
        </TabsContent>
        <TabsContent value="categories" className="mt-6">
          {activeCompany ? <CategoriesPanel company={activeCompany} /> : <Skeleton className="h-40" />}
        </TabsContent>
        {canManage && (
          <TabsContent value="companies" className="mt-6">
            <CompaniesPanel />
          </TabsContent>
        )}
        {canManage && (
          <TabsContent value="fx" className="mt-6">
            {activeCompany ? <FxPanel company={activeCompany} /> : <Skeleton className="h-40" />}
          </TabsContent>
        )}
      </Tabs>

      {!canManage && (
        <EmptyState
          icon={<Building2 className="w-5 h-5" />}
          title={t("asset_owner_only_title")}
          description={t("asset_owner_only_desc")}
          testId="empty-owner-only-fa-companies-fx"
        />
      )}
    </div>
  );
}

function initialFaTabFromHash(): string {
  if (typeof window === "undefined") return "register";
  return mapHashToFaTab(window.location.hash, "register");
}

function mapHashToFaTab(hash: string, fallback: string): string {
  // Deep-link from JE source-link badges:
  //   `#dr-<id>`     → Depreciation tab (highlight matching run row)
  //   `#asset-<id>`  → Register tab (open AssetDetailDialog)
  if (/^#dr-\d+$/.test(hash)) return "depreciation";
  if (/^#asset-\d+$/.test(hash)) return "register";
  return fallback;
}

// ============================================================================
// Asset Register
// ============================================================================

function AssetRegister({ company }: { company: Company }) {
  const t = useT();
  const { toast } = useToast();
  const fmt = useAssetMoneyFmt();
  const { period, compareToPrevious, previousRange } = usePeriod();
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterCategoryId, setFilterCategoryId] = useState<string>("");
  const [filterLocation, setFilterLocation] = useState<string>("");
  const [search, setSearch] = useState("");
  const [openAdd, setOpenAdd] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [opAssetId, setOpAssetId] = useState<number | null>(null);
  const [opType, setOpType] = useState<"impairment" | "revaluation" | "dispose" | null>(null);

  const { data: assets, isLoading } = useQuery<FixedAssetWithCarrying[]>({
    queryKey: ["/api/fixed-assets", company.id],
    queryFn: async () => (await fetch(`/api/fixed-assets?companyId=${company.id}`)).json(),
  });

  // When a JE source-link badge for an impairment / revaluation / disposal
  // points here with `#asset-<id>`, open the asset detail dialog so the user
  // lands directly on the originating asset's history.
  useEffect(() => {
    const apply = () => {
      const m = window.location.hash.match(/^#asset-(\d+)$/);
      if (!m) return;
      const id = Number(m[1]);
      if (!(assets || []).some((a) => a.id === id)) return;
      setDetailId(id);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [assets]);
  const { data: cats } = useQuery<AssetCategory[]>({
    queryKey: ["/api/asset-categories", company.id],
    queryFn: async () => (await fetch(`/api/asset-categories?companyId=${company.id}`)).json(),
  });

  const locations = useMemo(() => {
    const set = new Set<string>();
    (assets || []).forEach((a) => { if (a.location) set.add(a.location); });
    return Array.from(set).sort();
  }, [assets]);

  // Period scoping: keep assets that were on the books at any point during
  // the active period — i.e. acquired on/before period.end and not disposed
  // before period.start. The visible totals row therefore reflects "what the
  // register looked like for the chosen window".
  const inPeriod = (a: FixedAssetWithCarrying, range: { start: Date; end: Date }) => {
    const acq = new Date(a.acquisitionDate).getTime();
    if (Number.isFinite(acq) && acq > range.end.getTime()) return false;
    if (a.status === "disposed") return false;
    return true;
  };

  const filtered = useMemo(() => {
    return (assets || []).filter((a) => {
      if (!inPeriod(a, period)) return false;
      if (filterStatus && a.status !== filterStatus) return false;
      if (filterCategoryId && a.categoryId !== Number(filterCategoryId)) return false;
      if (filterLocation && a.location !== filterLocation) return false;
      if (search && !`${a.code} ${a.name} ${a.location || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [assets, filterStatus, filterCategoryId, filterLocation, search, period]);

  const sumTotals = (rows: FixedAssetWithCarrying[]) => rows.reduce(
    (acc, a) => ({
      cost: acc.cost + Number(a.cost),
      accDep: acc.accDep + Number(a.accumDepreciation),
      accImp: acc.accImp + Number(a.accumImpairment),
      surplus: acc.surplus + Number(a.revalSurplus),
      nbv: acc.nbv + a.carryingAmount,
    }),
    { cost: 0, accDep: 0, accImp: 0, surplus: 0, nbv: 0 }
  );
  const totals = useMemo(() => sumTotals(filtered), [filtered]);
  const prevTotals = useMemo(() => {
    if (!compareToPrevious) return null;
    return sumTotals((assets || []).filter((a) => inPeriod(a, previousRange)));
  }, [assets, compareToPrevious, previousRange]);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/fixed-assets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fixed-assets"] });
      toast({ title: t("asset_toast_deleted") });
    },
    onError: (e: unknown) => toast({ title: t("asset_delete_failed"), description: t(mapErrorKey(e)), variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3 flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
          <CardTitle className="text-lg">{t("asset_tab_register")}</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Input placeholder={t("asset_search_ph")} value={search} onChange={(e) => setSearch(e.target.value)} className="w-44" data-testid="input-search-assets" />
            <Select value={filterCategoryId || "all"} onValueChange={(v) => setFilterCategoryId(v === "all" ? "" : v)}>
              <SelectTrigger className="w-44" data-testid="select-filter-category"><SelectValue placeholder={t("asset_all_categories")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("asset_all_categories")}</SelectItem>
                {(cats || []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterLocation || "all"} onValueChange={(v) => setFilterLocation(v === "all" ? "" : v)}>
              <SelectTrigger className="w-36" data-testid="select-filter-location"><SelectValue placeholder={t("asset_all_locations")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("asset_all_locations")}</SelectItem>
                {locations.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus || "all"} onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}>
              <SelectTrigger className="w-36" data-testid="select-filter-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("asset_all_statuses")}</SelectItem>
                <SelectItem value="active">{t("asset_st_active")}</SelectItem>
                <SelectItem value="disposed">{t("asset_st_disposed")}</SelectItem>
                <SelectItem value="fully_depreciated">{t("asset_st_fully_dep")}</SelectItem>
              </SelectContent>
            </Select>
            <Dialog open={openAdd} onOpenChange={setOpenAdd}>
              <WriteGuard forceDisabled={!cats || cats.length === 0}>
                <Button data-testid="button-add-asset" onClick={() => setOpenAdd(true)}>
                  <Plus className="w-4 h-4 ml-1" /> {t("asset_add")}
                </Button>
              </WriteGuard>
              <AddAssetDialog
                company={company}
                categories={cats || []}
                onClose={() => setOpenAdd(false)}
              />
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ListSkeleton rows={4} testId="skeleton-assets" />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={t("asset_empty_title")}
              description={t("asset_empty_desc")}
              testId="empty-fixed-assets"
            />
          ) : (
            <div className="overflow-x-auto table-sticky-first">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-right py-2 px-2">{t("asset_code")}</th>
                    <th className="text-right py-2 px-2">{t("asset_name")}</th>
                    <th className="text-right py-2 px-2">{t("asset_category")}</th>
                    <th className="text-right py-2 px-2">{t("asset_location")}</th>
                    <th className="text-right py-2 px-2">{t("asset_cost")}</th>
                    <th className="text-right py-2 px-2">{t("asset_accum_dep")}</th>
                    <th className="text-right py-2 px-2">{t("asset_accum_impair")}</th>
                    <th className="text-right py-2 px-2">{t("asset_reval_surplus")}</th>
                    <th className="text-right py-2 px-2 font-bold">{t("asset_carrying")}</th>
                    <th className="text-right py-2 px-2">{t("asset_status")}</th>
                    <th className="text-right py-2 px-2">{t("asset_actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => {
                    const cat = cats?.find((c) => c.id === a.categoryId);
                    return (
                      <tr key={a.id} className="border-b hover:bg-muted/30" data-testid={`row-asset-${a.id}`}>
                        <td className="py-2 px-2 font-mono">{a.code}</td>
                        <td className="py-2 px-2 cursor-pointer hover:underline" onClick={() => setDetailId(a.id)} data-testid={`link-asset-${a.id}`}>{a.name}</td>
                        <td className="py-2 px-2 text-xs text-muted-foreground">{cat?.name || "—"}</td>
                        <td className="py-2 px-2 text-xs text-muted-foreground">{a.location || "—"}</td>
                        <td className="py-2 px-2 tabular-nums">{fmt(a.cost)}</td>
                        <td className="py-2 px-2 tabular-nums text-rose-600">{fmt(a.accumDepreciation)}</td>
                        <td className="py-2 px-2 tabular-nums text-rose-600">{fmt(a.accumImpairment)}</td>
                        <td className="py-2 px-2 tabular-nums text-emerald-600">{fmt(a.revalSurplus)}</td>
                        <td className="py-2 px-2 tabular-nums font-bold" data-testid={`text-nbv-${a.id}`}>{fmt(a.carryingAmount, company.currencySymbol)}</td>
                        <td className="py-2 px-2"><Badge variant="secondary">{STATUS_LABEL[a.status] ? t(STATUS_LABEL[a.status]) : a.status}</Badge></td>
                        <td className="py-2 px-2">
                          <div className="flex gap-1">
                            <WriteGuard forceDisabled={a.status !== "active"}>
                              <Button size="sm" variant="ghost" title={t("asset_impairment")}
                                onClick={() => { setOpAssetId(a.id); setOpType("impairment"); }} data-testid={`button-impairment-${a.id}`}>
                                <ArrowDownCircle className="w-4 h-4" />
                              </Button>
                            </WriteGuard>
                            <WriteGuard forceDisabled={a.status !== "active"}>
                              <Button size="sm" variant="ghost" title={t("asset_revaluation")}
                                onClick={() => { setOpAssetId(a.id); setOpType("revaluation"); }} data-testid={`button-revaluation-${a.id}`}>
                                <RefreshCw className="w-4 h-4" />
                              </Button>
                            </WriteGuard>
                            <WriteGuard forceDisabled={a.status !== "active"}>
                              <Button size="sm" variant="ghost" title={t("asset_disposal")}
                                onClick={() => { setOpAssetId(a.id); setOpType("dispose"); }} data-testid={`button-dispose-${a.id}`}>
                                <Truck className="w-4 h-4" />
                              </Button>
                            </WriteGuard>
                            <WriteGuard>
                              <Button size="sm" variant="ghost" title={t("asset_delete")}
                                onClick={() => { if (confirm(t("asset_delete_confirm"))) deleteMutation.mutate(a.id); }}
                                data-testid={`button-delete-${a.id}`}>
                                <Trash2 className="w-4 h-4 text-rose-600" />
                              </Button>
                            </WriteGuard>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-bold border-t-2">
                    <td colSpan={4} className="py-2 px-2" data-testid="text-totals-count">{t("asset_totals_count").replace("{n}", String(filtered.length))}</td>
                    <td className="py-2 px-2 tabular-nums" data-testid="text-totals-cost">{fmt(totals.cost)}</td>
                    <td className="py-2 px-2 tabular-nums text-rose-600" data-testid="text-totals-accdep">{fmt(totals.accDep)}</td>
                    <td className="py-2 px-2 tabular-nums text-rose-600" data-testid="text-totals-accimp">{fmt(totals.accImp)}</td>
                    <td className="py-2 px-2 tabular-nums text-emerald-600" data-testid="text-totals-surplus">{fmt(totals.surplus)}</td>
                    <td className="py-2 px-2 tabular-nums" data-testid="text-totals-nbv">{fmt(totals.nbv, company.currencySymbol)}</td>
                    <td colSpan={2} />
                  </tr>
                  {prevTotals && (() => {
                    const delta = (cur: number, prev: number) => {
                      const d = cur - prev;
                      const cls = d >= 0 ? "text-emerald-600" : "text-rose-600";
                      const sign = d >= 0 ? "+" : "−";
                      return <span className={`text-xs ${cls}`}>{sign}{fmt(Math.abs(d))}</span>;
                    };
                    return (
                      <tr className="text-xs text-muted-foreground border-t">
                        <td colSpan={4} className="py-1 px-2">{t("asset_compare_prev")}</td>
                        <td className="py-1 px-2 tabular-nums" data-testid="text-delta-cost">{delta(totals.cost, prevTotals.cost)}</td>
                        <td className="py-1 px-2 tabular-nums" data-testid="text-delta-accdep">{delta(totals.accDep, prevTotals.accDep)}</td>
                        <td className="py-1 px-2 tabular-nums" data-testid="text-delta-accimp">{delta(totals.accImp, prevTotals.accImp)}</td>
                        <td className="py-1 px-2 tabular-nums" data-testid="text-delta-surplus">{delta(totals.surplus, prevTotals.surplus)}</td>
                        <td className="py-1 px-2 tabular-nums" data-testid="text-delta-nbv">{delta(totals.nbv, prevTotals.nbv)}</td>
                        <td colSpan={2} />
                      </tr>
                    );
                  })()}
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {detailId && <AssetDetailDialog assetId={detailId} company={company} onClose={() => setDetailId(null)} />}
      {opAssetId && opType && (
        <OperationDialog assetId={opAssetId} type={opType} company={company} onClose={() => { setOpAssetId(null); setOpType(null); }} />
      )}
    </div>
  );
}

// ============================================================================
// Add Asset
// ============================================================================

interface AssetFormState {
  code: string;
  name: string;
  categoryId: string;
  acquisitionDate: string;
  inServiceDate: string;
  currency: string;
  txCost: string;
  fxRate: string;
  residual: string;
  usefulLifeMonths: string;
  method: DepreciationMethod;
  measurementModel: "cost" | "revaluation";
  location: string;
  custodian: string;
  unitsTotal: string;
  customSchedule: string;
}

interface ComponentFormRow {
  name: string;
  cost: string;
  usefulLifeMonths: string;
  method: DepreciationMethod;
  residual: string;
}

function AddAssetDialog({ company, categories, onClose }: { company: Company; categories: AssetCategory[]; onClose: () => void }) {
  const t = useT();
  const { dir } = useLocale();
  const { toast } = useToast();
  const firstCat = categories[0];
  const [form, setForm] = useState<AssetFormState>({
    code: "",
    name: "",
    categoryId: firstCat ? String(firstCat.id) : "",
    acquisitionDate: new Date().toISOString().slice(0, 10),
    inServiceDate: new Date().toISOString().slice(0, 10),
    currency: company.functionalCurrency,
    txCost: "",
    fxRate: "1",
    residual: "0",
    usefulLifeMonths: String(firstCat?.defaultUsefulLifeMonths ?? 60),
    method: (firstCat?.defaultMethod as DepreciationMethod) ?? "straight_line",
    measurementModel: "cost",
    location: "",
    custodian: "",
    unitsTotal: "",
    customSchedule: "",
  });
  const [components, setComponents] = useState<ComponentFormRow[]>([]);

  function addComponent() {
    setComponents([...components, { name: "", cost: "", usefulLifeMonths: "60", method: "straight_line", residual: "0" }]);
  }

  const m = useMutation({
    mutationFn: async () => {
      const payload = {
        companyId: company.id,
        categoryId: Number(form.categoryId),
        code: form.code,
        name: form.name,
        acquisitionDate: form.acquisitionDate,
        inServiceDate: form.inServiceDate,
        currency: form.currency,
        txCost: Number(form.txCost),
        fxRate: Number(form.fxRate || 1),
        residual: Number(form.residual || 0),
        usefulLifeMonths: Number(form.usefulLifeMonths),
        method: form.method,
        measurementModel: form.measurementModel,
        location: form.location,
        custodian: form.custodian,
        unitsTotal: form.method === "units_of_production" ? Number(form.unitsTotal || 0) : null,
        customSchedule: form.method === "custom"
          ? form.customSchedule.split(/[\s,]+/).map((s) => Number(s)).filter((n) => !Number.isNaN(n))
          : null,
        status: "active" as const,
        components: components
          .filter((c) => c.name && c.cost)
          .map((c) => ({
            name: c.name,
            cost: Number(c.cost),
            residual: Number(c.residual || 0),
            usefulLifeMonths: Number(c.usefulLifeMonths),
            method: c.method,
          })),
      };
      const res = await apiRequest("POST", "/api/fixed-assets", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fixed-assets"] });
      toast({ title: t("asset_toast_created") });
      onClose();
    },
    onError: (e: unknown) => toast({ title: t("asset_failed"), description: t(mapErrorKey(e)), variant: "destructive" }),
  });

  return (
    <DialogContent dir={dir} className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("asset_add_dialog_title")}</DialogTitle>
        <DialogDescription>{t("asset_add_dialog_desc")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{t("asset_code")}</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} data-testid="input-asset-code" /></div>
          <div><Label>{t("asset_name")}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-asset-name" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("asset_category")}</Label>
            <Select value={form.categoryId} onValueChange={(v) => {
              const c = categories.find((x) => x.id === Number(v));
              setForm({ ...form, categoryId: v, usefulLifeMonths: String(c?.defaultUsefulLifeMonths ?? 60), method: (c?.defaultMethod as DepreciationMethod) ?? "straight_line" });
            }}>
              <SelectTrigger data-testid="select-asset-category"><SelectValue /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("asset_dep_method")}</Label>
            <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v as DepreciationMethod })}>
              <SelectTrigger data-testid="select-asset-method"><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{t(m.labelKey)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>{t("asset_acq_date")}</Label><Input type="date" value={form.acquisitionDate} onChange={(e) => setForm({ ...form, acquisitionDate: e.target.value })} data-testid="input-acquisition-date" /></div>
          <div><Label>{t("asset_service_date")}</Label><Input type="date" value={form.inServiceDate} onChange={(e) => setForm({ ...form, inServiceDate: e.target.value })} data-testid="input-service-date" /></div>
          <div><Label>{t("asset_useful_life_m")}</Label><Input type="number" value={form.usefulLifeMonths} onChange={(e) => setForm({ ...form, usefulLifeMonths: e.target.value })} data-testid="input-useful-life" /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>{t("asset_currency")}</Label><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} data-testid="input-currency" /></div>
          <div><Label>{t("asset_tx_cost")}</Label><Input type="number" value={form.txCost} onChange={(e) => setForm({ ...form, txCost: e.target.value })} data-testid="input-tx-cost" /></div>
          <div><Label>{t("asset_fx_rate_label").replace("{c}", company.functionalCurrency)}</Label><Input type="number" step="0.0001" value={form.fxRate} onChange={(e) => setForm({ ...form, fxRate: e.target.value })} data-testid="input-fx-rate" /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>{t("asset_residual")}</Label><Input type="number" value={form.residual} onChange={(e) => setForm({ ...form, residual: e.target.value })} data-testid="input-residual" /></div>
          <div><Label>{t("asset_location")}</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} data-testid="input-location" /></div>
          <div><Label>{t("asset_custodian")}</Label><Input value={form.custodian} onChange={(e) => setForm({ ...form, custodian: e.target.value })} data-testid="input-custodian" /></div>
        </div>
        {form.method === "units_of_production" && (
          <div><Label>{t("asset_units_total")}</Label><Input type="number" value={form.unitsTotal} onChange={(e) => setForm({ ...form, unitsTotal: e.target.value })} data-testid="input-units-total" /></div>
        )}
        {form.method === "custom" && (
          <div>
            <Label>{t("asset_custom_schedule")}</Label>
            <Input value={form.customSchedule} onChange={(e) => setForm({ ...form, customSchedule: e.target.value })} placeholder="200, 200, 180, 180, ..." data-testid="input-custom-schedule" />
            <div className="text-xs text-muted-foreground mt-1">{t("asset_custom_hint")}</div>
          </div>
        )}

        <div className="border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <Label>{t("asset_components_opt")}</Label>
            <Button size="sm" variant="outline" onClick={addComponent} data-testid="button-add-component">
              <Plus className="w-4 h-4 ml-1" /> {t("asset_add_component")}
            </Button>
          </div>
          {components.map((c, i) => (
            <div key={i} className="grid grid-cols-5 gap-2 mb-2">
              <Input placeholder={t("asset_name_ph")} value={c.name} onChange={(e) => { const n = [...components]; n[i].name = e.target.value; setComponents(n); }} data-testid={`input-component-name-${i}`} />
              <Input placeholder={t("asset_cost_ph")} type="number" value={c.cost} onChange={(e) => { const n = [...components]; n[i].cost = e.target.value; setComponents(n); }} data-testid={`input-component-cost-${i}`} />
              <Input placeholder={t("asset_life_ph")} type="number" value={c.usefulLifeMonths} onChange={(e) => { const n = [...components]; n[i].usefulLifeMonths = e.target.value; setComponents(n); }} data-testid={`input-component-life-${i}`} />
              <Select value={c.method} onValueChange={(v) => { const n = [...components]; n[i].method = v as DepreciationMethod; setComponents(n); }}>
                <SelectTrigger data-testid={`select-component-method-${i}`}><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.filter(m => m.value !== "units_of_production" && m.value !== "custom").map((m) => <SelectItem key={m.value} value={m.value}>{t(m.labelKey)}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" variant="ghost" onClick={() => setComponents(components.filter((_, j) => j !== i))} data-testid={`button-remove-component-${i}`}>
                <Trash2 className="w-4 h-4 text-rose-600" />
              </Button>
            </div>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button onClick={() => m.mutate()} disabled={m.isPending || !form.code || !form.name || !form.txCost || !form.categoryId} data-testid="button-save-asset">
          {t("asset_save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ============================================================================
// Asset Detail (with audit/history tab)
// ============================================================================

function AssetDetailDialog({ assetId, company, onClose }: { assetId: number; company: Company; onClose: () => void }) {
  const t = useT();
  const { dir } = useLocale();
  const fmt = useAssetMoneyFmt();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<AssetDetail>({
    queryKey: ["/api/fixed-assets", assetId, "detail"],
    queryFn: async () => (await fetch(`/api/fixed-assets/${assetId}`)).json(),
  });

  // Task #263: when DELETE /api/{impairment-events,revaluation-events,disposals}
  // returns 409 (e.g. a later event blocks the delete per task #209, the JE
  // is referenced elsewhere per task #111, or the legacy-row guard from task
  // #208 fires), park the server-supplied reason in state so the modal alert
  // below can surface it verbatim. A toast would auto-dismiss before the
  // user could read which event blocked the delete; the modal stays put
  // until they explicitly close it.
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  // Task #336: cascade-delete confirmation. When the user clicks delete on an
  // event that has later siblings on the same asset, show a modal that says
  // exactly how many later events will be reversed and asks them to confirm
  // before we hit the route with `?cascade=true`. Without later siblings the
  // plain delete path runs unchanged.
  const [cascadePending, setCascadePending] = useState<
    | {
        kind: AssetEventKind;
        id: number;
        laterCount: number;
      }
    | null
  >(null);

  const eventDeleteOptions = (path: string) => {
    const fallback = t("asset_evt_del_blocked");
    return {
      mutationFn: async (id: number) => apiRequest("DELETE", `/api/${path}/${id}`),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/fixed-assets", assetId, "detail"] });
        queryClient.invalidateQueries({ queryKey: ["/api/fixed-assets"] });
        queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
        invalidateAccountBalances();
        toast({ title: t("asset_done"), description: t("asset_evt_deleted") });
      },
      onError: (e: Error) => {
        if (e instanceof ApiError && e.status === 409) {
          const body = e.body as { message?: unknown } | null | undefined;
          const raw = body?.message;
          const serverMsg = typeof raw === "string" && raw.trim().length > 0 ? raw : fallback;
          setConflictMessage(serverMsg);
          return;
        }
        toast({ title: t("asset_error"), description: t(mapErrorKey(e)), variant: "destructive" });
      },
    };
  };

  const deleteImpairment = useMutation(eventDeleteOptions("impairment-events"));
  const deleteRevaluation = useMutation(eventDeleteOptions("revaluation-events"));
  const deleteDisposal = useMutation(eventDeleteOptions("disposals"));

  // Task #336: cascade variants — same routes with `?cascade=true`. The
  // server reverses every later event on the same asset (latest first) and
  // the target row inside one transaction. The 409 guards (legacy snapshot,
  // JE-orphan) still apply, so we route those into the same conflict modal
  // the per-event delete uses.
  const cascadeDeleteOptions = (path: string) => {
    const fallback = t("asset_cascade_blocked");
    return {
      mutationFn: async (id: number) =>
        apiRequest("DELETE", `/api/${path}/${id}?cascade=true`),
      onSuccess: () => {
        const reversedCount = (cascadePending?.laterCount ?? 0) + 1;
        const laterCount = cascadePending?.laterCount ?? 0;
        queryClient.invalidateQueries({ queryKey: ["/api/fixed-assets", assetId, "detail"] });
        queryClient.invalidateQueries({ queryKey: ["/api/fixed-assets"] });
        queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
        invalidateAccountBalances();
        toast({
          title: t("asset_done"),
          description: t("asset_evt_del_summary").replace("{n}", String(laterCount)).replace("{m}", String(reversedCount)),
        });
        setCascadePending(null);
      },
      onError: (e: Error) => {
        setCascadePending(null);
        if (e instanceof ApiError && e.status === 409) {
          const body = e.body as { message?: unknown } | null | undefined;
          const raw = body?.message;
          const serverMsg = typeof raw === "string" && raw.trim().length > 0 ? raw : fallback;
          setConflictMessage(serverMsg);
          return;
        }
        toast({ title: t("asset_error"), description: t(mapErrorKey(e)), variant: "destructive" });
      },
    };
  };

  const cascadeImpairment = useMutation(cascadeDeleteOptions("impairment-events"));
  const cascadeRevaluation = useMutation(cascadeDeleteOptions("revaluation-events"));
  const cascadeDisposal = useMutation(cascadeDeleteOptions("disposals"));

  // Mirrors `loadLaterEventsForCascade` in server/storage.ts — count any
  // event of any kind on the same asset whose `createdAt` is >= the target's
  // (server-side cascade cutoff is `gte(createdAt, cutoff)` excluding the
  // target row itself). Without a `createdAt` (legacy fixture) we can't tell
  // ordering, so fall back to the plain delete path; the server will run its
  // normal guards against that.
  const countLaterEventsOnAsset = (
    target: { kind: AssetEventKind; id: number; createdAt: string | null | undefined },
  ): number => {
    if (!data || !target.createdAt) return 0;
    const cutoff = new Date(target.createdAt).getTime();
    if (Number.isNaN(cutoff)) return 0;
    let count = 0;
    const consider = (
      kind: AssetEventKind,
      id: number,
      createdAt: string | null | undefined,
    ) => {
      if (kind === target.kind && id === target.id) return;
      if (!createdAt) return;
      const t = new Date(createdAt).getTime();
      if (Number.isNaN(t)) return;
      if (t >= cutoff) count += 1;
    };
    data.impairments.forEach((e) => consider("impairment", e.id, e.createdAt));
    data.revaluations.forEach((e) => consider("revaluation", e.id, e.createdAt));
    data.disposals.forEach((e) => consider("disposal", e.id, e.createdAt));
    return count;
  };

  const handleEventDelete = (
    kind: AssetEventKind,
    e: { id: number; createdAt?: string | null },
  ) => {
    const laterCount = countLaterEventsOnAsset({
      kind,
      id: e.id,
      createdAt: e.createdAt ?? null,
    });
    if (laterCount === 0) {
      // No later siblings — plain delete path stays as it was.
      if (kind === "impairment") deleteImpairment.mutate(e.id);
      else if (kind === "revaluation") deleteRevaluation.mutate(e.id);
      else deleteDisposal.mutate(e.id);
      return;
    }
    setCascadePending({ kind, id: e.id, laterCount });
  };

  const cascadeIsPending =
    cascadeImpairment.isPending ||
    cascadeRevaluation.isPending ||
    cascadeDisposal.isPending;

  const confirmCascade = () => {
    if (!cascadePending) return;
    if (cascadePending.kind === "impairment") cascadeImpairment.mutate(cascadePending.id);
    else if (cascadePending.kind === "revaluation") cascadeRevaluation.mutate(cascadePending.id);
    else cascadeDisposal.mutate(cascadePending.id);
  };

  // Build a unified history of journal-bearing events sorted by date
  const history = useMemo(() => {
    if (!data) return [];
    const rows: Array<{ date: string; type: string; amount: number; je: number | null; notes: string }> = [];
    data.impairments.forEach((e) => rows.push({ date: e.eventDate, type: Number(e.lossAmount) >= 0 ? t("asset_impair_loss") : t("asset_impair_reversal"), amount: Number(e.lossAmount), je: e.journalEntryId, notes: e.notes || "" }));
    data.revaluations.forEach((e) => rows.push({ date: e.eventDate, type: t("asset_reval_row").replace("{n}", e.method), amount: Number(e.surplusDelta) + Number(e.plImpact), je: e.journalEntryId, notes: e.notes || "" }));
    data.disposals.forEach((e) => rows.push({ date: e.eventDate, type: t("asset_disposal_row").replace("{n}", e.method), amount: Number(e.gainLoss), je: e.journalEntryId, notes: e.notes || "" }));
    (data.depreciations || []).forEach((d) => rows.push({
      date: `${d.year}-${String(d.month).padStart(2, "0")}-28`,
      type: t("asset_monthly_dep"),
      amount: d.amount,
      je: d.journalEntryId,
      notes: t("asset_monthly_dep_note").replace("{n}", String(d.runId)),
    }));
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  return (
    <>
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir={dir} className="sm:max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-asset-detail">
        <DialogHeader>
          <DialogTitle>{data?.name || "..."}</DialogTitle>
          <DialogDescription>{t("asset_detail_desc")}</DialogDescription>
        </DialogHeader>
        {isLoading || !data ? <Skeleton className="h-40" /> : (
          <Tabs defaultValue="summary">
            <TabsList className="grid grid-cols-8 w-full">
              <TabsTrigger value="summary" data-testid="tab-detail-summary">{t("asset_tab_summary")}</TabsTrigger>
              <TabsTrigger value="schedule" data-testid="tab-detail-schedule">{t("asset_tab_schedule")}</TabsTrigger>
              <TabsTrigger value="history" data-testid="tab-detail-history">{t("asset_tab_ledger")}</TabsTrigger>
              <TabsTrigger value="changes" data-testid="tab-detail-changes">{t("asset_tab_changes")}</TabsTrigger>
              <TabsTrigger value="impairments" data-testid="tab-detail-impairments">{t("asset_tab_impairments")}</TabsTrigger>
              <TabsTrigger value="revaluations" data-testid="tab-detail-revaluations">{t("asset_revaluation")}</TabsTrigger>
              <TabsTrigger value="disposals" data-testid="tab-detail-disposals">{t("asset_tab_disposals")}</TabsTrigger>
              <TabsTrigger value="components" data-testid="tab-detail-components">{t("asset_tab_components")}</TabsTrigger>
            </TabsList>
            <TabsContent value="summary" className="mt-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-muted-foreground">{t("asset_code")}</dt><dd className="font-mono">{data.code}</dd></div>
                <div><dt className="text-muted-foreground">{t("asset_status")}</dt><dd>{t(STATUS_LABEL[data.status])}</dd></div>
                <div><dt className="text-muted-foreground">{t("asset_currency")}</dt><dd>{data.currency} ({t("asset_rate")} {data.fxRate})</dd></div>
                <div><dt className="text-muted-foreground">{t("asset_cost_original")}</dt><dd>{fmt(data.txCost)} {data.currency}</dd></div>
                <div><dt className="text-muted-foreground">{t("asset_cost_functional")}</dt><dd>{fmt(data.cost, company.currencySymbol)}</dd></div>
                <div><dt className="text-muted-foreground">{t("asset_carrying")}</dt><dd className="font-bold">{fmt(data.carryingAmount, company.currencySymbol)}</dd></div>
                <div><dt className="text-muted-foreground">{t("asset_accum_dep")}</dt><dd>{fmt(data.accumDepreciation, company.currencySymbol)}</dd></div>
                <div><dt className="text-muted-foreground">{t("asset_accum_impair")}</dt><dd>{fmt(data.accumImpairment, company.currencySymbol)}</dd></div>
                <div><dt className="text-muted-foreground">{t("asset_reval_surplus")}</dt><dd>{fmt(data.revalSurplus, company.currencySymbol)}</dd></div>
                <div><dt className="text-muted-foreground">{t("asset_dep_no_impair")}</dt><dd>{fmt(data.accumDepNoImpairment, company.currencySymbol)}</dd></div>
                <div><dt className="text-muted-foreground">{t("asset_useful_life")}</dt><dd>{t("asset_months_suffix").replace("{n}", String(data.usefulLifeMonths))}</dd></div>
                <div><dt className="text-muted-foreground">{t("asset_method")}</dt><dd>{(() => { const m = METHODS.find((x) => x.value === data.method); return m ? t(m.labelKey) : data.method; })()}</dd></div>
                <div><dt className="text-muted-foreground">{t("asset_location")}</dt><dd>{data.location || "—"}</dd></div>
                <div><dt className="text-muted-foreground">{t("asset_custodian")}</dt><dd>{data.custodian || "—"}</dd></div>
                <div><dt className="text-muted-foreground">{t("asset_last_dep_period")}</dt><dd>{data.lastDepreciatedPeriod || "—"}</dd></div>
              </dl>
            </TabsContent>
            <TabsContent value="schedule" className="mt-4 max-h-96 overflow-y-auto">
              {data.schedule.length === 0 ? <div className="text-sm text-muted-foreground">{t("asset_no_schedule")}</div> : (
                <div className="table-sticky-first"><table className="w-full text-sm"><thead className="text-muted-foreground border-b"><tr><th className="text-right py-2">{t("asset_month")}</th><th className="text-right py-2">{t("asset_amount")}</th><th className="text-right py-2">{t("asset_status")}</th></tr></thead>
                  <tbody>{data.schedule.map((r) => (
                    <tr key={r.id} className="border-b" data-testid={`row-schedule-${r.id}`}>
                      <td className="py-1">{r.periodYear}-{String(r.periodMonth).padStart(2, "0")}</td>
                      <td className="py-1 tabular-nums">{fmt(r.plannedAmount)}</td>
                      <td className="py-1"><Badge variant="secondary">{r.status}</Badge></td>
                    </tr>
                  ))}</tbody></table></div>
              )}
            </TabsContent>
            <TabsContent value="history" className="mt-4 max-h-96 overflow-y-auto" data-testid="tab-content-history">
              {history.length === 0 ? <div className="text-sm text-muted-foreground">{t("asset_no_entries")}</div> : (
                <div className="table-sticky-first"><table className="w-full text-sm">
                  <thead className="text-muted-foreground border-b"><tr><th className="text-right py-2">{t("asset_date")}</th><th className="text-right py-2">{t("asset_type")}</th><th className="text-right py-2">{t("asset_amount")}</th><th className="text-right py-2">{t("asset_entry")}</th><th className="text-right py-2">{t("asset_notes")}</th></tr></thead>
                  <tbody>{history.map((r, i) => (
                    <tr key={i} className="border-b" data-testid={`row-history-${i}`}>
                      <td className="py-1">{r.date}</td>
                      <td className="py-1">{r.type}</td>
                      <td className="py-1 tabular-nums">{fmt(r.amount, company.currencySymbol)}</td>
                      <td className="py-1">{r.je ? (
                        <JournalEntryRefLink
                          id={r.je}
                          className="text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none rounded-sm"
                          data-testid={`link-journal-entry-history-${i}`}
                          title={t("asset_open_je").replace("{n}", String(r.je))}
                        >
                          JE {r.je}
                        </JournalEntryRefLink>
                      ) : <span className="text-muted-foreground">—</span>}</td>
                      <td className="py-1 text-xs text-muted-foreground">{r.notes}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
              {data.disposals.length > 0 && (
                <div className="mt-4 text-xs text-muted-foreground">
                  {t("asset_disposed_note")
                    .replace("{d}", String(data.disposals[0].eventDate))
                    .replace("{n}", fmt(data.disposals[0].proceeds, company.currencySymbol))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="changes" className="mt-4" data-testid="tab-content-changes">
              <div className="rounded-md border border-border max-h-96 overflow-hidden flex flex-col">
                <HistoryTimeline
                  entityType="fixed_asset"
                  entityId={assetId}
                  className="flex-1 min-h-0"
                />
              </div>
            </TabsContent>
            <TabsContent value="impairments" className="mt-4">
              {data.impairments.length === 0 ? <div className="text-sm text-muted-foreground">{t("asset_no_impairments")}</div> : (
                <div className="table-sticky-first"><table className="w-full text-sm"><thead className="border-b"><tr><th className="text-right py-2">{t("asset_date")}</th><th className="text-right py-2">{t("asset_recoverable")}</th><th className="text-right py-2">{t("asset_amount")}</th><th className="text-right py-2">{t("asset_entry")}</th><th className="text-right py-2"></th></tr></thead>
                  <tbody>{data.impairments.map((e) => (
                    <tr key={e.id} className="border-b" data-testid={`row-impairment-${e.id}`}>
                      <td className="py-1">{e.eventDate}</td>
                      <td className="py-1 tabular-nums">{fmt(e.recoverableAmount)}</td>
                      <td className="py-1 tabular-nums">{fmt(e.lossAmount)}</td>
                      <td className="py-1">{e.journalEntryId ? (
                        <JournalEntryRefLink
                          id={e.journalEntryId}
                          className="text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none rounded-sm"
                          data-testid={`link-journal-entry-impairment-${e.id}`}
                          title={t("asset_open_je").replace("{n}", String(e.journalEntryId))}
                        >
                          JE {e.journalEntryId}
                        </JournalEntryRefLink>
                      ) : <span className="text-muted-foreground">—</span>}</td>
                      <td className="py-1">
                        <WriteGuard>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEventDelete("impairment", e)}
                            disabled={deleteImpairment.isPending || cascadeIsPending}
                            data-testid={`button-delete-impairment-${e.id}`}
                            title={t("asset_evt_del_title")}
                          >
                            <Trash2 className="w-4 h-4 text-rose-600" />
                          </Button>
                        </WriteGuard>
                      </td>
                    </tr>
                  ))}</tbody></table></div>
              )}
            </TabsContent>
            <TabsContent value="revaluations" className="mt-4">
              {data.revaluations.length === 0 ? <div className="text-sm text-muted-foreground">{t("asset_no_revaluations")}</div> : (
                <div className="table-sticky-first"><table className="w-full text-sm"><thead className="border-b"><tr><th className="text-right py-2">{t("asset_date")}</th><th className="text-right py-2">{t("asset_fair_value")}</th><th className="text-right py-2">{t("asset_method")}</th><th className="text-right py-2">{t("asset_surplus")}</th><th className="text-right py-2">P&L</th><th className="text-right py-2">{t("asset_entry")}</th><th className="text-right py-2"></th></tr></thead>
                  <tbody>{data.revaluations.map((e) => (
                    <tr key={e.id} className="border-b" data-testid={`row-revaluation-${e.id}`}>
                      <td className="py-1">{e.eventDate}</td>
                      <td className="py-1 tabular-nums">{fmt(e.fairValue)}</td>
                      <td className="py-1">{e.method}</td>
                      <td className="py-1 tabular-nums">{fmt(e.surplusDelta)}</td>
                      <td className="py-1 tabular-nums">{fmt(e.plImpact)}</td>
                      <td className="py-1">{e.journalEntryId ? (
                        <JournalEntryRefLink
                          id={e.journalEntryId}
                          className="text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none rounded-sm"
                          data-testid={`link-journal-entry-revaluation-${e.id}`}
                          title={t("asset_open_je").replace("{n}", String(e.journalEntryId))}
                        >
                          JE {e.journalEntryId}
                        </JournalEntryRefLink>
                      ) : <span className="text-muted-foreground">—</span>}</td>
                      <td className="py-1">
                        <WriteGuard>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEventDelete("revaluation", e)}
                            disabled={deleteRevaluation.isPending || cascadeIsPending}
                            data-testid={`button-delete-revaluation-${e.id}`}
                            title={t("asset_evt_del_title")}
                          >
                            <Trash2 className="w-4 h-4 text-rose-600" />
                          </Button>
                        </WriteGuard>
                      </td>
                    </tr>
                  ))}</tbody></table></div>
              )}
            </TabsContent>
            <TabsContent value="disposals" className="mt-4">
              {data.disposals.length === 0 ? <div className="text-sm text-muted-foreground">{t("asset_no_disposals")}</div> : (
                <div className="table-sticky-first"><table className="w-full text-sm"><thead className="border-b"><tr><th className="text-right py-2">{t("asset_date")}</th><th className="text-right py-2">{t("asset_method")}</th><th className="text-right py-2">{t("asset_proceeds")}</th><th className="text-right py-2">{t("asset_gain_loss")}</th><th className="text-right py-2">{t("asset_entry")}</th><th className="text-right py-2"></th></tr></thead>
                  <tbody>{data.disposals.map((e) => (
                    <tr key={e.id} className="border-b" data-testid={`row-disposal-${e.id}`}>
                      <td className="py-1">{e.eventDate}</td>
                      <td className="py-1">{e.method}</td>
                      <td className="py-1 tabular-nums">{fmt(e.proceeds)}</td>
                      <td className="py-1 tabular-nums">{fmt(e.gainLoss)}</td>
                      <td className="py-1">{e.journalEntryId ? (
                        <JournalEntryRefLink
                          id={e.journalEntryId}
                          className="text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none rounded-sm"
                          data-testid={`link-journal-entry-disposal-${e.id}`}
                          title={t("asset_open_je").replace("{n}", String(e.journalEntryId))}
                        >
                          JE {e.journalEntryId}
                        </JournalEntryRefLink>
                      ) : <span className="text-muted-foreground">—</span>}</td>
                      <td className="py-1">
                        <WriteGuard>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEventDelete("disposal", e)}
                            disabled={deleteDisposal.isPending || cascadeIsPending}
                            data-testid={`button-delete-disposal-${e.id}`}
                            title={t("asset_evt_del_title")}
                          >
                            <Trash2 className="w-4 h-4 text-rose-600" />
                          </Button>
                        </WriteGuard>
                      </td>
                    </tr>
                  ))}</tbody></table></div>
              )}
            </TabsContent>
            <TabsContent value="components" className="mt-4">
              {data.components.length === 0 ? <div className="text-sm text-muted-foreground">{t("asset_no_components")}</div> : (
                <div className="table-sticky-first"><table className="w-full text-sm"><thead className="border-b"><tr><th className="text-right py-2">{t("asset_name")}</th><th className="text-right py-2">{t("asset_cost")}</th><th className="text-right py-2">{t("asset_life")}</th><th className="text-right py-2">{t("asset_method")}</th><th className="text-right py-2">{t("asset_accum_dep")}</th></tr></thead>
                  <tbody>{data.components.map((c) => (
                    <tr key={c.id} className="border-b">
                      <td className="py-1">{c.name}</td>
                      <td className="py-1 tabular-nums">{fmt(c.cost)}</td>
                      <td className="py-1">{t("asset_months_suffix").replace("{n}", String(c.usefulLifeMonths))}</td>
                      <td className="py-1">{(() => { const m = METHODS.find(x => x.value === c.method); return m ? t(m.labelKey) : c.method; })()}</td>
                      <td className="py-1 tabular-nums">{fmt(c.accumDepreciation)}</td>
                    </tr>
                  ))}</tbody></table></div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
    {/*
      Task #263: surface the server-supplied 409 reason in a modal alert
      (not a toast) so the user has time to read which specific event
      blocks the delete — e.g. "a revaluation posted on 2099-08-31 must
      be deleted first". A destructive toast would auto-dismiss after a
      few seconds and leave the user staring at a row that didn't go
      away with no explanation.
    */}
    {/*
      Task #336: cascade-delete confirmation. When the row the user clicked
      has later siblings on the same asset, we open this dialog instead of
      firing the plain delete (which would 409 with the task #209 guard).
      Confirming sends the same DELETE with `?cascade=true`, which reverses
      every later event (latest first) and the target row in one tx; the
      success toast names the count so the user has a single, clear summary
      of what was undone.
    */}
    <AlertDialog
      open={!!cascadePending}
      onOpenChange={(o) => { if (!o && !cascadeIsPending) setCascadePending(null); }}
    >
      <AlertDialogContent dir={dir} data-testid="dialog-asset-event-cascade-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-right">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
            {t("asset_cascade_title")}
          </AlertDialogTitle>
          <AlertDialogDescription
            className="text-sm leading-relaxed text-foreground text-right whitespace-pre-line"
            data-testid="text-asset-event-cascade-message"
          >
            {t("asset_cascade_pending").replace("{n}", String(cascadePending?.laterCount ?? 0)) +
              t("asset_cascade_desc")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={cascadeIsPending}
            data-testid="button-asset-event-cascade-cancel"
          >
            {t("asset_cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(ev) => {
              ev.preventDefault();
              confirmCascade();
            }}
            disabled={cascadeIsPending}
            data-testid="button-asset-event-cascade-confirm"
          >
            {t("asset_cascade_delete_btn").replace("{n}", String(cascadePending?.laterCount ?? 0))}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog
      open={!!conflictMessage}
      onOpenChange={(o) => { if (!o) setConflictMessage(null); }}
    >
      <AlertDialogContent dir={dir} data-testid="dialog-asset-event-delete-conflict">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-right">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
            {t("asset_evt_del_fail_title")}
          </AlertDialogTitle>
          <AlertDialogDescription
            className="text-sm leading-relaxed text-foreground text-right whitespace-pre-line"
            data-testid="text-asset-event-delete-conflict-message"
          >
            {conflictMessage}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={() => setConflictMessage(null)}
            data-testid="button-asset-event-delete-conflict-close"
          >
            {t("asset_understood")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

// ============================================================================
// Operations
// ============================================================================

interface OperationFormState {
  eventDate: string;
  recoverableAmount: string;
  fairValue: string;
  method: "elimination" | "proportional";
  proceeds: string;
  disposalMethod: "sale" | "scrap" | "writeoff";
  notes: string;
}

type OperationPreview = ImpairmentPreview | RevaluationPreview | DisposalPreview;

function OperationDialog({ assetId, type, company, onClose }: { assetId: number; type: "impairment" | "revaluation" | "dispose"; company: Company; onClose: () => void }) {
  const t = useT();
  const { dir } = useLocale();
  const { toast } = useToast();
  const fmt = useAssetMoneyFmt();
  const [form, setForm] = useState<OperationFormState>({
    eventDate: new Date().toISOString().slice(0, 10),
    recoverableAmount: "",
    fairValue: "",
    method: "elimination",
    proceeds: "",
    disposalMethod: "sale",
    notes: "",
  });
  const [preview, setPreview] = useState<OperationPreview | null>(null);

  const url = type === "impairment" ? `/api/fixed-assets/${assetId}/impairment`
    : type === "revaluation" ? `/api/fixed-assets/${assetId}/revaluation`
    : `/api/fixed-assets/${assetId}/dispose`;

  function buildPayload(confirm: boolean) {
    if (type === "impairment") return { eventDate: form.eventDate, recoverableAmount: Number(form.recoverableAmount || 0), notes: form.notes, confirm };
    if (type === "revaluation") return { eventDate: form.eventDate, fairValue: Number(form.fairValue || 0), method: form.method, notes: form.notes, confirm };
    return { eventDate: form.eventDate, proceeds: Number(form.proceeds || 0), method: form.disposalMethod, notes: form.notes, confirm };
  }

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", url, buildPayload(false));
      return res.json() as Promise<{ preview: OperationPreview }>;
    },
    onSuccess: (d) => setPreview(d.preview),
    onError: (e: unknown) => toast({ title: t("asset_preview_failed"), description: t(mapErrorKey(e)), variant: "destructive" }),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", url, buildPayload(true));
      return res.json() as Promise<{ journalEntryId: number }>;
    },
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fixed-assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      invalidateAccountBalances();
      toast({ title: t("asset_posted"), description: t("asset_je_number").replace("{n}", String(d.journalEntryId)) });
      onClose();
    },
    onError: (e: unknown) => toast({ title: t("asset_post_failed"), description: t(mapErrorKey(e)), variant: "destructive" }),
  });

  const titles = { impairment: t("asset_impair_title"), revaluation: t("asset_reval_title"), dispose: t("asset_disposal_title") };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir={dir} className="sm:max-w-lg" data-testid={`dialog-op-${type}`}>
        <DialogHeader>
          <DialogTitle>{titles[type]}</DialogTitle>
          <DialogDescription>{t("asset_review_then_post")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div><Label>{t("asset_date")}</Label><Input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} data-testid="input-op-date" /></div>
          {type === "impairment" && (
            <div><Label>{t("asset_recoverable")}</Label><Input type="number" value={form.recoverableAmount} onChange={(e) => setForm({ ...form, recoverableAmount: e.target.value })} data-testid="input-recoverable" /></div>
          )}
          {type === "revaluation" && (
            <>
              <div><Label>{t("asset_fair_value")}</Label><Input type="number" value={form.fairValue} onChange={(e) => setForm({ ...form, fairValue: e.target.value })} data-testid="input-fair-value" /></div>
              <div>
                <Label>{t("asset_reval_method")}</Label>
                <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v as "elimination" | "proportional" })}>
                  <SelectTrigger data-testid="select-reval-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="elimination">{t("asset_reval_elim")}</SelectItem>
                    <SelectItem value="proportional">{t("asset_reval_proportional")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          {type === "dispose" && (
            <>
              <div><Label>{t("asset_sale_proceeds")}</Label><Input type="number" value={form.proceeds} onChange={(e) => setForm({ ...form, proceeds: e.target.value })} data-testid="input-proceeds" /></div>
              <div>
                <Label>{t("asset_method")}</Label>
                <Select value={form.disposalMethod} onValueChange={(v) => setForm({ ...form, disposalMethod: v as "sale" | "scrap" | "writeoff" })}>
                  <SelectTrigger data-testid="select-disposal-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sale">{t("asset_disp_sale")}</SelectItem>
                    <SelectItem value="scrap">{t("asset_disp_scrap")}</SelectItem>
                    <SelectItem value="writeoff">{t("asset_disp_writeoff")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div><Label>{t("asset_notes")}</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-op-notes" /></div>
          <Button variant="outline" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending} data-testid="button-preview-op">
            <Calculator className="w-4 h-4 ml-1" /> {t("asset_preview")}
          </Button>
          {preview && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1" data-testid="text-op-preview">
              {type === "impairment" && (() => { const p = preview as ImpairmentPreview; return (
                <>
                  <div>{t("asset_cur_carrying")}<span className="font-bold tabular-nums">{fmt(p.carrying, company.currencySymbol)}</span></div>
                  <div>{t("asset_default_carrying")}<span className="tabular-nums">{fmt(p.hypotheticalCarrying, company.currencySymbol)}</span></div>
                  <div>{t("asset_amount_colon")}<span className={`font-bold tabular-nums ${p.isReversal ? "text-emerald-600" : "text-rose-600"}`}>{fmt(p.amount, company.currencySymbol)}</span> {p.isReversal && t("asset_reversal_capped") + fmt(p.reversalCap, company.currencySymbol) + ")"}</div>
                  <div>{t("asset_new_carrying")}<span className="font-bold tabular-nums">{fmt(p.newCarrying, company.currencySymbol)}</span></div>
                </>
              ); })()}
              {type === "revaluation" && (() => { const p = preview as RevaluationPreview; return (
                <>
                  <div>{t("asset_new_total_cost")}<span className="font-bold tabular-nums">{fmt(p.result.newGrossCost, company.currencySymbol)}</span></div>
                  <div>{t("asset_new_accum_dep")}<span className="font-bold tabular-nums">{fmt(p.result.newAccumDep, company.currencySymbol)}</span></div>
                  <div>{t("asset_new_accum_impair")}<span className="font-bold tabular-nums">{fmt(p.result.newAccumImp, company.currencySymbol)}</span></div>
                  <div>{t("asset_surplus_change")}<span className="font-bold tabular-nums text-emerald-600">{fmt(p.result.surplusDelta, company.currencySymbol)}</span></div>
                  <div>{t("asset_pl_impact")}<span className={`font-bold tabular-nums ${p.result.plImpact >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(p.result.plImpact, company.currencySymbol)}</span></div>
                  {p.result.priorLossReversal > 0 && <div className="text-xs text-muted-foreground">{t("asset_prior_loss_rev").replace("{n}", fmt(p.result.priorLossReversal, company.currencySymbol))}</div>}
                </>
              ); })()}
              {type === "dispose" && (() => { const p = preview as DisposalPreview; return (
                <>
                  <div>{t("asset_carrying_colon")}<span className="font-bold tabular-nums">{fmt(p.carrying, company.currencySymbol)}</span></div>
                  <div>{t("asset_gain_loss_colon")}<span className={`font-bold tabular-nums ${p.result.gainLoss >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(p.result.gainLoss, company.currencySymbol)}</span></div>
                  <div>{t("asset_surplus_to_re")}<span className="font-bold tabular-nums">{fmt(p.result.surplusTransferred, company.currencySymbol)}</span></div>
                </>
              ); })()}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending || !preview} data-testid="button-confirm-op">
            {t("asset_post_entry")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Depreciation Run
// ============================================================================

function DepreciationPanel({ company }: { company: Company }) {
  const t = useT();
  const { toast } = useToast();
  const fmt = useAssetMoneyFmt();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [preview, setPreview] = useState<DepreciationPreview | null>(null);
  const [usage, setUsage] = useState<UsageEntry[]>([]);

  const { data: runs } = useQuery<DepreciationRunListItem[]>({
    queryKey: ["/api/depreciation-runs", company.id],
    queryFn: async () => (await fetch(`/api/depreciation-runs?companyId=${company.id}`)).json(),
  });

  // Deep-link from JE source-link badge: `#dr-<id>` scrolls and pulses the
  // matching depreciation run row so the user can connect the journal entry
  // back to the originating run at a glance.
  const [highlightRunId, setHighlightRunId] = useState<number | null>(null);
  useEffect(() => {
    const apply = () => {
      const m = window.location.hash.match(/^#dr-(\d+)$/);
      if (!m) return;
      const id = Number(m[1]);
      if (!(runs || []).some((r) => r.id === id)) return;
      requestAnimationFrame(() => {
        const el = document.getElementById(`dr-${id}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          setHighlightRunId(id);
          window.setTimeout(() => setHighlightRunId(null), 2400);
        }
      });
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [runs]);

  function setUsageUnits(assetId: number, componentId: number | null, units: number) {
    setUsage((prev) => {
      const next = prev.filter((u) => !(u.assetId === assetId && u.componentId === componentId));
      if (units > 0) next.push({ assetId, componentId, units });
      return next;
    });
  }

  const previewMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/depreciation-runs/preview", { companyId: company.id, year, month, usage });
      return res.json() as Promise<DepreciationPreview>;
    },
    onSuccess: (d) => setPreview(d),
    onError: (e: unknown) => toast({ title: t("asset_generic_failed"), description: t(mapErrorKey(e)), variant: "destructive" }),
  });

  const postMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/depreciation-runs/post", { companyId: company.id, year, month, usage });
      return res.json() as Promise<{ journalEntryId: number }>;
    },
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fixed-assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/depreciation-runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      invalidateAccountBalances();
      toast({ title: t("asset_dep_posted"), description: `JE ${d.journalEntryId}` });
      setPreview(null);
      setUsage([]);
    },
    onError: (e: unknown) => toast({ title: t("asset_failed"), description: t(mapErrorKey(e)), variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-lg">{t("asset_run_monthly_dep")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div><Label>{t("asset_year")}</Label><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" data-testid="input-dep-year" /></div>
            <div><Label>{t("asset_month")}</Label><Input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-20" data-testid="input-dep-month" /></div>
            <Button variant="outline" onClick={() => previewMut.mutate()} disabled={previewMut.isPending} data-testid="button-preview-dep">
              <Calculator className="w-4 h-4 ml-1" /> {t("asset_preview")}
            </Button>
            <WriteGuard forceDisabled={postMut.isPending || !preview}>
              <Button onClick={() => postMut.mutate()} data-testid="button-post-dep">
                {t("asset_post_dep")}
              </Button>
            </WriteGuard>
          </div>
          {preview && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-2" data-testid="text-dep-preview">
              <div className="font-bold">{t("asset_total_dep").replace("{n}", fmt(preview.total, company.currencySymbol))}</div>
              <div className="grid gap-1">
                {preview.byCategory.map((c) => (
                  <div key={c.categoryId} className="flex justify-between"><span>{c.categoryName}</span><span className="tabular-nums font-bold">{fmt(c.amount, company.currencySymbol)}</span></div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">{t("asset_detailed_postings").replace("{n}", String(preview.postings.length))}</div>
              {preview.needsUsage.length > 0 && (
                <div className="border-t pt-2 mt-2 space-y-2">
                  <div className="text-amber-700 dark:text-amber-400 font-semibold text-xs">{t("asset_units_need_input")}</div>
                  {preview.needsUsage.map((n) => {
                    const cur = usage.find((u) => u.assetId === n.assetId && u.componentId === n.componentId);
                    return (
                      <div key={`${n.assetId}-${n.componentId ?? "x"}`} className="flex items-center justify-between gap-3">
                        <span className="text-xs">{n.assetName}</span>
                        <Input type="number" min={0} className="w-32 h-8" placeholder={t("asset_units_count")}
                          value={cur?.units ?? ""}
                          onChange={(e) => setUsageUnits(n.assetId, n.componentId, Number(e.target.value || 0))}
                          data-testid={`input-usage-${n.assetId}-${n.componentId ?? "asset"}`}
                        />
                      </div>
                    );
                  })}
                  <Button size="sm" variant="outline" onClick={() => previewMut.mutate()} data-testid="button-recalc-usage">{t("asset_repreview_units")}</Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">{t("asset_dep_runs_log")}</CardTitle></CardHeader>
        <CardContent>
          {!runs || runs.length === 0 ? <div className="text-sm text-muted-foreground">{t("asset_no_runs")}</div> : (
            <div className="table-sticky-first"><table className="w-full text-sm">
              <thead className="border-b text-muted-foreground"><tr><th className="text-right py-2">{t("asset_period")}</th><th className="text-right py-2">{t("asset_total")}</th><th className="text-right py-2">{t("asset_status")}</th><th className="text-right py-2">{t("asset_entry")}</th></tr></thead>
              <tbody>{runs.map((r) => (
                <tr
                  key={r.id}
                  id={`dr-${r.id}`}
                  className={
                    "border-b scroll-mt-24 transition-shadow duration-500 " +
                    (highlightRunId === r.id
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                      : "")
                  }
                  data-testid={`row-run-${r.id}`}
                  data-highlighted={highlightRunId === r.id ? "true" : undefined}
                >
                  <td className="py-2">{r.year}-{String(r.month).padStart(2, "0")}</td>
                  <td className="py-2 tabular-nums">{fmt(r.totalAmount, company.currencySymbol)}</td>
                  <td className="py-2"><Badge variant={r.status === "posted" ? "default" : "secondary"}>{r.status}</Badge></td>
                  <td className="py-2">{r.journalEntryId ? (
                    <JournalEntryRefLink
                      id={r.journalEntryId}
                      className="text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none rounded-sm"
                      data-testid={`link-journal-entry-depreciation-run-${r.id}`}
                      title={t("asset_open_je").replace("{n}", String(r.journalEntryId))}
                    >
                      JE {r.journalEntryId}
                    </JournalEntryRefLink>
                  ) : <span className="text-muted-foreground">—</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Categories
// ============================================================================

interface CategoryFormState {
  name: string;
  measurementModel: "cost" | "revaluation";
  defaultUsefulLifeMonths: string;
  defaultMethod: DepreciationMethod;
  assetCostAccountId: string;
  accumulatedDepAccountId: string;
  depExpenseAccountId: string;
  accumulatedImpAccountId: string;
  impLossAccountId: string;
  revalSurplusAccountId: string;
  gainLossDisposalAccountId: string;
}

function CategoriesPanel({ company }: { company: Company }) {
  const t = useT();
  const { dir } = useLocale();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { data: cats } = useQuery<AssetCategory[]>({
    queryKey: ["/api/asset-categories", company.id],
    queryFn: async () => (await fetch(`/api/asset-categories?companyId=${company.id}`)).json(),
  });
  const { data: accounts } = useQuery<Account[]>({ queryKey: ["/api/accounts"] });

  const [form, setForm] = useState<CategoryFormState>({
    name: "",
    measurementModel: "cost",
    defaultUsefulLifeMonths: "60",
    defaultMethod: "straight_line",
    assetCostAccountId: "",
    accumulatedDepAccountId: "",
    depExpenseAccountId: "",
    accumulatedImpAccountId: "",
    impLossAccountId: "",
    revalSurplusAccountId: "",
    gainLossDisposalAccountId: "",
  });

  const m = useMutation({
    mutationFn: async () => {
      const payload = {
        companyId: company.id,
        name: form.name,
        measurementModel: form.measurementModel,
        defaultUsefulLifeMonths: Number(form.defaultUsefulLifeMonths),
        defaultMethod: form.defaultMethod,
        assetCostAccountId: Number(form.assetCostAccountId),
        accumulatedDepAccountId: Number(form.accumulatedDepAccountId),
        depExpenseAccountId: Number(form.depExpenseAccountId),
        accumulatedImpAccountId: Number(form.accumulatedImpAccountId),
        impLossAccountId: Number(form.impLossAccountId),
        revalSurplusAccountId: Number(form.revalSurplusAccountId),
        gainLossDisposalAccountId: Number(form.gainLossDisposalAccountId),
      };
      const res = await apiRequest("POST", "/api/asset-categories", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/asset-categories"] });
      toast({ title: t("asset_cat_added") });
      setOpen(false);
    },
    onError: (e: unknown) => toast({ title: t("asset_failed"), description: t(mapErrorKey(e)), variant: "destructive" }),
  });

  const accSelect = (label: string, key: keyof CategoryFormState) => (
    <div>
      <Label>{label}</Label>
      <Select value={form[key]} onValueChange={(v) => setForm({ ...form, [key]: v })}>
        <SelectTrigger data-testid={`select-cat-${String(key)}`}><SelectValue placeholder={t("asset_pick_account")} /></SelectTrigger>
        <SelectContent>{(accounts || []).filter((a) => !a.isHeader).map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.nameAr}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">{t("asset_categories_title")}</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <WriteGuard><Button data-testid="button-add-category" onClick={() => setOpen(true)}><Plus className="w-4 h-4 ml-1" />{t("asset_add_category")}</Button></WriteGuard>
          <DialogContent dir={dir} className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("asset_new_category")}</DialogTitle>
              <DialogDescription>{t("asset_cat_link_accounts")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>{t("asset_name")}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-cat-name" /></div>
                <div>
                  <Label>{t("asset_measurement_model")}</Label>
                  <Select value={form.measurementModel} onValueChange={(v) => setForm({ ...form, measurementModel: v as "cost" | "revaluation" })}>
                    <SelectTrigger data-testid="select-cat-model"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cost">{t("asset_cost")}</SelectItem>
                      <SelectItem value="revaluation">{t("asset_reval_model")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>{t("asset_default_life")}</Label><Input type="number" value={form.defaultUsefulLifeMonths} onChange={(e) => setForm({ ...form, defaultUsefulLifeMonths: e.target.value })} data-testid="input-cat-life" /></div>
                <div>
                  <Label>{t("asset_default_method")}</Label>
                  <Select value={form.defaultMethod} onValueChange={(v) => setForm({ ...form, defaultMethod: v as DepreciationMethod })}>
                    <SelectTrigger data-testid="select-cat-method"><SelectValue /></SelectTrigger>
                    <SelectContent>{METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{t(m.labelKey)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {accSelect(t("asset_acc_cost"), "assetCostAccountId")}
                {accSelect(t("asset_acc_accum_dep"), "accumulatedDepAccountId")}
                {accSelect(t("asset_acc_dep_exp"), "depExpenseAccountId")}
                {accSelect(t("asset_acc_accum_impair"), "accumulatedImpAccountId")}
                {accSelect(t("asset_acc_impair_loss"), "impLossAccountId")}
                {accSelect(t("asset_acc_reval_surplus"), "revalSurplusAccountId")}
                {accSelect(t("asset_acc_disposal_pl"), "gainLossDisposalAccountId")}
              </div>
            </div>
            <DialogFooter><Button onClick={() => m.mutate()} disabled={m.isPending || !form.name} data-testid="button-save-category">{t("asset_save")}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {!cats || cats.length === 0 ? <div className="text-sm text-muted-foreground">{t("asset_no_categories")}</div> : (
          <div className="table-sticky-first"><table className="w-full text-sm">
            <thead className="border-b text-muted-foreground"><tr><th className="text-right py-2">{t("asset_name")}</th><th className="text-right py-2">{t("asset_model")}</th><th className="text-right py-2">{t("asset_life")}</th><th className="text-right py-2">{t("asset_method")}</th></tr></thead>
            <tbody>{cats.map((c) => (
              <tr key={c.id} className="border-b" data-testid={`row-category-${c.id}`}>
                <td className="py-2">{c.name}</td>
                <td className="py-2">{c.measurementModel === "cost" ? t("asset_cost") : t("asset_reval_model")}</td>
                <td className="py-2">{t("asset_months_suffix").replace("{n}", String(c.defaultUsefulLifeMonths))}</td>
                <td className="py-2">{(() => { const m = METHODS.find((x) => x.value === c.defaultMethod); return m ? t(m.labelKey) : c.defaultMethod; })()}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Companies
// ============================================================================

export function CompaniesPanel() {
  const t = useT();
  const { dir } = useLocale();
  const { toast } = useToast();
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", functionalCurrency: "USD", currencySymbol: "$", isDefault: false });

  const m = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/companies", form)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: t("asset_company_added") });
      setOpen(false);
    },
    onError: (e: unknown) => toast({ title: t("asset_failed"), description: t(mapErrorKey(e)), variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">{t("asset_tab_companies")}</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <OwnerGuard><Button data-testid="button-add-company" onClick={() => setOpen(true)}><Plus className="w-4 h-4 ml-1" />{t("asset_add_company")}</Button></OwnerGuard>
          <DialogContent dir={dir}>
            <DialogHeader><DialogTitle>{t("asset_new_company")}</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div><Label>{t("asset_name")}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-company-name" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>{t("asset_functional_currency")}</Label><Input value={form.functionalCurrency} onChange={(e) => setForm({ ...form, functionalCurrency: e.target.value.toUpperCase() })} data-testid="input-company-currency" /></div>
                <div><Label>{t("asset_symbol")}</Label><Input value={form.currencySymbol} onChange={(e) => setForm({ ...form, currencySymbol: e.target.value })} data-testid="input-company-symbol" /></div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} data-testid="checkbox-company-default" />
                {t("asset_set_default_company")}
              </label>
            </div>
            <DialogFooter><Button onClick={() => m.mutate()} disabled={m.isPending || !form.name} data-testid="button-save-company">{t("asset_save")}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <div className="table-sticky-first"><table className="w-full text-sm">
          <thead className="border-b text-muted-foreground"><tr><th className="text-right py-2">{t("asset_name")}</th><th className="text-right py-2">{t("asset_currency")}</th><th className="text-right py-2">{t("asset_default_badge")}</th></tr></thead>
          <tbody>{(companies || []).map((c) => (
            <tr key={c.id} className="border-b" data-testid={`row-company-${c.id}`}>
              <td className="py-2">{c.name}</td>
              <td className="py-2">{c.functionalCurrency} ({c.currencySymbol})</td>
              <td className="py-2">{c.isDefault ? <Badge>{t("asset_default_badge")}</Badge> : "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// FX Rates
// ============================================================================

export function FxPanel({ company }: { company: Company }) {
  const t = useT();
  const { toast } = useToast();
  const { data: rates } = useQuery<FxRate[]>({
    queryKey: ["/api/fx-rates", company.id],
    queryFn: async () => (await fetch(`/api/fx-rates?companyId=${company.id}`)).json(),
  });
  const [form, setForm] = useState({ fromCurrency: "EUR", toCurrency: company.functionalCurrency, rateDate: new Date().toISOString().slice(0, 10), rate: "1" });

  useEffect(() => { setForm((f) => ({ ...f, toCurrency: company.functionalCurrency })); }, [company]);

  const m = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/fx-rates", { companyId: company.id, ...form, rate: Number(form.rate) })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/fx-rates"] }); toast({ title: t("asset_rate_saved") }); },
    onError: (e: unknown) => toast({ title: t("asset_failed"), description: t(mapErrorKey(e)), variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/fx-rates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/fx-rates"] }),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">{t("asset_fx_rates_title").replace("{c}", company.functionalCurrency)}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-5 gap-2 items-end">
          <div><Label>{t("asset_from")}</Label><Input value={form.fromCurrency} onChange={(e) => setForm({ ...form, fromCurrency: e.target.value.toUpperCase() })} data-testid="input-fx-from" /></div>
          <div><Label>{t("asset_to")}</Label><Input value={form.toCurrency} onChange={(e) => setForm({ ...form, toCurrency: e.target.value.toUpperCase() })} data-testid="input-fx-to" /></div>
          <div><Label>{t("asset_date")}</Label><Input type="date" value={form.rateDate} onChange={(e) => setForm({ ...form, rateDate: e.target.value })} data-testid="input-fx-date" /></div>
          <div><Label>{t("asset_rate")}</Label><Input type="number" step="0.0001" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} data-testid="input-fx-rate-value" /></div>
          <OwnerGuard forceDisabled={m.isPending}>
            <Button onClick={() => m.mutate()} data-testid="button-save-fx"><Plus className="w-4 h-4 ml-1" />{t("asset_add_short")}</Button>
          </OwnerGuard>
        </div>
        {!rates || rates.length === 0 ? <div className="text-sm text-muted-foreground">{t("asset_no_rates")}</div> : (
          <div className="table-sticky-first"><table className="w-full text-sm">
            <thead className="border-b text-muted-foreground"><tr><th className="text-right py-2">{t("asset_date")}</th><th className="text-right py-2">{t("asset_from")}</th><th className="text-right py-2">{t("asset_to")}</th><th className="text-right py-2">{t("asset_rate")}</th><th /></tr></thead>
            <tbody>{rates.map((r) => (
              <tr key={r.id} className="border-b" data-testid={`row-fx-${r.id}`}>
                <td className="py-2">{r.rateDate}</td>
                <td className="py-2">{r.fromCurrency}</td>
                <td className="py-2">{r.toCurrency}</td>
                <td className="py-2 tabular-nums">{r.rate}</td>
                <td className="py-2"><OwnerGuard><Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)} data-testid={`button-delete-fx-${r.id}`}><Trash2 className="w-4 h-4 text-rose-600" /></Button></OwnerGuard></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </CardContent>
    </Card>
  );
}
