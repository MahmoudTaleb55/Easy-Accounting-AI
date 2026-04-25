import { useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { useLocale } from "@/contexts/locale-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "./auth-shell";
import { Loader2 } from "lucide-react";

const schema = z.object({
  password: z.string().min(8, "8+ characters"),
  confirm: z.string().min(8),
}).refine((d) => d.password === d.confirm, { message: "Passwords don't match", path: ["confirm"] });

export default function ResetPasswordPage() {
  const [, params] = useRoute<{ token: string }>("/reset-password/:token");
  const token = params?.token ?? "";
  const [, navigate] = useLocation();
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });

  const m = useMutation({
    mutationFn: async (v: z.infer<typeof schema>) =>
      (await apiRequest("POST", "/api/auth/reset-password", { token, password: v.password })).json(),
    onSuccess: () => navigate("/signin?reset=ok"),
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
      title={ar ? "اختر كلمة مرور جديدة" : "Choose a new password"}
      subtitle={ar ? "ستُسجّل الدخول بكلمة المرور الجديدة." : "You'll sign in with the new password next."}
      footer={
        <p>
          <Link href="/signin" className="text-primary underline-offset-4 hover:underline">{ar ? "العودة" : "Back"}</Link>
        </p>
      }
    >
      <form onSubmit={form.handleSubmit((v) => { setServerError(null); m.mutate(v); })} className="space-y-4" data-testid="form-reset-password">
        <div className="space-y-2">
          <Label htmlFor="password">{ar ? "كلمة المرور الجديدة" : "New password"}</Label>
          <Input id="password" type="password" data-testid="input-password" {...form.register("password")} />
          {form.formState.errors.password && <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">{ar ? "تأكيد كلمة المرور" : "Confirm password"}</Label>
          <Input id="confirm" type="password" data-testid="input-confirm" {...form.register("confirm")} />
          {form.formState.errors.confirm && <p className="text-xs text-destructive">{form.formState.errors.confirm.message}</p>}
        </div>
        {serverError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{serverError}</div>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={m.isPending} data-testid="button-submit-reset">
          {m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {ar ? "تحديث كلمة المرور" : "Update password"}
        </Button>
      </form>
    </AuthShell>
  );
}
