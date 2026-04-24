import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocale } from "@/contexts/locale-context";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { UserPlus, Users, Copy, Trash2, Check, AlertCircle, ShieldCheck } from "lucide-react";
import { ROLES, inviteSchema, type Role } from "@shared/schema";
import { WriteGuard } from "@/components/auth/write-guard";

// Shape returned by `/api/auth/members` (server/auth/local-routes.ts).
interface MemberRow {
  id: string;
  userId: string;
  companyId: number;
  role: Role;
  createdAt: string | null;
  user: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
    provider: string;
  };
}

// Shape returned by `/api/auth/invitations`.
interface InvitationRow {
  id: string;
  companyId: number;
  email: string;
  role: Role;
  token: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
}

type InviteForm = { email: string; role: Role };

function roleLabel(role: Role, locale: string): string {
  const map: Record<Role, { ar: string; en: string }> = {
    owner: { ar: "مالك", en: "Owner" },
    accountant: { ar: "محاسب", en: "Accountant" },
    viewer: { ar: "مشاهد", en: "Viewer" },
  };
  return map[role][locale === "ar" ? "ar" : "en"];
}

function roleDescription(role: Role, locale: string): string {
  if (locale === "ar") {
    return role === "owner"
      ? "كامل الصلاحيات بما فيها الإعدادات والفريق."
      : role === "accountant"
      ? "إنشاء وتعديل القيود والمعاملات والرواتب، بدون تعديل إعدادات المنشأة."
      : "قراءة فقط — لا يمكن إجراء أي تعديل.";
  }
  return role === "owner"
    ? "Full access including workspace settings and team."
    : role === "accountant"
    ? "Create and edit entries, transactions, and payroll. No workspace settings."
    : "Read-only — cannot make changes.";
}

function memberDisplayName(m: MemberRow): string {
  return (
    [m.user.firstName, m.user.lastName].filter(Boolean).join(" ").trim() ||
    m.user.email ||
    "—"
  );
}

export function TeamPanel() {
  const { locale } = useLocale();
  const { toast } = useToast();
  const { user, role } = useAuth();
  const isOwner = role === "owner";
  const [showInvite, setShowInvite] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const { data: members = [] } = useQuery<MemberRow[]>({
    queryKey: ["/api/auth/members"],
    enabled: isOwner,
  });
  const { data: invites = [] } = useQuery<InvitationRow[]>({
    queryKey: ["/api/auth/invitations"],
    enabled: isOwner,
  });

  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "viewer" },
  });

  const inviteMutation = useMutation({
    mutationFn: async (vals: InviteForm) => {
      const res = await apiRequest("POST", "/api/auth/invitations", vals);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/invitations"] });
      toast({
        title: locale === "ar" ? "تم إرسال الدعوة" : "Invite sent",
        description:
          locale === "ar"
            ? "وصل البريد لزميلك. يمكنك أيضاً نسخ الرابط من القائمة أدناه."
            : "Your teammate will receive an email. You can also copy the link from the list below.",
      });
      form.reset({ email: "", role: "viewer" });
      setShowInvite(false);
    },
    onError: (e: any) =>
      toast({
        title: locale === "ar" ? "تعذر إنشاء الدعوة" : "Could not create invite",
        description: e?.message,
        variant: "destructive",
      }),
  });

  const roleMutation = useMutation({
    mutationFn: async ({ id, role: nextRole }: { id: string; role: Role }) => {
      const res = await apiRequest("PATCH", `/api/auth/members/${id}`, { role: nextRole });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/memberships"] });
    },
    onError: (e: any) =>
      toast({
        title: locale === "ar" ? "تعذر تحديث الدور" : "Could not update role",
        description: e?.message,
        variant: "destructive",
      }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/auth/members/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/auth/members"] }),
    onError: (e: any) =>
      toast({
        title: locale === "ar" ? "تعذر الحذف" : "Could not remove",
        description: e?.message,
        variant: "destructive",
      }),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/auth/invitations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/auth/invitations"] }),
  });

  function inviteLink(token: string): string {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    return `${base}/accept-invitation/${token}`;
  }

  function copyInvite(token: string) {
    const link = inviteLink(token);
    navigator.clipboard?.writeText(link).then(() => {
      setCopiedToken(token);
      window.setTimeout(() => setCopiedToken(null), 1500);
    });
  }

  const pendingInvites = invites.filter((i) => i.status === "pending");

  return (
    <Card data-testid="card-team-roles">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            {locale === "ar" ? "الفريق والصلاحيات" : "Team & roles"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {locale === "ar"
              ? "ادعُ زملاءك وتحكّم في ما يمكنهم رؤيته وتعديله داخل دفاترك."
              : "Invite teammates and control what they can see and change in your books."}
          </p>
        </div>
        {isOwner && (
          <WriteGuard>
            <Button
              size="sm"
              onClick={() => setShowInvite((v) => !v)}
              data-testid="button-toggle-invite"
            >
              <UserPlus className="w-4 h-4 me-1.5" />
              {locale === "ar" ? "دعوة عضو" : "Invite member"}
            </Button>
          </WriteGuard>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {!isOwner && (
          <div
            className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
            data-testid="banner-not-owner"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {locale === "ar"
                ? "إدارة الفريق متاحة للمالك فقط."
                : "Only the workspace owner can manage the team."}
            </span>
          </div>
        )}

        {showInvite && isOwner && (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((v) => inviteMutation.mutate(v))}
              className="rounded-lg border border-border p-4 space-y-3 bg-muted/20"
              data-testid="form-invite"
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{locale === "ar" ? "البريد الإلكتروني" : "Email"}</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        {...field}
                        placeholder="name@company.com"
                        data-testid="input-invite-email"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{locale === "ar" ? "الدور" : "Role"}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-invite-role">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            <div className="flex flex-col items-start">
                              <span>{roleLabel(r, locale)}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {roleDescription(r, locale)}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowInvite(false)}
                  data-testid="button-cancel-invite"
                >
                  {locale === "ar" ? "إلغاء" : "Cancel"}
                </Button>
                <WriteGuard forceDisabled={inviteMutation.isPending}>
                  <Button
                    type="submit"
                    size="sm"
                    data-testid="button-submit-invite"
                  >
                    {inviteMutation.isPending
                      ? locale === "ar"
                        ? "جاري الإرسال..."
                        : "Sending..."
                      : locale === "ar"
                      ? "إرسال الدعوة"
                      : "Send invite"}
                  </Button>
                </WriteGuard>
              </div>
            </form>
          </Form>
        )}

        {isOwner && (
          <section className="space-y-2" data-testid="section-members">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                {locale === "ar" ? "الأعضاء" : "Members"}
              </h3>
              <span className="text-[11px] text-muted-foreground">
                {members.length} {locale === "ar" ? "عضو" : "member(s)"}
              </span>
            </div>
            <ul className="divide-y divide-border rounded-md border border-border overflow-hidden">
              {members.map((m) => {
                const isMe = m.userId === user?.id;
                const name = memberDisplayName(m);
                return (
                  <li
                    key={m.id}
                    className="flex items-center gap-3 p-3"
                    data-testid={`row-member-${m.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground truncate" data-testid={`text-member-name-${m.id}`}>
                          {name}
                        </p>
                        {isMe && (
                          <Badge variant="outline" className="text-[10px]">
                            {locale === "ar" ? "أنت" : "You"}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{m.user.email ?? "—"}</p>
                    </div>
                    {!isMe ? (
                      <Select
                        value={m.role}
                        onValueChange={(v) => roleMutation.mutate({ id: m.id, role: v as Role })}
                      >
                        <SelectTrigger
                          className="h-8 w-[120px] text-xs"
                          data-testid={`select-member-role-${m.id}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {roleLabel(r, locale)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary" className="text-[11px]" data-testid={`badge-member-role-${m.id}`}>
                        <ShieldCheck className="w-3 h-3 me-1" />
                        {roleLabel(m.role, locale)}
                      </Badge>
                    )}
                    {!isMe && (
                      <WriteGuard>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => removeMutation.mutate(m.id)}
                          aria-label={locale === "ar" ? "حذف العضو" : "Remove member"}
                          data-testid={`button-remove-member-${m.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </WriteGuard>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {isOwner && pendingInvites.length > 0 && (
          <section className="space-y-2" data-testid="section-invites">
            <h3 className="text-sm font-semibold text-foreground">
              {locale === "ar" ? "دعوات معلّقة" : "Pending invites"}
            </h3>
            <ul className="divide-y divide-border rounded-md border border-border overflow-hidden">
              {pendingInvites.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center gap-3 p-3"
                  data-testid={`row-invite-${inv.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{inv.email}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {locale === "ar"
                        ? `تنتهي ${new Date(inv.expiresAt).toLocaleDateString()}`
                        : `Expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[11px]">
                    {roleLabel(inv.role, locale)}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyInvite(inv.token)}
                    data-testid={`button-copy-invite-${inv.id}`}
                  >
                    {copiedToken === inv.token ? (
                      <Check className="w-4 h-4 me-1.5 text-success" />
                    ) : (
                      <Copy className="w-4 h-4 me-1.5" />
                    )}
                    {locale === "ar" ? "نسخ الرابط" : "Copy link"}
                  </Button>
                  <WriteGuard>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => revokeMutation.mutate(inv.id)}
                      aria-label={locale === "ar" ? "إلغاء الدعوة" : "Revoke invite"}
                      data-testid={`button-revoke-invite-${inv.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </WriteGuard>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">
              {locale === "ar"
                ? "أرسلنا للزميل بريداً يحوي الرابط. يمكنك أيضاً نسخه ومشاركته يدوياً."
                : "We emailed your teammate the link. You can also copy and share it manually."}
            </p>
          </section>
        )}

        <div className="rounded-md border border-border bg-muted/30 p-3">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            {locale === "ar" ? "ماذا يستطيع كل دور؟" : "What each role can do"}
          </Label>
          <ul className="mt-2 grid gap-1.5 text-[12px] text-muted-foreground sm:grid-cols-3">
            {ROLES.map((r) => (
              <li key={r} className="rounded border border-border bg-background/40 p-2">
                <div className="text-foreground text-xs font-medium mb-0.5">
                  {roleLabel(r, locale)}
                </div>
                <div className="leading-relaxed">{roleDescription(r, locale)}</div>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
