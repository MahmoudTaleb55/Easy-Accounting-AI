import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings as SettingsIcon, Save, Globe, Building2, Users, User as UserIcon, ChevronRight } from "lucide-react";
import type { OrgSettings } from "@/lib/format";
import { CompaniesPanel, FxPanel } from "@/pages/fixed-assets";
import { useCompany } from "@/contexts/company-context";
import { SecurityCompliance } from "@/components/trust/security-compliance";
import { TeamPanel } from "@/components/team/team-panel";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/contexts/locale-context";

interface LocalizationPack {
  code: string;
  nameAr: string;
  defaultCurrencyCode: string;
  defaultCurrencySymbol: string;
  defaultVatRate: number;
  zakatApplicable: boolean;
}

const formSchema = z.object({
  orgName: z.string().min(1, "اسم المنشأة مطلوب"),
  countryCode: z.string(),
  locale: z.enum(["ar", "en"]),
  currencyCode: z.string().min(1),
  currencySymbol: z.string().min(1),
  vatRate: z.coerce.number().min(0).max(99),
  zakatEnabled: z.boolean(),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
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

export default function SettingsPage() {
  const { toast } = useToast();
  const { data: settings } = useQuery<OrgSettings>({ queryKey: ["/api/settings"] });
  const { data: packs } = useQuery<LocalizationPack[]>({ queryKey: ["/api/localization/packs"] });
  const { activeCompany } = useCompany();

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
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        orgName: settings.orgName,
        countryCode: settings.countryCode,
        locale: settings.locale,
        currencyCode: settings.currencyCode,
        currencySymbol: settings.currencySymbol,
        vatRate: Number(settings.vatRate) * 100, // store as % in form
        zakatEnabled: settings.zakatEnabled,
        fiscalYearStartMonth: settings.fiscalYearStartMonth,
      });
    }
  }, [settings, form]);

  const mutation = useMutation({
    mutationFn: async (vals: FormVals) =>
      await apiRequest("PATCH", "/api/settings", { ...vals, vatRate: vals.vatRate / 100 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
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

          <Button type="submit" size="lg" disabled={mutation.isPending} data-testid="button-save-settings">
            <Save className="w-4 h-4 ml-2" />
            {mutation.isPending ? "جاري الحفظ..." : "حفظ الإعدادات"}
          </Button>
        </form>
      </Form>

      <Card data-testid="card-settings-companies">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5" />الشركات (متعدد الكيانات)</CardTitle>
        </CardHeader>
        <CardContent>
          <CompaniesPanel />
        </CardContent>
      </Card>

      <TeamPanel />

      <SecurityCompliance />

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
    </div>
  );
}
