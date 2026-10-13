import { useEffect } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/contexts/locale-context";
import { useT } from "@/i18n/dict";
import { AuthShell } from "./auth-shell";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export default function AcceptInvitationPage() {
  const [, params] = useRoute<{ token: string }>("/accept-invitation/:token");
  const token = params?.token ?? "";
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading, user, signOut, isSigningOut } = useAuth();
  const { locale, setLocale } = useLocale();
  const t = useT();

  // Honor ?lang=ar|en from the invitation email link, persisting the choice
  // for the rest of the sign-up flow (locale provider writes to localStorage).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "ar" || q === "en") {
      if (q !== locale) setLocale(q);
    }
  }, [locale, setLocale]);

  const { data: invite, isLoading: loadingInvite } = useQuery<{ email: string; role: string; companyId: number } | null>({
    queryKey: ["/api/auth/invitations/by-token", token],
    queryFn: async () => {
      const r = await fetch(`/api/auth/invitations/by-token/${token}`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
  });

  const accept = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/auth/invitations/accept", { token })).json(),
    onSuccess: (data: any) => {
      if (data?.companyId) {
        localStorage.setItem("active_company_id", String(data.companyId));
      }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/memberships"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      navigate("/app");
    },
  });

  if (isLoading || loadingInvite) {
    return (
      <AuthShell title={t("auth_checking_invite")}>
        <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      </AuthShell>
    );
  }

  if (!invite) {
    return (
      <AuthShell title={t("auth_invite_invalid")}>
        <p className="text-sm text-muted-foreground" data-testid="text-invite-invalid">
          {t("auth_invite_invalid_desc")}
        </p>
        <Link href="/signin" className="mt-4 inline-block text-primary hover:underline">{t("auth_signin")}</Link>
      </AuthShell>
    );
  }

  // If not signed in → push to sign-up with prefilled email & token.
  if (!isAuthenticated) {
    return (
      <AuthShell
        title={t("auth_accept_title")}
        subtitle={t("auth_invited_detail").replace("{email}", invite.email).replace("{role}", invite.role)}
        footer={<p>{t("auth_create_to_continue")}</p>}
      >
        <div className="space-y-3">
          <Button asChild size="lg" className="w-full" data-testid="button-create-account">
            <Link href={`/signup?invite=${token}`}>{t("auth_signup_and_accept")}</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full" data-testid="button-signin-then-accept">
            <Link href={`/signin?next=/accept-invitation/${token}`}>{t("auth_have_account_short")}</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  // Signed in: confirm acceptance.
  const emailMatches = user?.email?.toLowerCase() === invite.email.toLowerCase();
  return (
    <AuthShell
      title={t("auth_join_title")}
      subtitle={t("auth_joining_as").replace("{role}", invite.role)}
    >
      {!emailMatches ? (
        <div className="space-y-3">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="text-email-mismatch">
            {t("auth_email_mismatch")
              .replace("{invite}", invite.email)
              .replace("{user}", user?.email ?? "")}
          </div>
          <Button onClick={() => signOut()} disabled={isSigningOut} variant="outline" className="w-full">
            {t("auth_sign_out")}
          </Button>
        </div>
      ) : (
        <Button
          size="lg"
          className="w-full"
          disabled={accept.isPending}
          onClick={() => accept.mutate()}
          data-testid="button-accept-invitation"
        >
          {accept.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("auth_accept_join")}
        </Button>
      )}
    </AuthShell>
  );
}
