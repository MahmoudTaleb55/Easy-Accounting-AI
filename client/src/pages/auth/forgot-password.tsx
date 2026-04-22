import { useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useLocale } from "@/contexts/locale-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "./auth-shell";
import { Loader2 } from "lucide-react";

const schema = z.object({ email: z.string().email() });

export default function ForgotPasswordPage() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [done, setDone] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "" } });
  const m = useMutation({
    mutationFn: async (v: z.infer<typeof schema>) => (await apiRequest("POST", "/api/auth/forgot-password", v)).json(),
    onSuccess: (data: any) => {
      setDone(true);
      if (data?.devResetLink) setDevLink(data.devResetLink);
    },
  });

  return (
    <AuthShell
      title={ar ? "استعادة كلمة المرور" : "Reset your password"}
      subtitle={ar ? "أدخل بريدك وسنرسل لك رابط استعادة." : "Enter your email and we'll send you a reset link."}
      footer={
        <p>
          <Link
            href="/signin"
            data-testid="link-back-signin"
            className="text-primary underline-offset-4 hover:underline"
          >
            {ar ? "العودة لتسجيل الدخول" : "Back to sign in"}
          </Link>
        </p>
      }
    >
      {done ? (
        <div className="space-y-4" data-testid="success-forgot-password">
          <div className="rounded-md border border-success/30 bg-success/5 px-3 py-3 text-sm">
            {ar
              ? "إن وُجد حساب بهذا البريد، فقد أرسلنا تعليمات الاستعادة."
              : "If an account with that email exists, we've sent reset instructions."}
          </div>
          {devLink && (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              <p className="mb-1 font-medium">{ar ? "رابط (وضع التطوير)" : "Dev reset link"}</p>
              <a
                href={devLink}
                className="block break-all font-mono text-primary underline-offset-4 hover:underline"
                data-testid="link-dev-reset"
              >
                {devLink}
              </a>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-4" data-testid="form-forgot-password">
          <div className="space-y-2">
            <Label htmlFor="email">{ar ? "البريد الإلكتروني" : "Email"}</Label>
            <Input id="email" type="email" data-testid="input-email" {...form.register("email")} />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={m.isPending} data-testid="button-submit-forgot">
            {m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {ar ? "إرسال رابط الاستعادة" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
