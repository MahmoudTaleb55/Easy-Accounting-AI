import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ApiError, apiRequest, queryClient, invalidateAccountBalances } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Settings as SettingsIcon, Save, Globe, Building2, Users, User as UserIcon, ChevronRight, MailCheck, Wrench, CheckCircle2, QrCode } from "lucide-react";
import { api } from "@shared/routes";
import type { OrgSettings } from "@/lib/format";
import { savePublicCurrency } from "@/lib/public-currency";
import { CompaniesPanel, FxPanel } from "@/pages/fixed-assets";
import { useCompany } from "@/contexts/company-context";
import { SecurityCompliance } from "@/components/trust/security-compliance";
import { TeamPanel } from "@/components/team/team-panel";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/contexts/locale-context";
import { OwnerGuard, OwnerOnly } from "@/components/auth/write-guard";
import { EmptyState } from "@/components/feedback/empty-state";

interface LocalizationPack {
  code: string;
  nameAr: string;
  defaultCurrencyCode: string;
  defaultCurrencySymbol: string;
  defaultVatRate: number;
  zakatApplicable: boolean;
}

const formSchema = z.object({
  orgName: z.string().min(1, "اسم المنشأة مطلوب").max(100, "اسم المنشأة طويل جداً (حد أقصى 100 حرف)"),
  countryCode: z.string().min(2, "اختر الدولة").max(8),
  locale: z.enum(["ar", "en", "de", "fr"]),
  currencyCode: z.string().min(1, "أدخل رمز العملة"),
  currencySymbol: z.string().min(1, "أدخل الرمز الظاهر للعملة"),
  vatRate: z.coerce.number({ invalid_type_error: "أدخل رقماً صحيحاً" }).min(0, "لا يمكن أن تكون النسبة سالبة").max(99, "النسبة كبيرة جداً"),
  zakatEnabled: z.boolean(),
  fiscalYearStartMonth: z.coerce.number({ invalid_type_error: "أدخل رقم شهر بين 1 و 12" }).int("يجب أن يكون رقم شهر صحيح").min(1, "الشهر بين 1 و 12").max(12, "الشهر بين 1 و 12"),
  businessType: z.enum(["service", "trading", "manufacturing"]),
});
type FormVals = z.infer<typeof formSchema>;

function SettingsSubpagesNav() {
  const { can } = useAuth();
  const { locale } = useLocale();
  const ar = locale === "ar";
  const items = [
    {
      href: "/app/settings/profile",
      icon: UserIcon,
      title: ar ? "الملف الشخصي" : "Profile",
      desc: ar ? "اسمك وكلمة المرور وتفضيلاتك." : "Your name, password and preferences.",
      testid: "link-settings-profile",
    },
    ...(can.view
      ? [
          {
            href: "/app/settings/members",
            icon: Users,
            title: ar ? "الأعضاء والصلاحيات" : "Members & roles",
            desc: ar
              ? can.invite
                ? "ادعُ الفريق وحدّد الأدوار."
                : "اعرض أعضاء مساحة العمل."
              : can.invite
              ? "Invite teammates and set roles."
              : "View workspace members.",
            testid: "link-settings-members",
          },
        ]
      : []),
    ...(can.manageMembers
      ? [
          {
            href: "/app/settings/email-delivery",
            icon: MailCheck,
            title: ar ? "صحة بريد المعاملات" : "Email delivery health",
            desc: ar
              ? "كل دعوات الفريق ورسائل استعادة كلمة المرور وحالاتها."
              : "Every team invitation and password-reset email and its status.",
            testid: "link-settings-email-delivery",
          },
          {
            href: "/app/settings/zatca",
            icon: QrCode,
            title: ar ? "الفوترة الإلكترونية ZATCA" : "ZATCA e-invoicing",
            desc: ar
              ? "ربط منظومة الفوترة الإلكترونية مع هيئة الزكاة والضريبة."
              : "Connect with Saudi Arabia's e-invoicing authority.",
            testid: "link-settings-zatca",
          },
        ]
      : []),
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="settings-nav">
      {items.map((it) => (
        <Link key={it.href} href={it.href}>
          <a
            data-testid={it.testid}
            className="group flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/40"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="rounded-md bg-primary/10 p-2">
                <it.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{it.title}</div>
                <div className="truncate text-xs text-muted-foreground">{it.desc}</div>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-foreground" />
          </a>
        </Link>
      ))}
    </div>
  );
}

interface BackfillLastRun {
  actor: string | null;
  source: string;
  occurredAt: string;
  created: number;
  skipped: number;
  triggeredVia: "admin-route" | "boot";
}

function DataToolsCard() {
  const { toast } = useToast();
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [lastResult, setLastResult] = useState<{ created: number; skipped: number } | null>(null);

  // Last-run audit row drives the "Last run by <owner> on <date>" line
  // under the Re-pair card so admins arriving at /app/settings can see
  // whether a co-owner has already fixed the books — task #236. Returns
  // `{ lastRun: null }` when the recovery action has never been recorded
  // for this workspace, in which case we skip the line entirely.
  const { data: lastRunData } = useQuery<{ lastRun: BackfillLastRun | null }>({
    queryKey: [api.admin.backfillJournalEntriesLastRun.path],
  });
  const lastRun = lastRunData?.lastRun ?? null;

  // Read-only count of transactions that are missing a journal entry. Loaded
  // on mount so the card and the confirm dialog can both promise an exact
  // number ("3 transactions are missing journal entries") instead of leaving
  // the owner guessing whether they're about to fix 0, 4, or 4,000 rows.
  // The query key matches the route path so the default fetcher hits the
  // right URL; we pin staleTime to 0 so a re-mount after a backfill always
  // refetches the fresh count (the mutation also invalidates this key
  // explicitly).
  const previewQuery = useQuery<{ count: number }>({
    queryKey: [api.admin.backfillJournalEntriesPreview.path],
    staleTime: 0,
  });
  const missingCount = previewQuery.data?.count;
  const hasZero = missingCount === 0;

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        api.admin.backfillJournalEntries.method,
        api.admin.backfillJournalEntries.path,
        {},
      );
      return (await res.json()) as { created: number; skipped: number };
    },
    onSuccess: (data) => {
      setLastResult(data);
      // The journal entries page caches its list; invalidate so any newly
      // posted entries from the backfill show up immediately if the user
      // navigates there. The chart-of-accounts trailing balances cache is
      // similarly stale after a backfill — invalidate it for every period
      // so /app/accounts reflects the new GL on the next visit. The count
      // preview is also stale (the backlog just shrank), so refetch it so
      // the card flips to the "Everything is in sync" state without a
      // manual reload.
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      queryClient.invalidateQueries({
        queryKey: [api.admin.backfillJournalEntriesPreview.path],
      });
      invalidateAccountBalances();
      // Refresh the "Last run by …" line so the row this owner just
      // wrote shows up under the card without a manual reload (task #236).
      queryClient.invalidateQueries({
        queryKey: [api.admin.backfillJournalEntriesLastRun.path],
      });
      toast({
        title: ar ? "تمّ الإصلاح" : "Done",
        description: ar
          ? `أُنشئ ${data.created} قيد يومية، وتُخطّي ${data.skipped}.`
          : `Created ${data.created} journal entries, skipped ${data.skipped}.`,
      });
    },
    onError: (e: unknown) => {
      // The endpoint can fail with a 403 (role drift between page load and
      // click), a 500 (e.g. cash account missing), or a generic network
      // error. ApiError preserves the parsed JSON `{ message }` body the
      // server returns; fall back to the Error message for non-HTTP failures.
      const fromApi =
        e instanceof ApiError && typeof (e.body as { message?: unknown })?.message === "string"
          ? ((e.body as { message: string }).message)
          : undefined;
      const fromError = e instanceof Error ? e.message : undefined;
      toast({
        title: ar ? "خطأ" : "Error",
        description:
          fromApi || fromError || (ar ? "تعذّر استكمال قيود اليومية" : "Backfill failed"),
        variant: "destructive",
      });
    },
  });

  return (
    <Card data-testid="card-settings-data-tools">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="w-5 h-5" />
          {ar ? "أدوات البيانات (للمالك فقط)" : "Data tools (owner only)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {ar
            ? "إجراءات استرجاع نادرة. استخدمها فقط إذا لاحظت قيوداً مفقودة."
            : "Rare recovery actions. Only use these if you notice missing journal entries."}
        </p>
        <div className="rounded-md border p-4 space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium" data-testid="text-repair-journal-entries-title">
              {ar
                ? "إعادة ربط قيود اليومية المفقودة"
                : "Re-pair missing journal entries"}
            </div>
            <div className="text-xs text-muted-foreground">
              {ar
                ? "تفحّص جميع المعاملات في مساحة العمل وتُنشئ قيد يومية متوازن لكل معاملة لا قيد لها. تكرار التشغيل آمن."
                : "Walks every transaction in this workspace and posts a balanced double-entry for any one missing its journal entry. Safe to re-run."}
            </div>
          </div>
          {/*
            Live count of orphan transactions, loaded on mount so the owner
            sees up front whether the action is a no-op or a meaningful
            cleanup. Three visible states:
              - loading            → muted skeleton-ish line
              - count > 0          → "N transactions are missing journal entries"
              - count === 0        → green "Everything is in sync" indicator,
                                     and the button below is disabled
            On error we render nothing here and let the button stay enabled
            with its generic copy, so a transient preview failure never
            blocks the recovery action itself.
           */}
          {previewQuery.isLoading ? (
            <div
              className="text-sm text-muted-foreground"
              data-testid="text-repair-journal-entries-count-loading"
            >
              {ar ? "جارٍ حساب القيود المفقودة..." : "Counting missing entries..."}
            </div>
          ) : hasZero ? (
            <div
              className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"
              data-testid="status-repair-journal-entries-in-sync"
            >
              <CheckCircle2 className="w-4 h-4" />
              {ar ? "كل شيء متزامن — لا توجد قيود مفقودة." : "Everything is in sync — no missing entries."}
            </div>
          ) : missingCount !== undefined ? (
            <div
              className="text-sm text-foreground"
              data-testid="text-repair-journal-entries-count"
            >
              {ar
                ? `${missingCount} معاملة بدون قيد يومية.`
                : `${missingCount} ${missingCount === 1 ? "transaction is" : "transactions are"} missing journal entries.`}
            </div>
          ) : null}
          <div className="flex items-center gap-3 flex-wrap">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={mutation.isPending || hasZero}
                  data-testid="button-repair-journal-entries"
                >
                  {mutation.isPending
                    ? ar
                      ? "جارٍ التشغيل..."
                      : "Running..."
                    : ar
                      ? "إعادة الربط الآن"
                      : "Re-pair now"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {ar ? "تأكيد إعادة ربط القيود" : "Confirm re-pair"}
                  </AlertDialogTitle>
                  <AlertDialogDescription data-testid="text-repair-journal-entries-confirm">
                    {missingCount !== undefined
                      ? ar
                        ? `سيتم إنشاء ${missingCount} قيد يومية — هل تريد المتابعة؟`
                        : `This will create ${missingCount} journal ${missingCount === 1 ? "entry" : "entries"} — continue?`
                      : ar
                        ? "ستُنشأ قيود يومية لأي معاملة في مساحة العمل لا قيد لها. تكرار التشغيل لا يُكرّر القيود."
                        : "Journal entries will be created for any transaction in this workspace that is missing one. Running again does not duplicate entries."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-repair-journal-entries">
                    {ar ? "إلغاء" : "Cancel"}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => mutation.mutate()}
                    data-testid="button-confirm-repair-journal-entries"
                  >
                    {ar ? "متابعة" : "Continue"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {lastResult && (
              <div
                className="text-sm text-foreground"
                data-testid="text-repair-journal-entries-result"
              >
                {ar
                  ? `أُنشئ ${lastResult.created} قيد يومية، وتُخطّي ${lastResult.skipped}.`
                  : `Created ${lastResult.created} journal entries, skipped ${lastResult.skipped}.`}
              </div>
            )}
            {lastRun && (
              // "Last run by <owner> on <date>" line — task #236. Surfaces the
              // most recent recovery so a co-owner arriving at the page can
              // see whether the books have already been re-paired today.
              // Formatted with `Intl.DateTimeFormat` to avoid pulling
              // date-fns into this card just for a single line. Falls back
              // to "system" when the row was written by the boot sweep
              // (no actor on the audit row).
              <div
                className="text-xs text-muted-foreground"
                data-testid="text-repair-journal-entries-last-run"
              >
                {(() => {
                  const actor =
                    lastRun.actor ?? (ar ? "النظام" : "the system");
                  const when = new Intl.DateTimeFormat(
                    ar ? "ar" : "en",
                    {
                      dateStyle: "medium",
                      timeStyle: "short",
                    },
                  ).format(new Date(lastRun.occurredAt));
                  return ar
                    ? `آخر إصلاح بواسطة ${actor} في ${when}`
                    : `Last run by ${actor} on ${when}`;
                })()}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { toast } = useToast();
  const { data: settings } = useQuery<OrgSettings>({ queryKey: ["/api/settings"] });
  const { data: packs } = useQuery<LocalizationPack[]>({ queryKey: ["/api/localization/packs"] });
  const { activeCompany } = useCompany();
  const { setLocale } = useLocale();

  const form = useForm<FormVals>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      orgName: "My Business",
      countryCode: "INTL",
      locale: "ar",
      currencyCode: "USD",
      currencySymbol: "$",
      vatRate: 0,
      zakatEnabled: false,
      fiscalYearStartMonth: 1,
      businessType: "service",
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        orgName: settings.orgName,
        countryCode: settings.countryCode,
        locale: (["ar", "en", "de", "fr"] as const).includes(settings.locale as any)
          ? (settings.locale as "ar" | "en" | "de" | "fr")
          : "ar",
        currencyCode: settings.currencyCode,
        currencySymbol: settings.currencySymbol,
        vatRate: Number(settings.vatRate) * 100, // store as % in form
        zakatEnabled: settings.zakatEnabled,
        fiscalYearStartMonth: settings.fiscalYearStartMonth,
        businessType: ((["service", "trading", "manufacturing"] as const) as readonly string[]).includes(
          settings.businessType,
        )
          ? (settings.businessType as "service" | "trading" | "manufacturing")
          : "service",
      });
    }
  }, [settings, form]);

  const mutation = useMutation({
    mutationFn: async (vals: FormVals) =>
      await apiRequest("PATCH", "/api/settings", { ...vals, vatRate: vals.vatRate / 100 }),
    onSuccess: (_data, vals) => {
      setLocale(vals.locale);
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      // The currency is also stored on the active company record (used by Fixed
      // Assets, the workspace switcher, and the command palette), so refetch
      // those so the new currency shows up everywhere immediately.
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/memberships"] });
      // Mirror the saved currency to localStorage so the public landing page
      // (which has no auth context and can't read /api/settings) reflects
      // the user's choice next time they visit while signed out.
      savePublicCurrency({ code: vals.currencyCode, symbol: vals.currencySymbol });
      toast({ title: "تم الحفظ", description: "تم تحديث الإعدادات بنجاح" });
    },
    onError: (e: any) => toast({ title: "خطأ", description: e?.message || "فشل الحفظ", variant: "destructive" }),
  });

  function applyPack(code: string) {
    const p = packs?.find((x) => x.code === code);
    if (!p) return;
    form.setValue("countryCode", p.code);
    form.setValue("currencyCode", p.defaultCurrencyCode);
    form.setValue("currencySymbol", p.defaultCurrencySymbol);
    form.setValue("vatRate", p.defaultVatRate * 100);
    form.setValue("zakatEnabled", p.zakatApplicable);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8" data-testid="settings-page">
      <header className="space-y-2">
        <div className="eyebrow text-muted-foreground/80">الإعدادات</div>
        <h1
          className="font-display text-3xl md:text-4xl tracking-tight text-foreground"
          data-testid="text-page-title"
        >
          إعدادات المنشأة
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          الموقع، العملة، الضرائب، والكيانات — كل ما يحدد سلوك دفاترك في مكان واحد.
        </p>
      </header>

      <SettingsSubpagesNav />

      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Globe className="w-5 h-5" />الموقع والعملة</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="orgName" render={({ field }) => (
                <FormItem>
                  <FormLabel>اسم المنشأة</FormLabel>
                  <FormControl><Input {...field} data-testid="input-org-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="countryCode" render={({ field }) => (
                <FormItem>
                  <FormLabel>الدولة (تطبق إعدادات افتراضية تلقائياً)</FormLabel>
                  <Select value={field.value} onValueChange={(v) => { field.onChange(v); applyPack(v); }}>
                    <FormControl><SelectTrigger data-testid="select-country"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {packs?.map((p) => (
                        <SelectItem key={p.code} value={p.code}>{p.nameAr}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>اختيار الدولة يضبط العملة وضريبة القيمة المضافة وقواعد العمل افتراضياً، ويمكنك تعديلها يدوياً بعدها.</FormDescription>
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="currencyCode" render={({ field }) => (
                  <FormItem><FormLabel>رمز العملة</FormLabel>
                    <FormControl><Input {...field} data-testid="input-currency-code" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="currencySymbol" render={({ field }) => (
                  <FormItem><FormLabel>رمز الظاهر</FormLabel>
                    <FormControl><Input {...field} data-testid="input-currency-symbol" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>

              <FormField control={form.control} name="locale" render={({ field }) => (
                <FormItem>
                  <FormLabel>لغة العرض</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger data-testid="select-locale"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="ar">العربية</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="de">Deutsch (الألمانية)</SelectItem>
                      <SelectItem value="fr">Français (الفرنسية)</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>الضرائب والزكاة</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="vatRate" render={({ field }) => (
                <FormItem>
                  <FormLabel>نسبة ضريبة القيمة المضافة (%)</FormLabel>
                  <FormControl><Input type="number" step="0.5" {...field} data-testid="input-vat-rate" /></FormControl>
                  <FormDescription>اضبطها على 0 لتعطيل الضريبة في تقدير الضرائب.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="zakatEnabled" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <FormLabel>تفعيل تقدير الزكاة</FormLabel>
                    <FormDescription>يظهر تقدير الزكاة في مركز القرارات.</FormDescription>
                  </div>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-zakat" /></FormControl>
                </FormItem>
              )} />

              <FormField control={form.control} name="fiscalYearStartMonth" render={({ field }) => (
                <FormItem>
                  <FormLabel>أول شهر في السنة المالية</FormLabel>
                  <FormControl><Input type="number" min="1" max="12" {...field} data-testid="input-fiscal-month" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                نوع النشاط
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="businessType" render={({ field }) => (
                <FormItem>
                  <FormLabel>نوع المنشأة</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="select-business-type">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="service" data-testid="option-business-type-service">
                        شركة خدمات (بدون تكلفة بضائع مباعة)
                      </SelectItem>
                      <SelectItem value="trading" data-testid="option-business-type-trading">
                        شركة تجارية (تشمل تكلفة البضائع المباعة)
                      </SelectItem>
                      <SelectItem value="manufacturing" data-testid="option-business-type-manufacturing">
                        شركة تصنيع (تشمل تكلفة البضائع المباعة)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    شركات الخدمات لا يظهر فيها قسم "تكلفة البضائع المباعة" في قائمة الدخل، بينما تظهر تلقائياً للشركات التجارية والصناعية.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <OwnerGuard forceDisabled={mutation.isPending}>
            <Button type="submit" size="lg" data-testid="button-save-settings">
              <Save className="w-4 h-4 ml-2" />
              {mutation.isPending ? "جاري الحفظ..." : "حفظ الإعدادات"}
            </Button>
          </OwnerGuard>
        </form>
      </Form>

      <OwnerOnly
        fallback={
          <EmptyState
            icon={<Building2 className="w-5 h-5" />}
            title="الشركات وأسعار الصرف يديرها المالك"
            description="يستطيع مالك مساحة العمل فقط إضافة الشركات وضبط أسعار الصرف. تواصل معه إن احتجت تغييراً هنا."
            testId="empty-owner-only-companies-fx"
          />
        }
      >
        <Card data-testid="card-settings-companies">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5" />الشركات (متعدد الكيانات)</CardTitle>
          </CardHeader>
          <CardContent>
            <CompaniesPanel />
          </CardContent>
        </Card>
      </OwnerOnly>

      <TeamPanel />

      <SecurityCompliance />

      <OwnerOnly>
        <Card data-testid="card-settings-fx">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Globe className="w-5 h-5" />أسعار الصرف</CardTitle>
          </CardHeader>
          <CardContent>
            {activeCompany ? (
              <FxPanel company={activeCompany} />
            ) : (
              <div className="text-sm text-muted-foreground">لا توجد شركة نشطة. أضف شركة أولاً ثم اخترها من شريط العلوي.</div>
            )}
          </CardContent>
        </Card>
      </OwnerOnly>

      <OwnerOnly>
        <DataToolsCard />
      </OwnerOnly>
    </div>
  );
}
