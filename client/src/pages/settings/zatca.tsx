import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertZatcaConfigSchema, type ZatcaConfig } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocale } from "@/contexts/locale-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Zap, CheckCircle2, AlertCircle, QrCode } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { z } from "zod";

const formSchema = insertZatcaConfigSchema.extend({
  vatNumber: z.string()
    .min(15, "رقم ضريبة القيمة المضافة يجب أن يكون 15 رقماً")
    .max(15, "رقم ضريبة القيمة المضافة يجب أن يكون 15 رقماً")
    .regex(/^\d+$/, "يجب أن يحتوي على أرقام فقط"),
});
type FormValues = z.infer<typeof formSchema>;

export default function ZatcaSettingsPage() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const { toast } = useToast();
  const { can } = useAuth();

  const { data: config, isLoading } = useQuery<ZatcaConfig | null>({
    queryKey: ["/api/zatca/config"],
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      vatNumber: config?.vatNumber ?? "",
      sellerNameAr: config?.sellerNameAr ?? "",
      sellerNameEn: config?.sellerNameEn ?? "",
      cityAr: config?.cityAr ?? "الرياض",
      cityEn: config?.cityEn ?? "Riyadh",
      environment: config?.environment ?? "sandbox",
      isActive: config?.isActive ?? true,
    },
    values: config
      ? {
          vatNumber: config.vatNumber,
          sellerNameAr: config.sellerNameAr,
          sellerNameEn: config.sellerNameEn,
          cityAr: config.cityAr,
          cityEn: config.cityEn,
          environment: config.environment,
          isActive: config.isActive,
        }
      : undefined,
  });

  const saveMutation = useMutation({
    mutationFn: (data: FormValues) => apiRequest("POST", "/api/zatca/config", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/zatca/config"] });
      toast({ title: ar ? "تم حفظ إعدادات ZATCA" : "ZATCA settings saved" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/zatca/config"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/zatca/config"] });
      toast({ title: ar ? "تم إلغاء تفعيل ZATCA" : "ZATCA deactivated" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isConfigured = config && config.isActive;

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2" data-testid="text-page-title">
            <QrCode className="h-5 w-5 text-primary" />
            {ar ? "الفوترة الإلكترونية (ZATCA)" : "E-invoicing (ZATCA)"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {ar
              ? "تفعيل الفوترة الإلكترونية وفق متطلبات هيئة الزكاة والضريبة والجمارك — المرحلة الثانية"
              : "Activate e-invoicing per ZATCA Phase 2 requirements"}
          </p>
        </div>
        {isConfigured ? (
          <Badge className="bg-success/10 text-success border-success/20 gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {ar ? "مفعّل" : "Active"}
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <AlertCircle className="h-3 w-3" />
            {ar ? "غير مفعّل" : "Inactive"}
          </Badge>
        )}
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          {
            icon: QrCode,
            titleAr: "رمز QR على الفواتير",
            titleEn: "QR on invoices",
            descAr: "يُضاف رمز QR مشفر ZATCA على كل فاتورة مطبوعة",
            descEn: "ZATCA TLV-encoded QR added to every printed invoice",
          },
          {
            icon: CheckCircle2,
            titleAr: "امتثال المرحلة الثانية",
            titleEn: "Phase 2 compliant",
            descAr: "يلتزم بمعايير ZATCA الإلزامية للفوترة الإلكترونية",
            descEn: "Complies with ZATCA mandatory e-invoicing standards",
          },
          {
            icon: Zap,
            titleAr: "ترحيل فوري للضريبة",
            titleEn: "Instant VAT posting",
            descAr: "قيود VAT صحيحة وفق IFRS عند إصدار كل فاتورة",
            descEn: "Correct IFRS VAT entries on every invoice issuance",
          },
        ].map((c) => (
          <div key={c.titleEn} className="border border-border rounded-lg p-3 space-y-1">
            <c.icon className="h-4 w-4 text-primary" />
            <p className="text-xs font-medium">{ar ? c.titleAr : c.titleEn}</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{ar ? c.descAr : c.descEn}</p>
          </div>
        ))}
      </div>

      {/* Configuration form */}
      <div className="border border-border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-medium">{ar ? "بيانات التسجيل الضريبي" : "Tax registration details"}</h2>
        <form
          onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))}
          className="space-y-4"
        >
          <div className="space-y-1">
            <Label>{ar ? "رقم التسجيل الضريبي (15 رقم)" : "VAT registration number (15 digits)"}</Label>
            <Input
              data-testid="input-vat-number"
              {...form.register("vatNumber")}
              placeholder="300000000000003"
              className="font-mono"
              maxLength={15}
            />
            {form.formState.errors.vatNumber && (
              <p className="text-xs text-destructive">{form.formState.errors.vatNumber.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{ar ? "اسم المنشأة بالعربية" : "Seller name (Arabic)"}</Label>
              <Input data-testid="input-seller-name-ar" {...form.register("sellerNameAr")} />
              {form.formState.errors.sellerNameAr && (
                <p className="text-xs text-destructive">{ar ? "مطلوب" : "Required"}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>{ar ? "اسم المنشأة بالإنجليزية" : "Seller name (English)"}</Label>
              <Input data-testid="input-seller-name-en" {...form.register("sellerNameEn")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{ar ? "المدينة بالعربية" : "City (Arabic)"}</Label>
              <Input data-testid="input-city-ar" {...form.register("cityAr")} />
            </div>
            <div className="space-y-1">
              <Label>{ar ? "المدينة بالإنجليزية" : "City (English)"}</Label>
              <Input data-testid="input-city-en" {...form.register("cityEn")} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>{ar ? "البيئة" : "Environment"}</Label>
            <Select
              value={form.watch("environment")}
              onValueChange={(v) => form.setValue("environment", v)}
            >
              <SelectTrigger data-testid="select-environment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">
                  {ar ? "بيئة الاختبار (Sandbox)" : "Sandbox (testing)"}
                </SelectItem>
                <SelectItem value="production">
                  {ar ? "بيئة الإنتاج (Production)" : "Production"}
                </SelectItem>
              </SelectContent>
            </Select>
            {form.watch("environment") === "sandbox" && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                {ar
                  ? "وضع الاختبار: لن تُرسَل الفواتير إلى بوابة ZATCA الرسمية"
                  : "Sandbox mode: invoices will not be submitted to the official ZATCA portal"}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-2">
            {can.write && (
              <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-zatca">
                {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin me-2" />}
                {ar ? "حفظ وتفعيل" : "Save & activate"}
              </Button>
            )}
            {isConfigured && can.write && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={deactivateMutation.isPending}
                onClick={() => deactivateMutation.mutate()}
                data-testid="button-deactivate-zatca"
              >
                {deactivateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin me-2" />}
                {ar ? "إلغاء التفعيل" : "Deactivate"}
              </Button>
            )}
          </div>
        </form>
      </div>

      {/* QR preview section when active */}
      {isConfigured && (
        <div className="border border-border rounded-lg p-4 bg-muted/20 space-y-2">
          <div className="flex items-center gap-2">
            <QrCode className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">
              {ar ? "رمز QR ZATCA نشط على الفواتير" : "ZATCA QR code is live on invoices"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {ar
              ? `سيتم تضمين رمز QR مشفر بـ TLV في ذيل كل فاتورة PDF. رقم VAT: ${config.vatNumber} | البيئة: ${config.environment === "sandbox" ? "اختبار" : "إنتاج"}`
              : `A TLV-encoded QR code will appear in the footer of every PDF invoice. VAT: ${config.vatNumber} | Env: ${config.environment}`}
          </p>
        </div>
      )}
    </div>
  );
}
