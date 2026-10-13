import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signInSchema, type SignInInput } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useT } from "@/i18n/dict";
import { mapErrorKey } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "./auth-shell";
import { LogIn } from "lucide-react";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";

export default function SignInPage() {
  const [, navigate] = useLocation();
  const t = useT();
  const [serverError, setServerError] = useState<string | null>(null);
  const { isAuthenticated } = useAuth();
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const next = params.get("next") || "/app";

  useEffect(() => {
    if (isAuthenticated) navigate(next);
  }, [isAuthenticated, next, navigate]);

  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  // Which OAuth providers the server actually has configured. We only render
  // a provider's button when it's enabled, so users never see a dead button
  // (the old single "/api/login" SSO button pointed at a route that doesn't
  // exist). The endpoint returns booleans only — no client secrets.
  const { data: providers } = useQuery<{ google: boolean; microsoft: boolean }>({
    queryKey: ["/api/auth/providers"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/auth/providers");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const anyProvider = Boolean(providers?.google || providers?.microsoft);

  const m = useMutation({
    mutationFn: async (input: SignInInput) => {
      const res = await apiRequest("POST", "/api/auth/signin", input);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/memberships"] });
      navigate(next);
    },
    onError: (err: unknown) => {
      // Surface a localized category message instead of the raw server text
      // (which may be Arabic) so it matches the active UI language.
      setServerError(t(mapErrorKey(err)));
    },
  });

  return (
    <AuthShell
      title={t("auth_welcome_back")}
      subtitle={t("auth_signin_subtitle")}
      side={{
        title: t("auth_side_signin_title"),
        lede: t("auth_side_signin_lede"),
        bullets: [t("auth_bullet_bilingual"), t("auth_bullet_roles"), t("auth_bullet_audit")],
      }}
      footer={
        <p>
          {t("auth_no_account")}
          <Link
            href="/signup"
            data-testid="link-to-signup"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("auth_create_one")}
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
        data-testid="form-signin"
      >
        <div className="space-y-2">
          <Label htmlFor="email">{t("auth_email")}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            data-testid="input-email"
            {...form.register("email")}
          />
          {form.formState.errors.email && (
            <p className="text-xs text-destructive" data-testid="error-email">
              {form.formState.errors.email.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="password">{t("auth_password")}</Label>
            <Link
              href="/forgot-password"
              data-testid="link-forgot-password"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("auth_forgot_q")}
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            data-testid="input-password"
            {...form.register("password")}
          />
          {form.formState.errors.password && (
            <p className="text-xs text-destructive" data-testid="error-password">
              {form.formState.errors.password.message}
            </p>
          )}
        </div>

        {serverError && (
          <div
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            data-testid="error-signin"
          >
            {serverError}
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={m.isPending} data-testid="button-submit-signin">
          {m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("auth_signin")}
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
