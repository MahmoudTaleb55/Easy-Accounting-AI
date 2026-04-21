import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/company-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Plus, Trash2, Calculator, ArrowDownCircle, RefreshCw, Truck } from "lucide-react";
import type { Account, AssetCategory, AssetComponent, Company, FixedAsset, FxRate, DepreciationMethod } from "@shared/schema";

const METHODS: Array<{ value: DepreciationMethod; label: string }> = [
  { value: "straight_line", label: "القسط الثابت" },
  { value: "declining_balance", label: "الرصيد المتناقص" },
  { value: "double_declining", label: "الرصيد المتناقص المضاعف" },
  { value: "syd", label: "مجموع أرقام السنوات" },
  { value: "units_of_production", label: "وحدات الإنتاج" },
  { value: "custom", label: "جدول مخصص" },
];

const STATUS_LABEL: Record<string, string> = {
  active: "نشط",
  disposed: "مستبعَد",
  fully_depreciated: "مهلك بالكامل",
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
interface ImpairmentEvent { id: number; eventDate: string; recoverableAmount: string; lossAmount: string; journalEntryId: number | null; notes?: string }
interface RevaluationEvent { id: number; eventDate: string; fairValue: string; method: string; surplusDelta: string; plImpact: string; journalEntryId: number | null; notes?: string }
interface DisposalEvent { id: number; eventDate: string; proceeds: string; method: string; gainLoss: string; surplusTransferred: string; journalEntryId: number | null; notes?: string }

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

function fmt(n: number | string | null | undefined, currency = ""): string {
  const v = Number(n || 0);
  const formatted = new Intl.NumberFormat("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  return currency ? `${formatted} ${currency}` : formatted;
}

export default function FixedAssetsPage() {
  const { activeCompany } = useCompany();

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto" dir="rtl">
      <header className="flex items-center gap-3">
        <div className="bg-primary/10 p-3 rounded-2xl">
          <Building2 className="w-7 h-7 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">الأصول الثابتة</h1>
          <p className="text-sm text-muted-foreground mt-1">إدارة الأصول وفق المعايير الدولية IAS 16 و IAS 36</p>
        </div>
      </header>

      <Tabs defaultValue="register" className="w-full">
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="register" data-testid="tab-register">سجل الأصول</TabsTrigger>
          <TabsTrigger value="depreciation" data-testid="tab-depreciation">الإهلاك</TabsTrigger>
          <TabsTrigger value="categories" data-testid="tab-categories">التصنيفات</TabsTrigger>
          <TabsTrigger value="companies" data-testid="tab-companies">الشركات</TabsTrigger>
          <TabsTrigger value="fx" data-testid="tab-fx">أسعار الصرف</TabsTrigger>
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
        <TabsContent value="companies" className="mt-6">
          <CompaniesPanel />
        </TabsContent>
        <TabsContent value="fx" className="mt-6">
          {activeCompany ? <FxPanel company={activeCompany} /> : <Skeleton className="h-40" />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================================
// Asset Register
// ============================================================================

function AssetRegister({ company }: { company: Company }) {
  const { toast } = useToast();
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
  const { data: cats } = useQuery<AssetCategory[]>({
    queryKey: ["/api/asset-categories", company.id],
    queryFn: async () => (await fetch(`/api/asset-categories?companyId=${company.id}`)).json(),
  });

  const locations = useMemo(() => {
    const set = new Set<string>();
    (assets || []).forEach((a) => { if (a.location) set.add(a.location); });
    return Array.from(set).sort();
  }, [assets]);

  const filtered = useMemo(() => {
    return (assets || []).filter((a) => {
      if (filterStatus && a.status !== filterStatus) return false;
      if (filterCategoryId && a.categoryId !== Number(filterCategoryId)) return false;
      if (filterLocation && a.location !== filterLocation) return false;
      if (search && !`${a.code} ${a.name} ${a.location || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [assets, filterStatus, filterCategoryId, filterLocation, search]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, a) => ({
        cost: acc.cost + Number(a.cost),
        accDep: acc.accDep + Number(a.accumDepreciation),
        accImp: acc.accImp + Number(a.accumImpairment),
        surplus: acc.surplus + Number(a.revalSurplus),
        nbv: acc.nbv + a.carryingAmount,
      }),
      { cost: 0, accDep: 0, accImp: 0, surplus: 0, nbv: 0 }
    );
  }, [filtered]);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/fixed-assets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fixed-assets"] });
      toast({ title: "تم حذف الأصل" });
    },
    onError: (e: Error) => toast({ title: "تعذر الحذف", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3 flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
          <CardTitle className="text-lg">سجل الأصول</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Input placeholder="ابحث…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-44" data-testid="input-search-assets" />
            <Select value={filterCategoryId || "all"} onValueChange={(v) => setFilterCategoryId(v === "all" ? "" : v)}>
              <SelectTrigger className="w-44" data-testid="select-filter-category"><SelectValue placeholder="كل التصنيفات" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل التصنيفات</SelectItem>
                {(cats || []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterLocation || "all"} onValueChange={(v) => setFilterLocation(v === "all" ? "" : v)}>
              <SelectTrigger className="w-36" data-testid="select-filter-location"><SelectValue placeholder="كل المواقع" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المواقع</SelectItem>
                {locations.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus || "all"} onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}>
              <SelectTrigger className="w-36" data-testid="select-filter-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="active">نشط</SelectItem>
                <SelectItem value="disposed">مستبعَد</SelectItem>
                <SelectItem value="fully_depreciated">مهلك بالكامل</SelectItem>
              </SelectContent>
            </Select>
            <Dialog open={openAdd} onOpenChange={setOpenAdd}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-asset" disabled={!cats || cats.length === 0}>
                  <Plus className="w-4 h-4 ml-1" /> إضافة أصل
                </Button>
              </DialogTrigger>
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
            <Skeleton className="h-32" />
          ) : filtered.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">لا توجد أصول. أضف أول أصل لتبدأ.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-right py-2 px-2">الكود</th>
                    <th className="text-right py-2 px-2">الاسم</th>
                    <th className="text-right py-2 px-2">التصنيف</th>
                    <th className="text-right py-2 px-2">الموقع</th>
                    <th className="text-right py-2 px-2">التكلفة</th>
                    <th className="text-right py-2 px-2">مجمع الإهلاك</th>
                    <th className="text-right py-2 px-2">مجمع الانخفاض</th>
                    <th className="text-right py-2 px-2">فائض إعادة التقييم</th>
                    <th className="text-right py-2 px-2 font-bold">القيمة الدفترية</th>
                    <th className="text-right py-2 px-2">الحالة</th>
                    <th className="text-right py-2 px-2">إجراءات</th>
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
                        <td className="py-2 px-2"><Badge variant="secondary">{STATUS_LABEL[a.status] || a.status}</Badge></td>
                        <td className="py-2 px-2">
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" disabled={a.status !== "active"} title="انخفاض القيمة"
                              onClick={() => { setOpAssetId(a.id); setOpType("impairment"); }} data-testid={`button-impairment-${a.id}`}>
                              <ArrowDownCircle className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="ghost" disabled={a.status !== "active"} title="إعادة تقييم"
                              onClick={() => { setOpAssetId(a.id); setOpType("revaluation"); }} data-testid={`button-revaluation-${a.id}`}>
                              <RefreshCw className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="ghost" disabled={a.status !== "active"} title="استبعاد"
                              onClick={() => { setOpAssetId(a.id); setOpType("dispose"); }} data-testid={`button-dispose-${a.id}`}>
                              <Truck className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="ghost" title="حذف"
                              onClick={() => { if (confirm("حذف الأصل وكل قيوده المخططة؟")) deleteMutation.mutate(a.id); }}
                              data-testid={`button-delete-${a.id}`}>
                              <Trash2 className="w-4 h-4 text-rose-600" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-bold border-t-2">
                    <td colSpan={4} className="py-2 px-2">الإجمالي ({filtered.length})</td>
                    <td className="py-2 px-2 tabular-nums">{fmt(totals.cost)}</td>
                    <td className="py-2 px-2 tabular-nums text-rose-600">{fmt(totals.accDep)}</td>
                    <td className="py-2 px-2 tabular-nums text-rose-600">{fmt(totals.accImp)}</td>
                    <td className="py-2 px-2 tabular-nums text-emerald-600">{fmt(totals.surplus)}</td>
                    <td className="py-2 px-2 tabular-nums">{fmt(totals.nbv, company.currencySymbol)}</td>
                    <td colSpan={2} />
                  </tr>
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
      toast({ title: "تم تسجيل الأصل" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "فشل", description: e.message, variant: "destructive" }),
  });

  return (
    <DialogContent dir="rtl" className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>إضافة أصل ثابت جديد</DialogTitle>
        <DialogDescription>وفق IAS 16. القيم بعملة المعاملة، تُحوَّل تلقائياً للعملة الوظيفية للشركة.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>الكود</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} data-testid="input-asset-code" /></div>
          <div><Label>الاسم</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-asset-name" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>التصنيف</Label>
            <Select value={form.categoryId} onValueChange={(v) => {
              const c = categories.find((x) => x.id === Number(v));
              setForm({ ...form, categoryId: v, usefulLifeMonths: String(c?.defaultUsefulLifeMonths ?? 60), method: (c?.defaultMethod as DepreciationMethod) ?? "straight_line" });
            }}>
              <SelectTrigger data-testid="select-asset-category"><SelectValue /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>طريقة الإهلاك</Label>
            <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v as DepreciationMethod })}>
              <SelectTrigger data-testid="select-asset-method"><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>تاريخ الاقتناء</Label><Input type="date" value={form.acquisitionDate} onChange={(e) => setForm({ ...form, acquisitionDate: e.target.value })} data-testid="input-acquisition-date" /></div>
          <div><Label>تاريخ التشغيل</Label><Input type="date" value={form.inServiceDate} onChange={(e) => setForm({ ...form, inServiceDate: e.target.value })} data-testid="input-service-date" /></div>
          <div><Label>العمر الإنتاجي (شهر)</Label><Input type="number" value={form.usefulLifeMonths} onChange={(e) => setForm({ ...form, usefulLifeMonths: e.target.value })} data-testid="input-useful-life" /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>العملة</Label><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} data-testid="input-currency" /></div>
          <div><Label>التكلفة بعملة المعاملة</Label><Input type="number" value={form.txCost} onChange={(e) => setForm({ ...form, txCost: e.target.value })} data-testid="input-tx-cost" /></div>
          <div><Label>سعر الصرف ← {company.functionalCurrency}</Label><Input type="number" step="0.0001" value={form.fxRate} onChange={(e) => setForm({ ...form, fxRate: e.target.value })} data-testid="input-fx-rate" /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>القيمة المتبقية</Label><Input type="number" value={form.residual} onChange={(e) => setForm({ ...form, residual: e.target.value })} data-testid="input-residual" /></div>
          <div><Label>الموقع</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} data-testid="input-location" /></div>
          <div><Label>الموكل بالحفظ</Label><Input value={form.custodian} onChange={(e) => setForm({ ...form, custodian: e.target.value })} data-testid="input-custodian" /></div>
        </div>
        {form.method === "units_of_production" && (
          <div><Label>إجمالي الوحدات الإنتاجية المتوقعة</Label><Input type="number" value={form.unitsTotal} onChange={(e) => setForm({ ...form, unitsTotal: e.target.value })} data-testid="input-units-total" /></div>
        )}
        {form.method === "custom" && (
          <div>
            <Label>الجدول المخصّص (مبالغ شهرية مفصولة بفواصل أو مسافات)</Label>
            <Input value={form.customSchedule} onChange={(e) => setForm({ ...form, customSchedule: e.target.value })} placeholder="200, 200, 180, 180, ..." data-testid="input-custom-schedule" />
            <div className="text-xs text-muted-foreground mt-1">سيتم استخدام كل قيمة كإهلاك شهر واحد ابتداءً من تاريخ التشغيل.</div>
          </div>
        )}

        <div className="border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <Label>المكوّنات (اختياري — IAS 16)</Label>
            <Button size="sm" variant="outline" onClick={addComponent} data-testid="button-add-component">
              <Plus className="w-4 h-4 ml-1" /> إضافة مكون
            </Button>
          </div>
          {components.map((c, i) => (
            <div key={i} className="grid grid-cols-5 gap-2 mb-2">
              <Input placeholder="اسم" value={c.name} onChange={(e) => { const n = [...components]; n[i].name = e.target.value; setComponents(n); }} data-testid={`input-component-name-${i}`} />
              <Input placeholder="تكلفة" type="number" value={c.cost} onChange={(e) => { const n = [...components]; n[i].cost = e.target.value; setComponents(n); }} data-testid={`input-component-cost-${i}`} />
              <Input placeholder="عمر شهر" type="number" value={c.usefulLifeMonths} onChange={(e) => { const n = [...components]; n[i].usefulLifeMonths = e.target.value; setComponents(n); }} data-testid={`input-component-life-${i}`} />
              <Select value={c.method} onValueChange={(v) => { const n = [...components]; n[i].method = v as DepreciationMethod; setComponents(n); }}>
                <SelectTrigger data-testid={`select-component-method-${i}`}><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.filter(m => m.value !== "units_of_production" && m.value !== "custom").map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
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
          حفظ
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ============================================================================
// Asset Detail (with audit/history tab)
// ============================================================================

function AssetDetailDialog({ assetId, company, onClose }: { assetId: number; company: Company; onClose: () => void }) {
  const { data, isLoading } = useQuery<AssetDetail>({
    queryKey: ["/api/fixed-assets", assetId, "detail"],
    queryFn: async () => (await fetch(`/api/fixed-assets/${assetId}`)).json(),
  });

  // Build a unified history of journal-bearing events sorted by date
  const history = useMemo(() => {
    if (!data) return [];
    const rows: Array<{ date: string; type: string; amount: number; je: number | null; notes: string }> = [];
    data.impairments.forEach((e) => rows.push({ date: e.eventDate, type: Number(e.lossAmount) >= 0 ? "خسارة انخفاض" : "عكس انخفاض", amount: Number(e.lossAmount), je: e.journalEntryId, notes: e.notes || "" }));
    data.revaluations.forEach((e) => rows.push({ date: e.eventDate, type: `إعادة تقييم (${e.method})`, amount: Number(e.surplusDelta) + Number(e.plImpact), je: e.journalEntryId, notes: e.notes || "" }));
    data.disposals.forEach((e) => rows.push({ date: e.eventDate, type: `استبعاد (${e.method})`, amount: Number(e.gainLoss), je: e.journalEntryId, notes: e.notes || "" }));
    (data.depreciations || []).forEach((d) => rows.push({
      date: `${d.year}-${String(d.month).padStart(2, "0")}-28`,
      type: "إهلاك شهري",
      amount: d.amount,
      je: d.journalEntryId,
      notes: `دفعة الإهلاك #${d.runId}`,
    }));
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-asset-detail">
        <DialogHeader>
          <DialogTitle>{data?.name || "..."}</DialogTitle>
          <DialogDescription>التفاصيل الكاملة والسجلات المرتبطة بهذا الأصل.</DialogDescription>
        </DialogHeader>
        {isLoading || !data ? <Skeleton className="h-40" /> : (
          <Tabs defaultValue="summary">
            <TabsList className="grid grid-cols-6 w-full">
              <TabsTrigger value="summary" data-testid="tab-detail-summary">ملخص</TabsTrigger>
              <TabsTrigger value="schedule" data-testid="tab-detail-schedule">الجدول</TabsTrigger>
              <TabsTrigger value="history" data-testid="tab-detail-history">السجل المحاسبي</TabsTrigger>
              <TabsTrigger value="impairments" data-testid="tab-detail-impairments">الانخفاض</TabsTrigger>
              <TabsTrigger value="revaluations" data-testid="tab-detail-revaluations">إعادة تقييم</TabsTrigger>
              <TabsTrigger value="components" data-testid="tab-detail-components">المكونات</TabsTrigger>
            </TabsList>
            <TabsContent value="summary" className="mt-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-muted-foreground">الكود</dt><dd className="font-mono">{data.code}</dd></div>
                <div><dt className="text-muted-foreground">الحالة</dt><dd>{STATUS_LABEL[data.status]}</dd></div>
                <div><dt className="text-muted-foreground">العملة</dt><dd>{data.currency} (سعر الصرف {data.fxRate})</dd></div>
                <div><dt className="text-muted-foreground">التكلفة (أصلية)</dt><dd>{fmt(data.txCost)} {data.currency}</dd></div>
                <div><dt className="text-muted-foreground">التكلفة الوظيفية</dt><dd>{fmt(data.cost, company.currencySymbol)}</dd></div>
                <div><dt className="text-muted-foreground">القيمة الدفترية</dt><dd className="font-bold">{fmt(data.carryingAmount, company.currencySymbol)}</dd></div>
                <div><dt className="text-muted-foreground">مجمع الإهلاك</dt><dd>{fmt(data.accumDepreciation, company.currencySymbol)}</dd></div>
                <div><dt className="text-muted-foreground">مجمع الانخفاض</dt><dd>{fmt(data.accumImpairment, company.currencySymbol)}</dd></div>
                <div><dt className="text-muted-foreground">فائض إعادة التقييم</dt><dd>{fmt(data.revalSurplus, company.currencySymbol)}</dd></div>
                <div><dt className="text-muted-foreground">إهلاك بدون انخفاض (للحد الأعلى للعكس)</dt><dd>{fmt(data.accumDepNoImpairment, company.currencySymbol)}</dd></div>
                <div><dt className="text-muted-foreground">العمر الإنتاجي</dt><dd>{data.usefulLifeMonths} شهر</dd></div>
                <div><dt className="text-muted-foreground">الطريقة</dt><dd>{METHODS.find((m) => m.value === data.method)?.label}</dd></div>
                <div><dt className="text-muted-foreground">الموقع</dt><dd>{data.location || "—"}</dd></div>
                <div><dt className="text-muted-foreground">الموكل بالحفظ</dt><dd>{data.custodian || "—"}</dd></div>
                <div><dt className="text-muted-foreground">آخر شهر مهلك</dt><dd>{data.lastDepreciatedPeriod || "—"}</dd></div>
              </dl>
            </TabsContent>
            <TabsContent value="schedule" className="mt-4 max-h-96 overflow-y-auto">
              {data.schedule.length === 0 ? <div className="text-sm text-muted-foreground">لا يوجد جدول.</div> : (
                <table className="w-full text-sm"><thead className="text-muted-foreground border-b"><tr><th className="text-right py-2">الشهر</th><th className="text-right py-2">المبلغ</th><th className="text-right py-2">الحالة</th></tr></thead>
                  <tbody>{data.schedule.map((r) => (
                    <tr key={r.id} className="border-b" data-testid={`row-schedule-${r.id}`}>
                      <td className="py-1">{r.periodYear}-{String(r.periodMonth).padStart(2, "0")}</td>
                      <td className="py-1 tabular-nums">{fmt(r.plannedAmount)}</td>
                      <td className="py-1"><Badge variant="secondary">{r.status}</Badge></td>
                    </tr>
                  ))}</tbody></table>
              )}
            </TabsContent>
            <TabsContent value="history" className="mt-4 max-h-96 overflow-y-auto" data-testid="tab-content-history">
              {history.length === 0 ? <div className="text-sm text-muted-foreground">لا توجد قيود مرتبطة بعد.</div> : (
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground border-b"><tr><th className="text-right py-2">التاريخ</th><th className="text-right py-2">النوع</th><th className="text-right py-2">المبلغ</th><th className="text-right py-2">القيد</th><th className="text-right py-2">ملاحظات</th></tr></thead>
                  <tbody>{history.map((r, i) => (
                    <tr key={i} className="border-b" data-testid={`row-history-${i}`}>
                      <td className="py-1">{r.date}</td>
                      <td className="py-1">{r.type}</td>
                      <td className="py-1 tabular-nums">{fmt(r.amount, company.currencySymbol)}</td>
                      <td className="py-1">{r.je ? <a href={`/journal#je-${r.je}`} className="text-primary hover:underline">JE {r.je}</a> : "—"}</td>
                      <td className="py-1 text-xs text-muted-foreground">{r.notes}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
              {data.disposals.length > 0 && (
                <div className="mt-4 text-xs text-muted-foreground">
                  الأصل تم استبعاده في {data.disposals[0].eventDate} مع متحصلات {fmt(data.disposals[0].proceeds, company.currencySymbol)}.
                </div>
              )}
            </TabsContent>
            <TabsContent value="impairments" className="mt-4">
              {data.impairments.length === 0 ? <div className="text-sm text-muted-foreground">لا توجد قيود انخفاض.</div> : (
                <table className="w-full text-sm"><thead className="border-b"><tr><th className="text-right py-2">التاريخ</th><th className="text-right py-2">القيمة الاستردادية</th><th className="text-right py-2">المبلغ</th><th className="text-right py-2">القيد</th></tr></thead>
                  <tbody>{data.impairments.map((e) => (
                    <tr key={e.id} className="border-b">
                      <td className="py-1">{e.eventDate}</td>
                      <td className="py-1 tabular-nums">{fmt(e.recoverableAmount)}</td>
                      <td className="py-1 tabular-nums">{fmt(e.lossAmount)}</td>
                      <td className="py-1">{e.journalEntryId ? `JE ${e.journalEntryId}` : "—"}</td>
                    </tr>
                  ))}</tbody></table>
              )}
            </TabsContent>
            <TabsContent value="revaluations" className="mt-4">
              {data.revaluations.length === 0 ? <div className="text-sm text-muted-foreground">لا توجد عمليات إعادة تقييم.</div> : (
                <table className="w-full text-sm"><thead className="border-b"><tr><th className="text-right py-2">التاريخ</th><th className="text-right py-2">القيمة العادلة</th><th className="text-right py-2">الطريقة</th><th className="text-right py-2">فائض</th><th className="text-right py-2">P&L</th></tr></thead>
                  <tbody>{data.revaluations.map((e) => (
                    <tr key={e.id} className="border-b">
                      <td className="py-1">{e.eventDate}</td>
                      <td className="py-1 tabular-nums">{fmt(e.fairValue)}</td>
                      <td className="py-1">{e.method}</td>
                      <td className="py-1 tabular-nums">{fmt(e.surplusDelta)}</td>
                      <td className="py-1 tabular-nums">{fmt(e.plImpact)}</td>
                    </tr>
                  ))}</tbody></table>
              )}
            </TabsContent>
            <TabsContent value="components" className="mt-4">
              {data.components.length === 0 ? <div className="text-sm text-muted-foreground">لا توجد مكونات.</div> : (
                <table className="w-full text-sm"><thead className="border-b"><tr><th className="text-right py-2">الاسم</th><th className="text-right py-2">التكلفة</th><th className="text-right py-2">العمر</th><th className="text-right py-2">الطريقة</th><th className="text-right py-2">مجمع الإهلاك</th></tr></thead>
                  <tbody>{data.components.map((c) => (
                    <tr key={c.id} className="border-b">
                      <td className="py-1">{c.name}</td>
                      <td className="py-1 tabular-nums">{fmt(c.cost)}</td>
                      <td className="py-1">{c.usefulLifeMonths} شهر</td>
                      <td className="py-1">{METHODS.find(m => m.value === c.method)?.label}</td>
                      <td className="py-1 tabular-nums">{fmt(c.accumDepreciation)}</td>
                    </tr>
                  ))}</tbody></table>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
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
  const { toast } = useToast();
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
    onError: (e: Error) => toast({ title: "تعذر المعاينة", description: e.message, variant: "destructive" }),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", url, buildPayload(true));
      return res.json() as Promise<{ journalEntryId: number }>;
    },
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fixed-assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      toast({ title: "تم الترحيل", description: `قيد رقم JE ${d.journalEntryId}` });
      onClose();
    },
    onError: (e: Error) => toast({ title: "فشل الترحيل", description: e.message, variant: "destructive" }),
  });

  const titles = { impairment: "إثبات انخفاض في القيمة (IAS 36)", revaluation: "إعادة تقييم (IAS 16)", dispose: "استبعاد الأصل" };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-lg" data-testid={`dialog-op-${type}`}>
        <DialogHeader>
          <DialogTitle>{titles[type]}</DialogTitle>
          <DialogDescription>راجع التأثير ثم اضغط ترحيل لإنشاء قيد محاسبي.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div><Label>التاريخ</Label><Input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} data-testid="input-op-date" /></div>
          {type === "impairment" && (
            <div><Label>القيمة الاستردادية</Label><Input type="number" value={form.recoverableAmount} onChange={(e) => setForm({ ...form, recoverableAmount: e.target.value })} data-testid="input-recoverable" /></div>
          )}
          {type === "revaluation" && (
            <>
              <div><Label>القيمة العادلة</Label><Input type="number" value={form.fairValue} onChange={(e) => setForm({ ...form, fairValue: e.target.value })} data-testid="input-fair-value" /></div>
              <div>
                <Label>طريقة إعادة التقييم</Label>
                <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v as "elimination" | "proportional" })}>
                  <SelectTrigger data-testid="select-reval-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="elimination">إلغاء مجمع الإهلاك</SelectItem>
                    <SelectItem value="proportional">إعادة بيان نسبية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          {type === "dispose" && (
            <>
              <div><Label>قيمة البيع / المتحصلات</Label><Input type="number" value={form.proceeds} onChange={(e) => setForm({ ...form, proceeds: e.target.value })} data-testid="input-proceeds" /></div>
              <div>
                <Label>الطريقة</Label>
                <Select value={form.disposalMethod} onValueChange={(v) => setForm({ ...form, disposalMethod: v as "sale" | "scrap" | "writeoff" })}>
                  <SelectTrigger data-testid="select-disposal-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sale">بيع</SelectItem>
                    <SelectItem value="scrap">تخريد</SelectItem>
                    <SelectItem value="writeoff">شطب</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div><Label>ملاحظات</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-op-notes" /></div>
          <Button variant="outline" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending} data-testid="button-preview-op">
            <Calculator className="w-4 h-4 ml-1" /> معاينة
          </Button>
          {preview && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1" data-testid="text-op-preview">
              {type === "impairment" && (() => { const p = preview as ImpairmentPreview; return (
                <>
                  <div>القيمة الدفترية الحالية: <span className="font-bold tabular-nums">{fmt(p.carrying, company.currencySymbol)}</span></div>
                  <div>القيمة الدفترية الافتراضية (بدون انخفاض): <span className="tabular-nums">{fmt(p.hypotheticalCarrying, company.currencySymbol)}</span></div>
                  <div>المبلغ: <span className={`font-bold tabular-nums ${p.isReversal ? "text-emerald-600" : "text-rose-600"}`}>{fmt(p.amount, company.currencySymbol)}</span> {p.isReversal && "(عكس مقيد بـ " + fmt(p.reversalCap, company.currencySymbol) + ")"}</div>
                  <div>القيمة الدفترية الجديدة: <span className="font-bold tabular-nums">{fmt(p.newCarrying, company.currencySymbol)}</span></div>
                </>
              ); })()}
              {type === "revaluation" && (() => { const p = preview as RevaluationPreview; return (
                <>
                  <div>التكلفة الإجمالية الجديدة: <span className="font-bold tabular-nums">{fmt(p.result.newGrossCost, company.currencySymbol)}</span></div>
                  <div>مجمع الإهلاك الجديد: <span className="font-bold tabular-nums">{fmt(p.result.newAccumDep, company.currencySymbol)}</span></div>
                  <div>مجمع الانخفاض الجديد: <span className="font-bold tabular-nums">{fmt(p.result.newAccumImp, company.currencySymbol)}</span></div>
                  <div>تغيّر الفائض (OCI): <span className="font-bold tabular-nums text-emerald-600">{fmt(p.result.surplusDelta, company.currencySymbol)}</span></div>
                  <div>تأثير الأرباح والخسائر: <span className={`font-bold tabular-nums ${p.result.plImpact >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(p.result.plImpact, company.currencySymbol)}</span></div>
                  {p.result.priorLossReversal > 0 && <div className="text-xs text-muted-foreground">يعكس خسارة P&L سابقة بمقدار {fmt(p.result.priorLossReversal, company.currencySymbol)}</div>}
                </>
              ); })()}
              {type === "dispose" && (() => { const p = preview as DisposalPreview; return (
                <>
                  <div>القيمة الدفترية: <span className="font-bold tabular-nums">{fmt(p.carrying, company.currencySymbol)}</span></div>
                  <div>الربح/الخسارة: <span className={`font-bold tabular-nums ${p.result.gainLoss >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(p.result.gainLoss, company.currencySymbol)}</span></div>
                  <div>تحويل فائض إعادة التقييم للأرباح المحتجزة: <span className="font-bold tabular-nums">{fmt(p.result.surplusTransferred, company.currencySymbol)}</span></div>
                </>
              ); })()}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending || !preview} data-testid="button-confirm-op">
            ترحيل القيد
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
  const { toast } = useToast();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [preview, setPreview] = useState<DepreciationPreview | null>(null);
  const [usage, setUsage] = useState<UsageEntry[]>([]);

  const { data: runs } = useQuery<DepreciationRunListItem[]>({
    queryKey: ["/api/depreciation-runs", company.id],
    queryFn: async () => (await fetch(`/api/depreciation-runs?companyId=${company.id}`)).json(),
  });

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
    onError: (e: Error) => toast({ title: "تعذر", description: e.message, variant: "destructive" }),
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
      toast({ title: "تم ترحيل قيد الإهلاك", description: `JE ${d.journalEntryId}` });
      setPreview(null);
      setUsage([]);
    },
    onError: (e: Error) => toast({ title: "فشل", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-lg">تشغيل الإهلاك الشهري</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div><Label>السنة</Label><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" data-testid="input-dep-year" /></div>
            <div><Label>الشهر</Label><Input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-20" data-testid="input-dep-month" /></div>
            <Button variant="outline" onClick={() => previewMut.mutate()} disabled={previewMut.isPending} data-testid="button-preview-dep">
              <Calculator className="w-4 h-4 ml-1" /> معاينة
            </Button>
            <Button onClick={() => postMut.mutate()} disabled={postMut.isPending || !preview} data-testid="button-post-dep">
              ترحيل قيد الإهلاك
            </Button>
          </div>
          {preview && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-2" data-testid="text-dep-preview">
              <div className="font-bold">إجمالي الإهلاك: {fmt(preview.total, company.currencySymbol)}</div>
              <div className="grid gap-1">
                {preview.byCategory.map((c) => (
                  <div key={c.categoryId} className="flex justify-between"><span>{c.categoryName}</span><span className="tabular-nums font-bold">{fmt(c.amount, company.currencySymbol)}</span></div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">{preview.postings.length} بند مفصّل</div>
              {preview.needsUsage.length > 0 && (
                <div className="border-t pt-2 mt-2 space-y-2">
                  <div className="text-amber-700 dark:text-amber-400 font-semibold text-xs">أصول وحدات الإنتاج تحتاج إدخال وحدات الفترة:</div>
                  {preview.needsUsage.map((n) => {
                    const cur = usage.find((u) => u.assetId === n.assetId && u.componentId === n.componentId);
                    return (
                      <div key={`${n.assetId}-${n.componentId ?? "x"}`} className="flex items-center justify-between gap-3">
                        <span className="text-xs">{n.assetName}</span>
                        <Input type="number" min={0} className="w-32 h-8" placeholder="عدد الوحدات"
                          value={cur?.units ?? ""}
                          onChange={(e) => setUsageUnits(n.assetId, n.componentId, Number(e.target.value || 0))}
                          data-testid={`input-usage-${n.assetId}-${n.componentId ?? "asset"}`}
                        />
                      </div>
                    );
                  })}
                  <Button size="sm" variant="outline" onClick={() => previewMut.mutate()} data-testid="button-recalc-usage">إعادة المعاينة بعد إدخال الوحدات</Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">سجل تشغيلات الإهلاك</CardTitle></CardHeader>
        <CardContent>
          {!runs || runs.length === 0 ? <div className="text-sm text-muted-foreground">لا توجد تشغيلات بعد.</div> : (
            <table className="w-full text-sm">
              <thead className="border-b text-muted-foreground"><tr><th className="text-right py-2">الفترة</th><th className="text-right py-2">الإجمالي</th><th className="text-right py-2">الحالة</th><th className="text-right py-2">القيد</th></tr></thead>
              <tbody>{runs.map((r) => (
                <tr key={r.id} className="border-b" data-testid={`row-run-${r.id}`}>
                  <td className="py-2">{r.year}-{String(r.month).padStart(2, "0")}</td>
                  <td className="py-2 tabular-nums">{fmt(r.totalAmount, company.currencySymbol)}</td>
                  <td className="py-2"><Badge variant={r.status === "posted" ? "default" : "secondary"}>{r.status}</Badge></td>
                  <td className="py-2">{r.journalEntryId ? `JE ${r.journalEntryId}` : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
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
      toast({ title: "تم إضافة التصنيف" });
      setOpen(false);
    },
    onError: (e: Error) => toast({ title: "فشل", description: e.message, variant: "destructive" }),
  });

  const accSelect = (label: string, key: keyof CategoryFormState) => (
    <div>
      <Label>{label}</Label>
      <Select value={form[key]} onValueChange={(v) => setForm({ ...form, [key]: v })}>
        <SelectTrigger data-testid={`select-cat-${String(key)}`}><SelectValue placeholder="اختر حساب" /></SelectTrigger>
        <SelectContent>{(accounts || []).filter((a) => !a.isHeader).map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.nameAr}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">تصنيفات الأصول</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="button-add-category"><Plus className="w-4 h-4 ml-1" /> إضافة تصنيف</Button></DialogTrigger>
          <DialogContent dir="rtl" className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>تصنيف أصول جديد</DialogTitle>
              <DialogDescription>اربط الحسابات المحاسبية لهذا التصنيف.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>الاسم</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-cat-name" /></div>
                <div>
                  <Label>نموذج القياس</Label>
                  <Select value={form.measurementModel} onValueChange={(v) => setForm({ ...form, measurementModel: v as "cost" | "revaluation" })}>
                    <SelectTrigger data-testid="select-cat-model"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cost">التكلفة</SelectItem>
                      <SelectItem value="revaluation">إعادة التقييم</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>العمر الافتراضي (شهر)</Label><Input type="number" value={form.defaultUsefulLifeMonths} onChange={(e) => setForm({ ...form, defaultUsefulLifeMonths: e.target.value })} data-testid="input-cat-life" /></div>
                <div>
                  <Label>الطريقة الافتراضية</Label>
                  <Select value={form.defaultMethod} onValueChange={(v) => setForm({ ...form, defaultMethod: v as DepreciationMethod })}>
                    <SelectTrigger data-testid="select-cat-method"><SelectValue /></SelectTrigger>
                    <SelectContent>{METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {accSelect("حساب تكلفة الأصل", "assetCostAccountId")}
                {accSelect("حساب مجمع الإهلاك", "accumulatedDepAccountId")}
                {accSelect("حساب مصروف الإهلاك", "depExpenseAccountId")}
                {accSelect("حساب مجمع الانخفاض", "accumulatedImpAccountId")}
                {accSelect("حساب خسائر الانخفاض", "impLossAccountId")}
                {accSelect("حساب فائض إعادة التقييم", "revalSurplusAccountId")}
                {accSelect("حساب أرباح/خسائر الاستبعاد", "gainLossDisposalAccountId")}
              </div>
            </div>
            <DialogFooter><Button onClick={() => m.mutate()} disabled={m.isPending || !form.name} data-testid="button-save-category">حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {!cats || cats.length === 0 ? <div className="text-sm text-muted-foreground">لا توجد تصنيفات.</div> : (
          <table className="w-full text-sm">
            <thead className="border-b text-muted-foreground"><tr><th className="text-right py-2">الاسم</th><th className="text-right py-2">النموذج</th><th className="text-right py-2">العمر</th><th className="text-right py-2">الطريقة</th></tr></thead>
            <tbody>{cats.map((c) => (
              <tr key={c.id} className="border-b" data-testid={`row-category-${c.id}`}>
                <td className="py-2">{c.name}</td>
                <td className="py-2">{c.measurementModel === "cost" ? "التكلفة" : "إعادة التقييم"}</td>
                <td className="py-2">{c.defaultUsefulLifeMonths} شهر</td>
                <td className="py-2">{METHODS.find((m) => m.value === c.defaultMethod)?.label}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Companies
// ============================================================================

export function CompaniesPanel() {
  const { toast } = useToast();
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", functionalCurrency: "USD", currencySymbol: "$", isDefault: false });

  const m = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/companies", form)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "تم إضافة الشركة" });
      setOpen(false);
    },
    onError: (e: Error) => toast({ title: "فشل", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">الشركات</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="button-add-company"><Plus className="w-4 h-4 ml-1" /> إضافة شركة</Button></DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>شركة جديدة</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div><Label>الاسم</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-company-name" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>العملة الوظيفية</Label><Input value={form.functionalCurrency} onChange={(e) => setForm({ ...form, functionalCurrency: e.target.value.toUpperCase() })} data-testid="input-company-currency" /></div>
                <div><Label>الرمز</Label><Input value={form.currencySymbol} onChange={(e) => setForm({ ...form, currencySymbol: e.target.value })} data-testid="input-company-symbol" /></div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} data-testid="checkbox-company-default" />
                تعيين كشركة افتراضية
              </label>
            </div>
            <DialogFooter><Button onClick={() => m.mutate()} disabled={m.isPending || !form.name} data-testid="button-save-company">حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead className="border-b text-muted-foreground"><tr><th className="text-right py-2">الاسم</th><th className="text-right py-2">العملة</th><th className="text-right py-2">افتراضية</th></tr></thead>
          <tbody>{(companies || []).map((c) => (
            <tr key={c.id} className="border-b" data-testid={`row-company-${c.id}`}>
              <td className="py-2">{c.name}</td>
              <td className="py-2">{c.functionalCurrency} ({c.currencySymbol})</td>
              <td className="py-2">{c.isDefault ? <Badge>افتراضية</Badge> : "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// FX Rates
// ============================================================================

export function FxPanel({ company }: { company: Company }) {
  const { toast } = useToast();
  const { data: rates } = useQuery<FxRate[]>({
    queryKey: ["/api/fx-rates", company.id],
    queryFn: async () => (await fetch(`/api/fx-rates?companyId=${company.id}`)).json(),
  });
  const [form, setForm] = useState({ fromCurrency: "EUR", toCurrency: company.functionalCurrency, rateDate: new Date().toISOString().slice(0, 10), rate: "1" });

  useEffect(() => { setForm((f) => ({ ...f, toCurrency: company.functionalCurrency })); }, [company]);

  const m = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/fx-rates", { companyId: company.id, ...form, rate: Number(form.rate) })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/fx-rates"] }); toast({ title: "تم حفظ السعر" }); },
    onError: (e: Error) => toast({ title: "فشل", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/fx-rates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/fx-rates"] }),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">أسعار الصرف ({company.functionalCurrency})</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-5 gap-2 items-end">
          <div><Label>من</Label><Input value={form.fromCurrency} onChange={(e) => setForm({ ...form, fromCurrency: e.target.value.toUpperCase() })} data-testid="input-fx-from" /></div>
          <div><Label>إلى</Label><Input value={form.toCurrency} onChange={(e) => setForm({ ...form, toCurrency: e.target.value.toUpperCase() })} data-testid="input-fx-to" /></div>
          <div><Label>التاريخ</Label><Input type="date" value={form.rateDate} onChange={(e) => setForm({ ...form, rateDate: e.target.value })} data-testid="input-fx-date" /></div>
          <div><Label>السعر</Label><Input type="number" step="0.0001" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} data-testid="input-fx-rate-value" /></div>
          <Button onClick={() => m.mutate()} disabled={m.isPending} data-testid="button-save-fx"><Plus className="w-4 h-4 ml-1" /> إضافة</Button>
        </div>
        {!rates || rates.length === 0 ? <div className="text-sm text-muted-foreground">لا توجد أسعار صرف.</div> : (
          <table className="w-full text-sm">
            <thead className="border-b text-muted-foreground"><tr><th className="text-right py-2">التاريخ</th><th className="text-right py-2">من</th><th className="text-right py-2">إلى</th><th className="text-right py-2">السعر</th><th /></tr></thead>
            <tbody>{rates.map((r) => (
              <tr key={r.id} className="border-b" data-testid={`row-fx-${r.id}`}>
                <td className="py-2">{r.rateDate}</td>
                <td className="py-2">{r.fromCurrency}</td>
                <td className="py-2">{r.toCurrency}</td>
                <td className="py-2 tabular-nums">{r.rate}</td>
                <td className="py-2"><Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)} data-testid={`button-delete-fx-${r.id}`}><Trash2 className="w-4 h-4 text-rose-600" /></Button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
