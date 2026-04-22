import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { inviteSchema, type Role, ROLES } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/contexts/locale-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Mail, RotateCw, Trash2, Loader2, Copy, Check, Activity as ActivityIcon, AlertTriangle, MailCheck, MailX, MailWarning, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { WriteGuard } from "@/components/auth/write-guard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MemberSession {
  sid: string;
  expiresAt: string;
  isCurrent: boolean;
  provider: "local" | "replit";
}
interface MemberActivityResponse {
  member: { id: string; userId: string; role: Role; user: MemberRow["user"] };
  sessions: MemberSession[];
}

interface MemberRow {
  id: string;
  userId: string;
  companyId: number;
  role: Role;
  createdAt: string | null;
  user: { id: string; email: string | null; firstName: string | null; lastName: string | null; profileImageUrl: string | null; provider: string };
}
interface InvitationRow {
  id: string;
  companyId: number;
  email: string;
  role: Role;
  token: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
  lastMessageId: string | null;
  lastEmailStatus:
    | "queued"
    | "sent"
    | "delivered"
    | "delivery_delayed"
    | "bounced"
    | "complained"
    | "opened"
    | "clicked"
    | "send_failed"
    | "not_configured"
    | null;
  lastEmailError: string | null;
  lastEmailEventAt: string | null;
}

type DeliveryTone = "success" | "warning" | "info" | "destructive" | "muted";

function deliveryBadge(
  status: InvitationRow["lastEmailStatus"],
  ar: boolean,
): { label: string; tone: DeliveryTone; Icon: typeof MailCheck } {
  switch (status) {
    case "delivered":
    case "opened":
    case "clicked":
      return { label: ar ? "وصلت" : "Delivered", tone: "success", Icon: MailCheck };
    case "sent":
      return { label: ar ? "أُرسلت" : "Sent", tone: "info", Icon: Mail };
    case "delivery_delayed":
      return { label: ar ? "تأخّر التسليم" : "Delayed", tone: "warning", Icon: Clock };
    case "bounced":
      return { label: ar ? "ارتدّت" : "Bounced", tone: "destructive", Icon: MailX };
    case "complained":
      return { label: ar ? "بلاغ سبام" : "Spam report", tone: "destructive", Icon: MailWarning };
    case "send_failed":
      return { label: ar ? "فشل الإرسال" : "Failed", tone: "destructive", Icon: AlertTriangle };
    case "not_configured":
      return { label: ar ? "البريد غير مفعّل" : "Email off", tone: "muted", Icon: Mail };
    default:
      return { label: ar ? "بانتظار" : "Pending", tone: "muted", Icon: Mail };
  }
}

const ROLE_LABELS: Record<Role, { ar: string; en: string; tone: "default" | "secondary" | "outline" | "destructive" }> = {
  admin: { ar: "مالك", en: "Admin", tone: "default" },
  accountant: { ar: "محاسب", en: "Accountant", tone: "secondary" },
  reviewer: { ar: "مراجع", en: "Reviewer", tone: "outline" },
  readonly: { ar: "قراءة فقط", en: "Read-only", tone: "outline" },
};

function initials(first?: string | null, last?: string | null, email?: string | null) {
  const a = (first ?? "").trim()[0] ?? "";
  const b = (last ?? "").trim()[0] ?? "";
  if (a || b) return (a + b).toUpperCase();
  return (email ?? "?")[0]?.toUpperCase() ?? "?";
}

export default function MembersPage() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const { can, role, user: me } = useAuth();
  const { toast } = useToast();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [activityMemberId, setActivityMemberId] = useState<string | null>(null);
  const isAdmin = role === "admin";

  const { data: activity, isLoading: loadingActivity } = useQuery<MemberActivityResponse>({
    queryKey: ["/api/auth/members", activityMemberId, "activity"],
    queryFn: async () => {
      const r = await fetch(`/api/auth/members/${activityMemberId}/activity`, { credentials: "include" });
      if (!r.ok) throw new Error(`${r.status}: ${r.statusText}`);
      return r.json();
    },
    enabled: !!activityMemberId && isAdmin,
  });

  const { data: members = [], isLoading: loadingMembers } = useQuery<MemberRow[]>({
    queryKey: ["/api/auth/members"],
    enabled: isAdmin,
  });
  const { data: invitations = [] } = useQuery<InvitationRow[]>({
    queryKey: ["/api/auth/invitations"],
    enabled: can.invite,
  });

  const inviteForm = useForm({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "accountant" as Role },
  });

  const invite = useMutation<{ invitation: InvitationRow; link?: string }, Error, { email: string; role: Role }>({
    mutationFn: async (v) => (await apiRequest("POST", "/api/auth/invitations", v)).json(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/invitations"] });
      inviteForm.reset();
      toast({
        title: ar ? "تم إرسال الدعوة" : "Invitation sent",
        description: data?.link ? (ar ? "انسخ الرابط من السجل أدناه." : "Copy the link from the list below.") : undefined,
      });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateRole = useMutation({
    mutationFn: async (v: { id: string; role: Role }) =>
      (await apiRequest("PATCH", `/api/auth/members/${v.id}`, { role: v.role })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/auth/members"] }),
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeMember = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/auth/members/${id}`)).text(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/auth/members"] }),
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const resend = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/auth/invitations/${id}/resend`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/auth/invitations"] }),
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/auth/invitations/${id}`)).text(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/auth/invitations"] }),
  });

  function copyLink(token: string) {
    const url = `${window.location.origin}/accept-invitation/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 1500);
    });
  }

  // Hard guard: only admins can view this page. Other roles get a friendly
  // forbidden notice instead of a noisy chain of API failures.
  if (role && !isAdmin) {
    return (
      <div className="max-w-2xl py-12" data-testid="members-forbidden">
        <h1 className="font-serif text-2xl tracking-tight">
          {ar ? "غير مصرح" : "Not authorized"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {ar
            ? "إدارة الأعضاء متاحة لمالك مساحة العمل فقط."
            : "Member management is restricted to workspace admins."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">{ar ? "الأعضاء والصلاحيات" : "Members & roles"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ar
            ? "ادعُ زملاء فريقك بدور محدد. يمكن للمالك إدارة الأدوار وحذف الأعضاء."
            : "Invite teammates with a specific role. Admins can update roles and remove members."}
        </p>
      </header>

      {can.invite && (
        <Card data-testid="card-invite">
          <CardHeader>
            <CardTitle>{ar ? "دعوة عضو جديد" : "Invite a new member"}</CardTitle>
            <CardDescription>
              {ar ? "سيُرسل لهم رابط لقبول الدعوة. تنتهي الدعوات بعد 7 أيام." : "They'll receive a link to accept. Invitations expire after 7 days."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={inviteForm.handleSubmit((v) => invite.mutate(v))}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              data-testid="form-invite"
            >
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="email">{ar ? "البريد الإلكتروني" : "Email"}</Label>
                <Input id="email" type="email" data-testid="input-invite-email" {...inviteForm.register("email")} />
              </div>
              <div className="w-44 space-y-1.5">
                <Label>{ar ? "الدور" : "Role"}</Label>
                <Select
                  value={inviteForm.watch("role")}
                  onValueChange={(v) => inviteForm.setValue("role", v as Role)}
                >
                  <SelectTrigger data-testid="select-invite-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r} data-testid={`option-role-${r}`}>
                        {ar ? ROLE_LABELS[r].ar : ROLE_LABELS[r].en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <WriteGuard forceDisabled={invite.isPending}>
                <Button type="submit" data-testid="button-send-invite">
                  {invite.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Mail className="mr-2 h-4 w-4" />
                  {ar ? "إرسال" : "Send invite"}
                </Button>
              </WriteGuard>
            </form>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members" data-testid="tab-members">{ar ? "الأعضاء" : "Members"} ({members.length})</TabsTrigger>
          {can.invite && (
            <TabsTrigger value="invitations" data-testid="tab-invitations">
              {ar ? "الدعوات" : "Invitations"} ({invitations.filter((i) => i.status === "pending").length})
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="members" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {loadingMembers ? (
                <div className="p-6 text-center text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /></div>
              ) : (
                <ul className="divide-y divide-border">
                  {members.map((m) => {
                    const isMe = m.userId === me?.id;
                    const fullName = [m.user.firstName, m.user.lastName].filter(Boolean).join(" ") || m.user.email;
                    return (
                      <li key={m.id} className="flex items-center gap-4 px-5 py-4" data-testid={`row-member-${m.id}`}>
                        <Avatar className="h-9 w-9">
                          {m.user.profileImageUrl && <AvatarImage src={m.user.profileImageUrl} alt={fullName ?? ""} />}
                          <AvatarFallback>{initials(m.user.firstName, m.user.lastName, m.user.email)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium" data-testid={`text-member-name-${m.id}`}>{fullName}</span>
                            {isMe && <span className="text-xs text-muted-foreground">({ar ? "أنت" : "you"})</span>}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{m.user.email}</div>
                        </div>
                        {can.manageMembers && !isMe ? (
                          <Select
                            value={m.role}
                            onValueChange={(v) => {
                              const r = v as Role;
                              if (r === m.role) return;
                              const ok = window.confirm(
                                ar
                                  ? `هل تريد تغيير دور ${fullName} إلى "${ROLE_LABELS[r].ar}"؟`
                                  : `Change role of ${fullName} to "${ROLE_LABELS[r].en}"?`
                              );
                              if (ok) updateRole.mutate({ id: m.id, role: r });
                            }}
                          >
                            <SelectTrigger className="w-36" data-testid={`select-role-${m.id}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ROLES.map((r) => (
                                <SelectItem key={r} value={r}>{ar ? ROLE_LABELS[r].ar : ROLE_LABELS[r].en}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant={ROLE_LABELS[m.role].tone} data-testid={`badge-role-${m.id}`}>
                            {ar ? ROLE_LABELS[m.role].ar : ROLE_LABELS[m.role].en}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground" data-testid={`text-joined-${m.id}`}>
                          {ar ? "انضم" : "joined"}{" "}
                          {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "—"}
                        </span>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActivityMemberId(m.id)}
                            data-testid={`link-activity-${m.id}`}
                            aria-label={ar ? "النشاط" : "View activity"}
                          >
                            <ActivityIcon className="h-3.5 w-3.5 mr-1" />
                            {ar ? "النشاط" : "Activity"}
                          </Button>
                        )}
                        {can.manageMembers && !isMe && (
                          <WriteGuard>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                const ok = window.confirm(
                                  ar
                                    ? `إزالة ${fullName} من مساحة العمل؟ سيفقد الوصول فوراً.`
                                    : `Remove ${fullName} from this workspace? They'll lose access immediately.`
                                );
                                if (ok) removeMember.mutate(m.id);
                              }}
                              data-testid={`button-remove-${m.id}`}
                              aria-label="Remove"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </WriteGuard>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {can.invite && (
          <TabsContent value="invitations" className="mt-4">
            <Card>
              <CardContent className="p-0">
                {invitations.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground" data-testid="text-no-invitations">
                    {ar ? "لا توجد دعوات." : "No invitations yet."}
                  </div>
                ) : (
                  <TooltipProvider delayDuration={200}>
                    <ul className="divide-y divide-border">
                      {invitations.map((inv) => {
                        const delivery = deliveryBadge(inv.lastEmailStatus, ar);
                        const DeliveryIcon = delivery.Icon;
                        const failed =
                          inv.lastEmailStatus === "bounced" ||
                          inv.lastEmailStatus === "complained" ||
                          inv.lastEmailStatus === "send_failed";
                        const reasonText = inv.lastEmailError
                          ? inv.lastEmailError
                          : inv.lastEmailStatus === "not_configured"
                            ? ar
                              ? "خدمة البريد غير مهيّأة. شارك الرابط يدوياً."
                              : "Email service not configured. Share the link manually."
                            : null;
                        return (
                          <li key={inv.id} className="flex items-center gap-3 px-5 py-3" data-testid={`row-invitation-${inv.id}`}>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">{inv.email}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <Badge variant={ROLE_LABELS[inv.role].tone}>
                                  {ar ? ROLE_LABELS[inv.role].ar : ROLE_LABELS[inv.role].en}
                                </Badge>
                                {inv.status === "pending" ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge
                                        variant={delivery.tone}
                                        size="sm"
                                        className="gap-1"
                                        data-testid={`badge-delivery-${inv.id}`}
                                      >
                                        <DeliveryIcon className="h-3 w-3" />
                                        {delivery.label}
                                      </Badge>
                                    </TooltipTrigger>
                                    {(reasonText || inv.lastEmailEventAt) && (
                                      <TooltipContent className="max-w-xs">
                                        {reasonText && (
                                          <p data-testid={`text-delivery-reason-${inv.id}`}>{reasonText}</p>
                                        )}
                                        {inv.lastEmailEventAt && (
                                          <p className="mt-1 text-[11px] opacity-70">
                                            {new Date(inv.lastEmailEventAt).toLocaleString()}
                                          </p>
                                        )}
                                      </TooltipContent>
                                    )}
                                  </Tooltip>
                                ) : (
                                  <span className="capitalize">{inv.status}</span>
                                )}
                                <span>•</span>
                                <span>
                                  {ar ? "تنتهي" : "expires"} {new Date(inv.expiresAt).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                            {inv.status === "pending" && (
                              <>
                                <Button variant="ghost" size="sm" onClick={() => copyLink(inv.token)} data-testid={`button-copy-${inv.id}`}>
                                  {copiedToken === inv.token ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                </Button>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <WriteGuard forceDisabled={resend.isPending}>
                                      <Button
                                        variant={failed ? "outline" : "ghost"}
                                        size="sm"
                                        onClick={() => resend.mutate(inv.id)}
                                        data-testid={`button-resend-${inv.id}`}
                                        className={failed ? "border-destructive/40 text-destructive hover:bg-destructive/10" : undefined}
                                      >
                                        <RotateCw className={`h-3.5 w-3.5 ${failed ? "mr-1.5" : ""}`} />
                                        {failed && (ar ? "أعد الإرسال" : "Resend")}
                                      </Button>
                                    </WriteGuard>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {ar ? "إعادة إرسال الدعوة" : "Resend invitation"}
                                  </TooltipContent>
                                </Tooltip>
                                <WriteGuard>
                                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(inv.id)} data-testid={`button-revoke-${inv.id}`}>
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                </WriteGuard>
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </TooltipProvider>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={!!activityMemberId} onOpenChange={(open) => !open && setActivityMemberId(null)}>
        <DialogContent data-testid="dialog-member-activity">
          <DialogHeader>
            <DialogTitle>{ar ? "نشاط العضو" : "Member activity"}</DialogTitle>
            <DialogDescription>
              {activity?.member.user.email ?? (ar ? "جاري التحميل…" : "Loading…")}
            </DialogDescription>
          </DialogHeader>
          {loadingActivity ? (
            <div className="py-8 text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></div>
          ) : !activity || activity.sessions.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground" data-testid="text-no-activity">
              {ar ? "لا توجد جلسات نشطة." : "No active sessions."}
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {activity.sessions.map((s) => (
                <li key={s.sid} className="flex items-center justify-between py-2" data-testid={`row-session-${s.sid}`}>
                  <div>
                    <div className="font-medium capitalize">{s.provider}</div>
                    <div className="text-xs text-muted-foreground">
                      {ar ? "تنتهي" : "expires"} {new Date(s.expiresAt).toLocaleString()}
                    </div>
                  </div>
                  {s.isCurrent && <Badge variant="secondary">{ar ? "حالية" : "current"}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
