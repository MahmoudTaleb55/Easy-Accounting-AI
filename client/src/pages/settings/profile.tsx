import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateProfileSchema, changePasswordSchema } from "@shared/schema";
import type { z } from "zod";
import type { User } from "@shared/models/auth";

type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
import { apiRequest, ApiError, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/contexts/locale-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AvatarCropper } from "@/components/profile/avatar-cropper";
import { Loader2, LogOut, Upload, Trash2 } from "lucide-react";

const ACCEPTED_AVATAR_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export default function ProfilePage() {
  const { user, signOut, isSigningOut } = useAuth();
  const { locale, setLocale } = useLocale();
  const { toast } = useToast();
  const ar = locale === "ar";

  // The avatar image is now managed by the upload picker below and is
  // persisted by its own mutation, so it is intentionally not part of
  // this form (which would otherwise have to revalidate the relative
  // /objects/avatars URL we save on the server after the upload).
  const profileForm = useForm({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      preferredLocale: (user?.preferredLocale as "ar" | "en") ?? locale,
    },
  });

  useEffect(() => {
    if (user) {
      profileForm.reset({
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        preferredLocale: (user.preferredLocale as "ar" | "en") ?? "ar",
      });
    }
  }, [user]);

  const passwordForm = useForm({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const saveProfile = useMutation<User, Error, UpdateProfileInput>({
    mutationFn: async (v) => (await apiRequest("PATCH", "/api/auth/profile", v)).json(),
    onSuccess: (u) => {
      // Seed the cache so the topbar avatar/name update on the very next paint,
      // then invalidate so any other consumer (memberships, etc.) refetches.
      queryClient.setQueryData<User>(["/api/auth/user"], u);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      if (u?.preferredLocale === "ar" || u?.preferredLocale === "en") {
        setLocale(u.preferredLocale);
      }
      toast({ title: ar ? "تم الحفظ" : "Saved" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const uploadAvatar = useMutation<User, Error, File>({
    mutationFn: async (file) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/auth/profile/avatar", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        let message = text;
        try { message = JSON.parse(text).message ?? text; } catch { /* leave as text */ }
        throw new Error(message || `${res.status}`);
      }
      return (await res.json()) as User;
    },
    onSuccess: (u) => {
      // Bust caches for the topbar avatar (keyed off /api/auth/user) and any
      // route that lists members so the new image shows up immediately.
      queryClient.setQueryData<User>(["/api/auth/user"], u);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/members"] });
      toast({ title: ar ? "تم تحديث الصورة" : "Photo updated" });
    },
    onError: (e) =>
      toast({
        title: ar ? "تعذر رفع الصورة" : "Upload failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const removeAvatar = useMutation<User, Error, void>({
    mutationFn: async () =>
      (await apiRequest("PATCH", "/api/auth/profile", { profileImageUrl: null })).json(),
    onSuccess: (u) => {
      queryClient.setQueryData<User>(["/api/auth/user"], u);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/members"] });
      toast({ title: ar ? "تم حذف الصورة" : "Photo removed" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  function handleFile(file: File | null | undefined) {
    if (!file) return;
    if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
      toast({
        title: ar ? "نوع ملف غير مدعوم" : "Unsupported file type",
        description: ar
          ? "اختر صورة بصيغة PNG أو JPEG أو WEBP أو GIF."
          : "Choose a PNG, JPEG, WEBP or GIF image.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast({
        title: ar ? "الصورة كبيرة جداً" : "Image too large",
        description: ar
          ? "الحد الأقصى لحجم الصورة هو ٢ ميغابايت."
          : "Maximum image size is 2 MB.",
        variant: "destructive",
      });
      return;
    }
    setPendingFile(file);
  }

  const changePw = useMutation<{ ok: true }, Error, ChangePasswordInput>({
    mutationFn: async (v) => (await apiRequest("POST", "/api/auth/change-password", v)).json(),
    onSuccess: () => {
      passwordForm.reset();
      toast({ title: ar ? "تم تغيير كلمة المرور" : "Password updated" });
    },
    onError: (e: Error) => {
      const bodyMessage =
        e instanceof ApiError && e.body && typeof e.body === "object"
          ? (e.body as { message?: unknown }).message
          : undefined;
      setPasswordError(typeof bodyMessage === "string" ? bodyMessage : e.message);
    },
  });

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "—";
  const initials =
    ((user?.firstName ?? "")[0] ?? "") + ((user?.lastName ?? "")[0] ?? "") ||
    (user?.email?.[0]?.toUpperCase() ?? "?");

  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">{ar ? "الملف الشخصي" : "Your profile"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ar ? "حدّث معلوماتك الشخصية وتفضيلاتك." : "Update your personal info and preferences."}
        </p>
      </header>

      <Card data-testid="card-profile">
        <CardHeader>
          <CardTitle>{ar ? "المعلومات الشخصية" : "Personal info"}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-6 flex items-start gap-4">
            <Avatar className="h-20 w-20">
              {user?.profileImageUrl && <AvatarImage src={user.profileImageUrl} alt={fullName} />}
              <AvatarFallback className="text-lg">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-sm font-medium" data-testid="text-profile-name">{fullName}</p>
                <p className="text-xs text-muted-foreground" data-testid="text-profile-email">{user?.email}</p>
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  handleFile(e.dataTransfer.files?.[0]);
                }}
                className={[
                  "rounded-md border border-dashed px-4 py-3 transition-colors",
                  isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25",
                ].join(" ")}
                data-testid="dropzone-avatar"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadAvatar.isPending}
                    data-testid="button-choose-photo"
                  >
                    {uploadAvatar.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {ar ? "اختر صورة" : "Choose photo"}
                  </Button>
                  {user?.profileImageUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeAvatar.mutate()}
                      disabled={removeAvatar.isPending}
                      data-testid="button-remove-photo"
                    >
                      {removeAvatar.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 h-4 w-4" />
                      )}
                      {ar ? "إزالة الصورة" : "Remove photo"}
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {ar
                      ? "أو اسحب وأسقط صورة هنا. PNG / JPEG / WEBP / GIF حتى ٢ ميغابايت."
                      : "Or drag & drop. PNG, JPEG, WEBP or GIF up to 2 MB."}
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_AVATAR_TYPES.join(",")}
                  className="hidden"
                  data-testid="input-avatar-file"
                  onChange={(e) => {
                    handleFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
          </div>

          <AvatarCropper
            file={pendingFile}
            ar={ar}
            onCancel={() => setPendingFile(null)}
            onCropped={(file) => {
              setPendingFile(null);
              uploadAvatar.mutate(file);
            }}
          />

          <form
            onSubmit={profileForm.handleSubmit((v) => saveProfile.mutate(v))}
            className="space-y-4"
            data-testid="form-profile"
            noValidate
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">{ar ? "الاسم الأول" : "First name"}</Label>
                <Input
                  id="firstName"
                  maxLength={80}
                  data-testid="input-first-name"
                  {...profileForm.register("firstName")}
                />
                {profileForm.formState.errors.firstName && (
                  <p className="text-xs text-destructive" data-testid="error-first-name">
                    {ar ? "الاسم الأول غير صالح" : "Invalid first name"}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">{ar ? "اسم العائلة" : "Last name"}</Label>
                <Input
                  id="lastName"
                  maxLength={80}
                  data-testid="input-last-name"
                  {...profileForm.register("lastName")}
                />
                {profileForm.formState.errors.lastName && (
                  <p className="text-xs text-destructive" data-testid="error-last-name">
                    {ar ? "اسم العائلة غير صالح" : "Invalid last name"}
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>{ar ? "اللغة المفضلة" : "Preferred language"}</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={profileForm.watch("preferredLocale") === "ar" ? "default" : "outline"}
                  onClick={() => profileForm.setValue("preferredLocale", "ar")}
                  data-testid="button-locale-ar"
                >العربية</Button>
                <Button
                  type="button"
                  variant={profileForm.watch("preferredLocale") === "en" ? "default" : "outline"}
                  onClick={() => profileForm.setValue("preferredLocale", "en")}
                  data-testid="button-locale-en"
                >English</Button>
              </div>
            </div>
            <Button type="submit" disabled={saveProfile.isPending} data-testid="button-save-profile">
              {saveProfile.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {ar ? "حفظ التغييرات" : "Save changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {user?.provider === "local" && (
        <Card data-testid="card-password">
          <CardHeader>
            <CardTitle>{ar ? "تغيير كلمة المرور" : "Change password"}</CardTitle>
            <CardDescription>{ar ? "اختر كلمة مرور قوية، ٨ أحرف على الأقل." : "Pick a strong password, 8 characters or more."}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={passwordForm.handleSubmit((v) => { setPasswordError(null); changePw.mutate(v); })} className="space-y-4" data-testid="form-change-password">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">{ar ? "كلمة المرور الحالية" : "Current password"}</Label>
                <Input id="currentPassword" type="password" data-testid="input-current-password" {...passwordForm.register("currentPassword")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">{ar ? "كلمة المرور الجديدة" : "New password"}</Label>
                <Input id="newPassword" type="password" data-testid="input-new-password" {...passwordForm.register("newPassword")} />
              </div>
              {passwordError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="error-change-password">
                  {passwordError}
                </div>
              )}
              <Button type="submit" disabled={changePw.isPending} data-testid="button-change-password">
                {changePw.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {ar ? "تحديث" : "Update password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <ActiveSessionsCard ar={ar} />

      <Card data-testid="card-session">
        <CardHeader>
          <CardTitle>{ar ? "الجلسة" : "Session"}</CardTitle>
          <CardDescription>{ar ? "تسجيل الخروج من جميع الأجهزة." : "Sign out of this session."}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => signOut()} disabled={isSigningOut} data-testid="button-signout">
            <LogOut className="mr-2 h-4 w-4" />
            {ar ? "تسجيل الخروج" : "Sign out"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

type ActiveSession = { sid: string; expiresAt: string; isCurrent: boolean; provider: string };

function ActiveSessionsCard({ ar }: { ar: boolean }) {
  const { toast } = useToast();
  const { data: sessions, isLoading } = useQuery<ActiveSession[]>({ queryKey: ["/api/auth/sessions"] });

  const signOutOthers = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/auth/sessions/sign-out-others", {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/sessions"] });
      toast({ title: ar ? "تم تسجيل الخروج من الجلسات الأخرى" : "Signed out of other sessions" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const others = (sessions ?? []).filter((s) => !s.isCurrent);

  return (
    <Card data-testid="card-active-sessions">
      <CardHeader>
        <CardTitle>{ar ? "الجلسات النشطة" : "Active sessions"}</CardTitle>
        <CardDescription>
          {ar ? "الأجهزة المسجّل عليها حسابك حالياً." : "Devices currently signed into your account."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {ar ? "جارٍ التحميل…" : "Loading…"}
          </div>
        ) : (
          <ul className="space-y-2" data-testid="list-sessions">
            {(sessions ?? []).map((s) => (
              <li
                key={s.sid}
                className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm"
                data-testid={`row-session-${s.sid.slice(0, 8)}`}
              >
                <div>
                  <span className="font-medium">
                    {s.provider === "local"
                      ? ar ? "بريد + كلمة مرور" : "Email & password"
                      : ar ? "SSO" : "SSO"}
                  </span>
                  {s.isCurrent && (
                    <span className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {ar ? "الحالية" : "current"}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {ar ? "تنتهي" : "expires"} {new Date(s.expiresAt).toLocaleString()}
                </span>
              </li>
            ))}
            {(sessions ?? []).length === 0 && (
              <li className="text-sm text-muted-foreground">{ar ? "لا توجد جلسات أخرى." : "No active sessions."}</li>
            )}
          </ul>
        )}
        <Button
          variant="outline"
          onClick={() => signOutOthers.mutate()}
          disabled={signOutOthers.isPending || others.length === 0}
          data-testid="button-signout-others"
        >
          {signOutOthers.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {ar ? "تسجيل الخروج من الأجهزة الأخرى" : "Sign out other devices"}
        </Button>
      </CardContent>
    </Card>
  );
}
