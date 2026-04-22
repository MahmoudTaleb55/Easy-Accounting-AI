import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/contexts/locale-context";
import { ShieldCheck, AlertCircle, CheckCircle2 } from "lucide-react";

export default function InviteAcceptPage() {
  const { locale } = useLocale();
  const [, params] = useRoute("/invite/:token");
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/team/invites/accept", {
        token: params?.token,
        name: name.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      setDone(true);
      setError(null);
      queryClient.invalidateQueries();
      window.setTimeout(() => navigate("/app/settings"), 1200);
    },
    onError: (e: any) => setError(e?.message || (locale === "ar" ? "تعذر قبول الدعوة" : "Could not accept invite")),
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4" dir={locale === "ar" ? "rtl" : "ltr"}>
      <Card className="w-full max-w-md" data-testid="card-invite-accept">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            {locale === "ar" ? "قبول الدعوة" : "Accept invite"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {done ? (
            <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                {locale === "ar"
                  ? "تم قبول الدعوة. سيتم تحويلك خلال لحظات…"
                  : "Invite accepted. Redirecting…"}
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {locale === "ar"
                  ? "أدخل اسمك (اختياري) لقبول الدعوة والانضمام إلى فريق العمل."
                  : "Enter your name (optional) to accept the invite and join the workspace."}
              </p>
              <div className="space-y-2">
                <Label htmlFor="invite-name">{locale === "ar" ? "الاسم" : "Display name"}</Label>
                <Input
                  id="invite-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={locale === "ar" ? "كما تريد أن يراه الفريق" : "How your team will see you"}
                  data-testid="input-accept-name"
                />
              </div>
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              <Button
                onClick={() => accept.mutate()}
                disabled={accept.isPending}
                className="w-full"
                data-testid="button-accept-invite"
              >
                {accept.isPending
                  ? locale === "ar"
                    ? "جاري القبول..."
                    : "Accepting..."
                  : locale === "ar"
                  ? "قبول الانضمام"
                  : "Accept invite"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
