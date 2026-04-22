import { useState, useEffect } from "react";
import { useLocation, Link, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signUpSchema, type SignUpInput } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocale } from "@/contexts/locale-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "./auth-shell";
import { SiReplit } from "react-icons/si";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export default function SignUpPage() {
  const [, navigate] = useLocation();
  const { locale } = useLocale();
  const ar = locale === "ar";
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

  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      email: "",
      password: "",
      firstName: "",
      lastName: "",
      preferredLocale: ar ? "ar" : "en",
      invitationToken: inviteToken ?? null,
    },
  });

  useEffect(() => {
    if (invite?.email) form.setValue("email", invite.email);
    if (inviteToken) form.setValue("invitationToken", inviteToken);
  }, [invite, inviteToken]);

  const m = useMutation({
    mutationFn: async (input: SignUpInput) => {
      const res = await apiRequest("POST", "/api/auth/signup", input);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/memberships"] });
      navigate("/app");
    },
    onError: (err: Error) => {
      const msg = err.message.replace(/^\d+:\s*/, "");
      try {
        const j = JSON.parse(msg);
        setServerError(j.message ?? msg);
      } catch {
        setServerError(msg);
      }
    },
  });

  return (
    <AuthShell
      title={ar ? "ابدأ مساحة عملك" : "Start your workspace"}
      subtitle={
        invite
          ? ar
            ? `تمت دعوتك للانضمام بدور ${invite.role}.`
            : `You've been invited as ${invite.role}.`
          : ar
          ? "أنشئ حساباً مجانياً وادعُ فريقك خلال دقائق."
          : "Create a free account and invite your team in minutes."
      }
      side={{
        title: ar ? "ابدأ خلال 90 ثانية." : "Up and running in 90 seconds.",
        lede: ar
          ? "أنت تنشئ مساحة عمل مع تحكّم كامل بالأدوار، مدعوم بـ IFRS ومتعدد العملات."
          : "You'll get a workspace with full role controls, IFRS-aligned books, multi-currency.",
        bullets: ar
          ? ["لا حاجة لبطاقة ائتمان.", "أربعة أدوار مع صلاحيات دقيقة.", "تشفير كلمات المرور والجلسات."]
          : ["No credit card required.", "Four granular roles.", "Hashed passwords + secure sessions."],
      }}
      footer={
        <p>
          {ar ? "لديك حساب؟ " : "Already have an account? "}
          <Link href="/signin">
            <a className="font-medium text-primary underline-offset-4 hover:underline" data-testid="link-to-signin">
              {ar ? "تسجيل الدخول" : "Sign in"}
            </a>
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
            <Label htmlFor="firstName">{ar ? "الاسم الأول" : "First name"}</Label>
            <Input id="firstName" data-testid="input-first-name" {...form.register("firstName")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">{ar ? "اسم العائلة" : "Last name"}</Label>
            <Input id="lastName" data-testid="input-last-name" {...form.register("lastName")} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">{ar ? "البريد الإلكتروني" : "Email"}</Label>
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
          <Label htmlFor="password">{ar ? "كلمة المرور (٨ أحرف على الأقل)" : "Password (8+ chars)"}</Label>
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

        {serverError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="error-signup">
            {serverError}
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={m.isPending} data-testid="button-submit-signup">
          {m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {ar ? "إنشاء الحساب" : "Create account"}
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
          data-testid="button-replit-signup"
        >
          <SiReplit className="h-4 w-4" />
          {ar ? "متابعة باستخدام Replit" : "Continue with Replit"}
        </Button>
      </form>
    </AuthShell>
  );
}
