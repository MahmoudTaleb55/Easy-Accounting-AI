import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocale } from "@/contexts/locale-context";
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
import { WORKSPACE_ROLES, type WorkspaceRole } from "@shared/schema";
import { WriteGuard } from "@/components/auth/write-guard";

interface Member {
  id: number;
  name: string;
  email: string;
  role: WorkspaceRole;
  status: string;
  createdAt: string | null;
}

interface Invite {
  id: number;
  email: string;
  name: string;
  role: WorkspaceRole;
  token: string;
  status: "pending" | "accepted" | "revoked";
  createdAt: string | null;
  acceptedAt: string | null;
}

interface Me {
  id: number;
  name: string;
  email: string;
  role: WorkspaceRole;
}

const inviteFormSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(WORKSPACE_ROLES),
});
type InviteForm = z.infer<typeof inviteFormSchema>;

function roleLabel(role: WorkspaceRole, locale: "ar" | "en"): string {
  const map: Record<WorkspaceRole, { ar: string; en: string }> = {
    owner: { ar: "مالك", en: "Owner" },
    accountant: { ar: "محاسب", en: "Accountant" },
    viewer: { ar: "مشاهد", en: "Viewer" },
  };
  return map[role][locale];
}

function roleDescription(role: WorkspaceRole, locale: "ar" | "en"): string {
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

export function TeamPanel() {
  const { locale } = useLocale();
  const { toast } = useToast();
  const [showInvite, setShowInvite] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const { data: me } = useQuery<Me>({ queryKey: ["/api/auth/me"] });
  const isOwner = me?.role === "owner";
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ["/api/team/members"],
    enabled: !!me && me.id !== 0,
  });
  const { data: invites = [] } = useQuery<Invite[]>({
    queryKey: ["/api/team/invites"],
    enabled: isOwner,
  });

  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: { name: "", email: "", role: "viewer" },
  });

  const inviteMutation = useMutation({
    mutationFn: async (vals: InviteForm) => {
      const res = await apiRequest("POST", "/api/team/invites", vals);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/invites"] });
      toast({
        title: locale === "ar" ? "تم إنشاء الدعوة" : "Invite created",
        description:
          locale === "ar" ? "انسخ الرابط وشاركه مع الزميل." : "Copy the link and share it with your teammate.",
      });
      form.reset({ name: "", email: "", role: "viewer" });
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
    mutationFn: async ({ id, role }: { id: number; role: WorkspaceRole }) => {
      const res = await apiRequest("PATCH", `/api/team/members/${id}`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (e: any) =>
      toast({
        title: locale === "ar" ? "تعذر تحديث الدور" : "Could not update role",
        description: e?.message,
        variant: "destructive",
      }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/team/members/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/team/members"] }),
    onError: (e: any) =>
      toast({
        title: locale === "ar" ? "تعذر الحذف" : "Could not remove",
        description: e?.message,
        variant: "destructive",
      }),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/team/invites/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/team/invites"] }),
  });

  const switchMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", "/api/auth/switch", { memberId: id }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: locale === "ar" ? "تم تبديل الجلسة" : "Switched session" });
    },
  });

  function inviteLink(token: string): string {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    return `${base}/invite/${token}`;
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
                ? "إدارة الفريق متاحة للمالك فقط. يظهر هنا الفريق للقراءة فقط."
                : "Only the workspace owner can manage the team. You're viewing in read-only mode."}
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
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{locale === "ar" ? "الاسم" : "Name"}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={locale === "ar" ? "مثال: سارة" : "e.g. Sarah"}
                          data-testid="input-invite-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
              </div>
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
                        {WORKSPACE_ROLES.map((r) => (
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
                        ? "جاري الإنشاء..."
                        : "Creating..."
                      : locale === "ar"
                      ? "إنشاء رابط الدعوة"
                      : "Create invite link"}
                  </Button>
                </WriteGuard>
              </div>
            </form>
          </Form>
        )}

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
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 p-3"
                data-testid={`row-member-${m.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate" data-testid={`text-member-name-${m.id}`}>
                      {m.name}
                    </p>
                    {me?.id === m.id && (
                      <Badge variant="outline" className="text-[10px]">
                        {locale === "ar" ? "أنت" : "You"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{m.email}</p>
                </div>
                {isOwner && me?.id !== m.id ? (
                  <Select
                    value={m.role}
                    onValueChange={(v) => roleMutation.mutate({ id: m.id, role: v as WorkspaceRole })}
                  >
                    <SelectTrigger
                      className="h-8 w-[120px] text-xs"
                      data-testid={`select-member-role-${m.id}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WORKSPACE_ROLES.map((r) => (
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
                {isOwner && me?.id !== m.id && (
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
                {/* Dev-only helper to switch identity. The matching server
                    endpoint is also gated to non-production and to owners. */}
                {import.meta.env.DEV && isOwner && me?.id !== m.id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-[11px]"
                    onClick={() => switchMutation.mutate(m.id)}
                    data-testid={`button-switch-${m.id}`}
                  >
                    {locale === "ar" ? "تبديل (تطوير)" : "Switch (dev)"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>

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
                    <p className="text-sm font-medium text-foreground truncate">{inv.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{inv.email}</p>
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
                  {isOwner && (
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
                  )}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">
              {locale === "ar"
                ? "شارك رابط الدعوة مع زميلك. عند فتحه يصبح عضواً نشطاً بالدور المحدد."
                : "Share the link with your teammate. Opening it activates the membership with the assigned role."}
            </p>
          </section>
        )}

        <div className="rounded-md border border-border bg-muted/30 p-3">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            {locale === "ar" ? "ماذا يستطيع كل دور؟" : "What each role can do"}
          </Label>
          <ul className="mt-2 grid gap-1.5 text-[12px] text-muted-foreground sm:grid-cols-3">
            {WORKSPACE_ROLES.map((r) => (
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
