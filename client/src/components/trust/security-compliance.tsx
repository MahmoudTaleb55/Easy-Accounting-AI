import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  Lock,
  Database,
  Globe2,
  Users,
  ScrollText,
  CircleAlert,
  CircleCheck,
} from "lucide-react";
import { useLocale } from "@/contexts/locale-context";
import { formatDistanceToNow } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { SourceLinkBadge } from "@/components/journal/source-link-badge";
import type { JournalEntrySourceLink } from "@shared/schema";

interface JE {
  id: number;
  reference: string;
  description: string;
  source: string;
  entryDate: string;
  createdAt?: string;
  sourceLink?: JournalEntrySourceLink;
}

interface MemberLite {
  id: string;
  role: "owner" | "accountant" | "viewer";
}
interface InviteLite {
  id: string;
  status: "pending" | "accepted" | "revoked" | "expired";
}

interface MarkProps {
  status: "ok" | "info" | "todo";
  children: React.ReactNode;
}
function Mark({ status, children }: MarkProps) {
  const tone =
    status === "ok"
      ? "text-success"
      : status === "info"
      ? "text-info"
      : "text-muted-foreground";
  const Icon = status === "todo" ? CircleAlert : CircleCheck;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${tone}`}>
      <Icon className="w-3.5 h-3.5" />
      {children}
    </span>
  );
}

function StatusMark({ status }: { status: "ok" | "info" | "todo" }) {
  const { locale } = useLocale();
  const label =
    status === "ok"
      ? locale === "ar" ? "مفعّل" : "Active"
      : status === "info"
      ? locale === "ar" ? "موثّق" : "Noted"
      : locale === "ar" ? "قيد التطوير" : "Pending";
  return <Mark status={status}>{label}</Mark>;
}

function Row({
  label,
  value,
  caption,
  status,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  caption?: string;
  status?: "ok" | "info" | "todo";
  testId?: string;
}) {
  return (
    <div
      className="flex items-start justify-between gap-4 py-3 border-b border-border last:border-b-0"
      data-testid={testId}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {caption && (
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
            {caption}
          </p>
        )}
      </div>
      <div className="text-end shrink-0 max-w-[55%]">
        <div className="text-sm text-foreground font-numeric tabular-nums">{value}</div>
        {status && <div className="mt-1"><StatusMark status={status} /></div>}
      </div>
    </div>
  );
}

export function SecurityCompliance() {
  const { locale } = useLocale();
  const dfLocale = locale === "ar" ? ar : enUS;
  const t = {
    eyebrow: locale === "ar" ? "الأمان والامتثال" : "Security & compliance",
    title:
      locale === "ar"
        ? "كيف نحمي بياناتك ومن يصل إليها."
        : "How your data is protected and who can access it.",
    posture: locale === "ar" ? "وضع الأمان" : "Security posture",
    residency: locale === "ar" ? "موقع البيانات وتشفيرها" : "Data residency & encryption",
    region: locale === "ar" ? "منطقة الاستضافة" : "Hosting region",
    regionVal:
      locale === "ar"
        ? "السحابة المؤسسية — المنطقة الافتراضية مع نسخ احتياطي مستمر."
        : "Managed cloud deployment — default region with continuous backups.",
    encAtRest: locale === "ar" ? "تشفير في حالة السكون" : "Encryption at rest",
    encAtRestVal: "AES-256",
    encInTransit: locale === "ar" ? "تشفير أثناء النقل" : "Encryption in transit",
    encInTransitVal: "TLS 1.3",
    retention: locale === "ar" ? "احتفاظ النسخ الاحتياطية" : "Backup retention",
    retentionVal: locale === "ar" ? "تلقائي عبر النظام الأساسي" : "Platform-managed",
    audit: locale === "ar" ? "السجل ومسارات المراجعة" : "Audit & change history",
    auditCaption:
      locale === "ar"
        ? "كل قيد يحمل مرجعاً ومصدراً (يدوي / تلقائي / AI). يظهر سجل كامل بجانب كل صف."
        : "Every entry carries a reference and source (manual / auto / AI). A full log appears next to each row.",
    rbac: locale === "ar" ? "الأدوار والصلاحيات" : "Roles & permissions",
    rbacCaption:
      locale === "ar"
        ? "أدوار حقيقية: المالك يحرر الإعدادات والفريق، المحاسب يحرر القيود والمعاملات، المشاهد يقرأ فقط."
        : "Live roles: owners manage settings & team, accountants edit entries & transactions, viewers are read-only.",
    integrations: locale === "ar" ? "أمان التكاملات" : "Integration security",
    integrationsCaption:
      locale === "ar"
        ? "الذكاء الاصطناعي يعمل عبر تكامل OpenAI الموثّق في النشر الحالي. لا تُخزَّن المطالبات في خدمات خارجية."
        : "AI runs through the vetted OpenAI integration configured for this deployment. Prompts are not retained externally.",
    activity: locale === "ar" ? "آخر النشاط الإداري" : "Recent admin activity",
    activityCaption:
      locale === "ar"
        ? "آخر القيود التي أنشأها مستخدمون أو الذكاء الاصطناعي."
        : "Recent entries created by users or the AI.",
    none: locale === "ar" ? "لا يوجد نشاط مسجَّل بعد." : "No recorded activity yet.",
    sourceManual: locale === "ar" ? "يدوي" : "Manual",
    sourceTransaction: locale === "ar" ? "تلقائي" : "Auto",
    sourceAI: "AI",
  };

  const { data: entries } = useQuery<JE[]>({ queryKey: ["/api/journal-entries"] });
  const { data: me } = useQuery<{ role: "owner" | "accountant" | "viewer"; id: number }>({
    queryKey: ["/api/auth/me"],
  });
  // Member + invite counts come from the canonical auth endpoints. Both are
  // owner-only on the server, so we only enable them for owners — other
  // roles render the static counts as zero (the badges read "0 owner · …",
  // which is fine on the trust panel since they can't see the team anyway).
  const { data: members = [] } = useQuery<MemberLite[]>({
    queryKey: ["/api/auth/members"],
    enabled: me?.role === "owner",
  });
  const { data: invites = [] } = useQuery<InviteLite[]>({
    queryKey: ["/api/auth/invitations"],
    enabled: me?.role === "owner",
  });
  const recent = (entries || []).slice(0, 5);
  const ownerCount = members.filter((m) => m.role === "owner").length;
  const accountantCount = members.filter((m) => m.role === "accountant").length;
  const viewerCount = members.filter((m) => m.role === "viewer").length;
  const pendingInvites = invites.filter((i) => i.status === "pending").length;

  return (
    <div className="space-y-4" data-testid="section-security">
      <div className="space-y-1">
        <div className="eyebrow text-muted-foreground/80">{t.eyebrow}</div>
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-foreground">
          {t.title}
        </h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card variant="default" data-testid="card-residency">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="w-4 h-4 text-primary" />
              {t.residency}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Row label={t.region} value={t.regionVal} status="ok" testId="row-region" />
            <Row label={t.encAtRest} value={t.encAtRestVal} status="ok" testId="row-enc-rest" />
            <Row label={t.encInTransit} value={t.encInTransitVal} status="ok" testId="row-enc-transit" />
            <Row label={t.retention} value={t.retentionVal} status="info" testId="row-retention" />
          </CardContent>
        </Card>

        <Card variant="default" data-testid="card-posture">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Shield className="w-4 h-4 text-primary" />
              {t.posture}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Row
              label={t.audit}
              value={
                <span className="inline-flex items-center gap-1.5">
                  <ScrollText className="w-3.5 h-3.5 opacity-70" />
                  {(entries || []).length}
                </span>
              }
              caption={t.auditCaption}
              status="ok"
              testId="row-audit"
            />
            <Row
              label={t.rbac}
              value={
                <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                  <Badge variant="secondary" className="text-[10px]" data-testid="badge-role-counts">
                    <Users className="w-3 h-3 me-1" />
                    {locale === "ar"
                      ? `${ownerCount} مالك · ${accountantCount} محاسب · ${viewerCount} مشاهد`
                      : `${ownerCount} owner · ${accountantCount} accountant · ${viewerCount} viewer`}
                  </Badge>
                  {pendingInvites > 0 && (
                    <Badge variant="outline" className="text-[10px]" data-testid="badge-pending-invites">
                      {locale === "ar"
                        ? `${pendingInvites} دعوة معلّقة`
                        : `${pendingInvites} pending invite${pendingInvites === 1 ? "" : "s"}`}
                    </Badge>
                  )}
                </span>
              }
              caption={t.rbacCaption}
              status="ok"
              testId="row-rbac"
            />
            <Row
              label={t.integrations}
              value={
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 opacity-70" />
                  OpenAI
                </span>
              }
              caption={t.integrationsCaption}
              status="ok"
              testId="row-integrations"
            />
          </CardContent>
        </Card>
      </div>

      <Card variant="default" data-testid="card-recent-admin">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Globe2 className="w-4 h-4 text-primary" />
            {t.activity}
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">{t.activityCaption}</p>
        </CardHeader>
        <CardContent className="pt-0">
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t.none}</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((je) => {
                const sourceLabel =
                  je.source === "transaction"
                    ? t.sourceTransaction
                    : je.source === "ai"
                    ? t.sourceAI
                    : t.sourceManual;
                return (
                  <li
                    key={je.id}
                    className="py-3 flex items-center justify-between gap-3"
                    data-testid={`row-admin-activity-${je.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground truncate">{je.description}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                        <span className="font-numeric tabular-nums">{je.reference}</span>
                        <span className="text-muted-foreground/40">·</span>
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 font-normal">
                          {sourceLabel}
                        </Badge>
                        {je.sourceLink && (
                          <>
                            <span className="text-muted-foreground/40">·</span>
                            <SourceLinkBadge link={je.sourceLink} surface="admin-activity" />
                          </>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0 font-numeric tabular-nums">
                      {formatDistanceToNow(new Date(je.createdAt || je.entryDate), {
                        addSuffix: true,
                        locale: dfLocale,
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
