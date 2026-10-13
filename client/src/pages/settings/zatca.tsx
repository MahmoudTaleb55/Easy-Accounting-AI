import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertZatcaConfigSchema, type ZatcaConfig } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Zap, CheckCircle2, AlertCircle, QrCode } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useT, type StringKey } from "@/i18n/dict";
import { mapErrorKey } from "@/lib/error-messages";
import { z } from "zod";

const formSchema = insertZatcaConfigSchema.extend({
  vatNumber: z.string()
    .min(15, "رقم ضريبة القيمة المضافة يجب أن يكون 15 رقماً")
    .max(15, "رقم ضريبة القيمة المضافة يجب أن يكون 15 رقماً")
    .regex(/^\d+$/, "يجب أن يحتوي على أرقام فقط"),
});
type FormValues = z.infer<typeof formSchema>;

export default function ZatcaSettingsPage() {
  const t = useT();
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
      toast({ title: t("zatca_saved") });
    },
    onError: (e: unknown) => toast({ title: t(mapErrorKey(e)), variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/zatca/config"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/zatca/config"] });
      toast({ title: t("zatca_deactivated") });
    },
    onError: (e: unknown) => toast({ title: t(mapErrorKey(e)), variant: "destructive" }),
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
            {t("zatca_title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("zatca_subtitle")}
          </p>
        </div>
        {isConfigured ? (
          <Badge className="bg-success/10 text-success border-success/20 gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {t("zatca_active")}
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <AlertCircle className="h-3 w-3" />
            {t("zatca_inactive")}
          </Badge>
        )}
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {([
          { icon: QrCode,       titleKey: "zatca_card_qr_title",    descKey: "zatca_card_qr_desc" },
          { icon: CheckCircle2, titleKey: "zatca_card_phase_title", descKey: "zatca_card_phase_desc" },
          { icon: Zap,          titleKey: "zatca_card_vat_title",   descKey: "zatca_card_vat_desc" },
        ] as { icon: typeof QrCode; titleKey: StringKey; descKey: StringKey }[]).map((c) => (
          <div key={c.titleKey} className="border border-border rounded-lg p-3 space-y-1">
            <c.icon className="h-4 w-4 text-primary" />
            <p className="text-xs font-medium">{t(c.titleKey)}</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{t(c.descKey)}</p>
          </div>
        ))}
      </div>

      {/* Configuration form */}
      <div className="border border-border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-medium">{t("zatca_reg_details")}</h2>
        <form
          onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))}
          className="space-y-4"
        >
          <div className="space-y-1">
            <Label>{t("zatca_vat_label")}</Label>
            <Input
              data-testid="input-vat-number"
              {...form.register("vatNumber")}
              placeholder="300000000000003"
              className="font-mono"
              maxLength={15}
            />
            {form.formState.errors.vatNumber && (
              <p className="text-xs text-destructive">{t("zatca_vat_error")}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("zatca_seller_ar")}</Label>
              <Input data-testid="input-seller-name-ar" {...form.register("sellerNameAr")} />
              {form.formState.errors.sellerNameAr && (
                <p className="text-xs text-destructive">{t("zatca_required")}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>{t("zatca_seller_en")}</Label>
              <Input data-testid="input-seller-name-en" {...form.register("sellerNameEn")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("zatca_city_ar")}</Label>
              <Input data-testid="input-city-ar" {...form.register("cityAr")} />
            </div>
            <div className="space-y-1">
              <Label>{t("zatca_city_en")}</Label>
              <Input data-testid="input-city-en" {...form.register("cityEn")} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t("zatca_environment")}</Label>
            <Select
              value={form.watch("environment")}
              onValueChange={(v) => form.setValue("environment", v)}
            >
              <SelectTrigger data-testid="select-environment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">
                  {t("zatca_env_sandbox")}
                </SelectItem>
                <SelectItem value="production">
                  {t("zatca_env_production")}
                </SelectItem>
              </SelectContent>
            </Select>
            {form.watch("environment") === "sandbox" && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                {t("zatca_sandbox_hint")}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-2">
            {can.write && (
              <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-zatca">
                {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin me-2" />}
                {t("zatca_save_activate")}
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
                {t("zatca_deactivate")}
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
              {t("zatca_qr_live")}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("zatca_qr_detail")
              .replace("{vat}", config.vatNumber)
              .replace("{env}", config.environment === "sandbox" ? t("zatca_env_sandbox_short") : t("zatca_env_production_short"))}
          </p>
        </div>
      )}
    </div>
  );
}
