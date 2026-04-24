import { useEffect, useState } from "react";
import { X, Eye } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useT } from "@/i18n/dict";

const SESSION_KEY = "app.readonly_banner.dismissed";

export function ReadOnlyBanner() {
  const { role } = useAuth();
  const t = useT();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (dismissed) {
      try {
        window.sessionStorage.setItem(SESSION_KEY, "1");
      } catch {}
    }
  }, [dismissed]);

  if (dismissed) return null;
  if (role !== "viewer") return null;

  const message = t("readonly_banner_viewer");

  return (
    <div
      role="status"
      data-testid="banner-readonly"
      className="border-b border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-4 py-2 md:px-8 lg:px-10">
        <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="flex-1 text-sm leading-snug" data-testid="text-readonly-message">
          {message}
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t("readonly_banner_dismiss")}
          data-testid="button-dismiss-readonly"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-amber-900/80 transition-colors hover:bg-amber-100 hover:text-amber-900 dark:text-amber-100/80 dark:hover:bg-amber-900/40 dark:hover:text-amber-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
