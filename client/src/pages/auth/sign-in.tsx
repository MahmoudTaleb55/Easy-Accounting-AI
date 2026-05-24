import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signInSchema, type SignInInput } from "@shared/schema";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocale } from "@/contexts/locale-context";
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
  const { toast } = useToast();
  const { locale } = useLocale();
  const ar = locale === "ar";
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
    onError: (err: Error) => {
      const bodyMessage =
        err instanceof ApiError && err.body && typeof err.body === "object"
          ? (err.body as { message?: unknown }).message
          : undefined;
      setServerError(typeof bodyMessage === "string" ? bodyMessage : err.message);
    },
  });

  return (
    <AuthShell
      title={ar ? "أهلاً بعودتك" : "Welcome back"}
      subtitle={ar ? "سجّل دخولك للمتابعة إلى مساحة عملك." : "Sign in to continue to your workspace."}
      side={{
        title: ar ? "كل أرقامك في مكان واحد." : "All your numbers, one place.",
        lede: ar
          ? "محاسبة بمعايير دولية، تقارير لحظية، وفريق مدعو بصلاحيات دقيقة."
          : "IFRS-aligned accounting, real-time reports, and granular team permissions.",
        bullets: ar
          ? ["دعم العربية والإنجليزية مع RTL/LTR.", "أدوار: مالك، محاسب، مراجع، قراءة فقط.", "تدقيق وسجلات لكل تعديل."]
          : ["Bilingual AR/EN with full RTL/LTR.", "Roles: Admin, Accountant, Reviewer, Read-only.", "Audit trail on every change."],
      }}
      footer={
        <p>
          {ar ? "ليس لديك حساب؟ " : "Don't have an account? "}
          <Link
            href="/signup"
            data-testid="link-to-signup"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {ar ? "أنشئ حساباً" : "Create one"}
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
          <Label htmlFor="email">{ar ? "البريد الإلكتروني" : "Email"}</Label>
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
            <Label htmlFor="password">{ar ? "كلمة المرور" : "Password"}</Label>
            <Link
              href="/forgot-password"
              data-testid="link-forgot-password"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {ar ? "نسيت كلمة المرور؟" : "Forgot password?"}
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
          {ar ? "تسجيل الدخول" : "Sign in"}
        </Button>

        <div className="relative my-2">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase tracking-wider">
            <span className="bg-background px-3 text-muted-foreground">{ar ? "أو" : "or"}</span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full gap-2"
          onClick={() => (window.location.href = "/api/login")}
          data-testid="button-replit-login"
        >
          <LogIn className="h-4 w-4" />
          {ar ? "متابعة بحساب المؤسسة (SSO)" : "Continue with SSO"}
        </Button>
      </form>
    </AuthShell>
  );
}
