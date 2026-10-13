import { useState, useEffect } from "react";
import { useLocation, Link, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signUpSchema, type SignUpInput } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocale } from "@/contexts/locale-context";
import { useT } from "@/i18n/dict";
import { mapErrorKey } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AuthShell } from "./auth-shell";
import { LogIn } from "lucide-react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

// Global-first ordering: the major international currencies lead, then the
// MENA set the platform also supports. The whole list stays available.
const CURRENCIES: Array<{ code: string }> = [
  { code: "USD" }, { code: "EUR" }, { code: "GBP" }, { code: "INR" },
  { code: "SAR" }, { code: "AED" }, { code: "KWD" }, { code: "QAR" },
  { code: "BHD" }, { code: "OMR" }, { code: "EGP" }, { code: "JOD" },
];

// Locale-aware currency display name (built-in Intl, no new dependency). Falls
// back to the ISO code if the runtime can't resolve a localized name.
function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export default function SignUpPage() {
  const [, navigate] = useLocation();
  const { locale } = useLocale();
  const ar = locale === "ar";
  const t = useT();
  const [serverError, setServerError] = useState<string | null>(null);
  const { isAuthenticated } = useAuth();
  useEffect(() => {
    if (isAuthenticated) navigate("/app");
  }, [isAuthenticated, navigate]);

  // Optional invitation token from URL: /signup?invite=TOKEN
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const inviteToken = params.get("invite");

  const { data: invite } = useQuery<{ email: string; role: string; companyId: number } | null>({
    queryKey: ["/api/auth/invitations/by-token", inviteToken],
    queryFn: async () => {
      if (!inviteToken) return null;
      const r = await fetch(`/api/auth/invitations/by-token/${inviteToken}`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!inviteToken,
  });

  // OAuth works for sign-up too (first OAuth login auto-creates the account),
  // so offer the same provider buttons here. Only providers the server has
  // configured are shown — see /api/auth/providers (returns booleans only).
  const { data: providers } = useQuery<{ google: boolean; microsoft: boolean }>({
    queryKey: ["/api/auth/providers"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/auth/providers");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const anyProvider = Boolean(providers?.google || providers?.microsoft);

  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      email: "",
      password: "",
      firstName: "",
      lastName: "",
      preferredLocale: ar ? "ar" : "en",
      invitationToken: inviteToken ?? null,
      // Global-first default. Users pick their own books currency here; the
      // country pack they later select in Settings can override downstream.
      currencyCode: "USD",
    },
  });

  const currencyCode = form.watch("currencyCode") ?? "USD";

  useEffect(() => {
    if (invite?.email) form.setValue("email", invite.email);
    if (inviteToken) form.setValue("invitationToken", inviteToken);
  }, [invite, inviteToken]);

  const m = useMutation<unknown, Error, SignUpInput>({
    mutationFn: async (input: SignUpInput) => {
      const res = await apiRequest("POST", "/api/auth/signup", input);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/memberships"] });
      navigate("/app");
    },
    onError: (err: unknown) => {
      setServerError(t(mapErrorKey(err)));
    },
  });

  return (
    <AuthShell
      title={t("auth_start_workspace")}
      subtitle={
        invite
          ? t("auth_invited_as").replace("{role}", invite.role)
          : t("auth_signup_subtitle")
      }
      side={{
        title: t("auth_side_signup_title"),
        lede: t("auth_side_signup_lede"),
        bullets: [t("auth_bullet_nocard"), t("auth_bullet_four_roles"), t("auth_bullet_hashed")],
      }}
      footer={
        <p>
          {t("auth_have_account")}
          <Link
            href="/signin"
            data-testid="link-to-signin"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("auth_signin")}
          </Link>
        </p>
      }
    >
      <form
        className="space-y-4"
        onSubmit={form.handleSubmit((v) => {
          setServerError(null);
          m.mutate(v);
        })}
        data-testid="form-signup"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="firstName">{t("auth_first_name")}</Label>
            <Input id="firstName" data-testid="input-first-name" {...form.register("firstName")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">{t("auth_last_name")}</Label>
            <Input id="lastName" data-testid="input-last-name" {...form.register("lastName")} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">{t("auth_email")}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            disabled={!!invite}
            data-testid="input-email"
            {...form.register("email")}
          />
          {form.formState.errors.email && <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">{t("auth_password_hint")}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            data-testid="input-password"
            {...form.register("password")}
          />
          {form.formState.errors.password && (
            <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
          )}
        </div>

        {!invite && (
          <div className="space-y-2">
            <Label htmlFor="currency">{t("auth_books_currency")}</Label>
            <Select
              value={currencyCode}
              onValueChange={(code) => {
                const c = CURRENCIES.find((x) => x.code === code);
                if (!c) return;
                form.setValue("currencyCode", c.code, { shouldDirty: true });
              }}
            >
              <SelectTrigger id="currency" data-testid="select-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code} data-testid={`option-currency-${c.code}`}>
                    <span className="font-mono text-xs text-muted-foreground me-2">{c.code}</span>
                    {currencyName(c.code, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("auth_currency_hint")}
            </p>
          </div>
        )}

        {serverError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="error-signup">
            {serverError}
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={m.isPending} data-testid="button-submit-signup">
          {m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("auth_create_account")}
        </Button>

        {anyProvider && (
          <>
            <div className="relative my-2">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase tracking-wider">
                <span className="bg-background px-3 text-muted-foreground">{t("auth_or")}</span>
              </div>
            </div>

            {providers?.google && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full gap-2"
                onClick={() => (window.location.href = "/api/auth/login/google")}
                data-testid="button-sso-google"
              >
                <LogIn className="h-4 w-4" />
                {t("auth_continue_google")}
              </Button>
            )}

            {providers?.microsoft && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full gap-2"
                onClick={() => (window.location.href = "/api/auth/login/microsoft")}
                data-testid="button-sso-microsoft"
              >
                <LogIn className="h-4 w-4" />
                {t("auth_continue_microsoft")}
              </Button>
            )}
          </>
        )}

      </form>
    </AuthShell>
  );
}
