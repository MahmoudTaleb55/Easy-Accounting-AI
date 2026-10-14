import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateProfileSchema, changePasswordSchema } from "@shared/schema";
import type { z } from "zod";
import type { User } from "@shared/models/auth";

type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useLocale, type Locale } from "@/contexts/locale-context";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/i18n/dict";
import { mapErrorKey } from "@/lib/error-messages";
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
  const t = useT();
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
      toast({ title: t("prof_saved") });
    },
    onError: (e) => toast({ title: t("settings_error"), description: t(mapErrorKey(e)), variant: "destructive" }),
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
      toast({ title: t("prof_photo_updated") });
    },
    onError: (e) =>
      toast({
        title: t("prof_upload_failed"),
        description: t(mapErrorKey(e)),
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
      toast({ title: t("prof_photo_removed") });
    },
    onError: (e) => toast({ title: t("settings_error"), description: t(mapErrorKey(e)), variant: "destructive" }),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  function handleFile(file: File | null | undefined) {
    if (!file) return;
    if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
      toast({
        title: t("prof_bad_type"),
        description: t("prof_bad_type_desc"),
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast({
        title: t("prof_too_large"),
        description: t("prof_too_large_desc"),
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
      toast({ title: t("prof_password_updated") });
    },
    onError: (e: unknown) => {
      // Surface a localized message by status rather than the raw server
      // body so the error reads in the active UI language.
      setPasswordError(t(mapErrorKey(e)));
    },
  });

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "—";
  const initials =
    ((user?.firstName ?? "")[0] ?? "") + ((user?.lastName ?? "")[0] ?? "") ||
    (user?.email?.[0]?.toUpperCase() ?? "?");

  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">{t("prof_title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("prof_subtitle")}
        </p>
      </header>

      <Card data-testid="card-profile">
        <CardHeader>
          <CardTitle>{t("prof_personal_info")}</CardTitle>
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
                    {t("prof_choose_photo")}
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
                      {t("prof_remove_photo")}
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t("prof_drop_hint")}
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
                <Label htmlFor="firstName">{t("prof_first_name")}</Label>
                <Input
                  id="firstName"
                  maxLength={80}
                  data-testid="input-first-name"
                  {...profileForm.register("firstName")}
                />
                {profileForm.formState.errors.firstName && (
                  <p className="text-xs text-destructive" data-testid="error-first-name">
                    {t("prof_first_invalid")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">{t("prof_last_name")}</Label>
                <Input
                  id="lastName"
                  maxLength={80}
                  data-testid="input-last-name"
                  {...profileForm.register("lastName")}
                />
                {profileForm.formState.errors.lastName && (
                  <p className="text-xs text-destructive" data-testid="error-last-name">
                    {t("prof_last_invalid")}
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("prof_pref_lang")}</Label>
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
              {t("prof_save_changes")}
            </Button>
          </form>
        </CardContent>
      </Card>

      {user?.provider === "local" && (
        <Card data-testid="card-password">
          <CardHeader>
            <CardTitle>{t("prof_change_password")}</CardTitle>
            <CardDescription>{t("prof_password_hint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={passwordForm.handleSubmit((v) => { setPasswordError(null); changePw.mutate(v); })} className="space-y-4" data-testid="form-change-password">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">{t("prof_current_password")}</Label>
                <Input id="currentPassword" type="password" data-testid="input-current-password" {...passwordForm.register("currentPassword")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">{t("prof_new_password")}</Label>
                <Input id="newPassword" type="password" data-testid="input-new-password" {...passwordForm.register("newPassword")} />
              </div>
              {passwordError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="error-change-password">
                  {passwordError}
                </div>
              )}
              <Button type="submit" disabled={changePw.isPending} data-testid="button-change-password">
                {changePw.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("prof_update_password")}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <ActiveSessionsCard locale={locale} />

      <Card data-testid="card-session">
        <CardHeader>
          <CardTitle>{t("prof_session")}</CardTitle>
          <CardDescription>{t("prof_session_desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => signOut()} disabled={isSigningOut} data-testid="button-signout">
            <LogOut className="mr-2 h-4 w-4" />
            {t("prof_sign_out")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

type ActiveSession = { sid: string; expiresAt: string; isCurrent: boolean; provider: string };

function ActiveSessionsCard({ locale }: { locale: Locale }) {
  const { toast } = useToast();
  const t = useT();
  const { data: sessions, isLoading } = useQuery<ActiveSession[]>({ queryKey: ["/api/auth/sessions"] });

  const signOutOthers = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/auth/sessions/sign-out-others", {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/sessions"] });
      toast({ title: t("prof_signed_out_others") });
    },
    onError: (e: unknown) => toast({ title: t("settings_error"), description: t(mapErrorKey(e)), variant: "destructive" }),
  });

  const others = (sessions ?? []).filter((s) => !s.isCurrent);

  return (
    <Card data-testid="card-active-sessions">
      <CardHeader>
        <CardTitle>{t("prof_active_sessions")}</CardTitle>
        <CardDescription>
          {t("prof_active_sessions_desc")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("prof_loading")}
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
                    {s.provider === "local" ? t("prof_email_password") : "SSO"}
                  </span>
                  {s.isCurrent && (
                    <span className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {t("prof_current")}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("prof_expires")} {new Date(s.expiresAt).toLocaleString(locale)}
                </span>
              </li>
            ))}
            {(sessions ?? []).length === 0 && (
              <li className="text-sm text-muted-foreground">{t("prof_no_sessions")}</li>
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
          {t("prof_signout_others")}
        </Button>
      </CardContent>
    </Card>
  );
}
