import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertTriangle, RefreshCw, ExternalLink } from "lucide-react";
import { useLocale } from "@/contexts/locale-context";

interface ErrorStateProps {
  title?: string;
  cause?: string;
  onRetry?: () => void;
  onOpenStatus?: () => void;
  className?: string;
  testId?: string;
}

export function ErrorState({
  title,
  cause,
  onRetry,
  onOpenStatus,
  className,
  testId,
}: ErrorStateProps) {
  const { locale } = useLocale();
  const t = {
    title: title || (locale === "ar" ? "تعذّر تحميل البيانات" : "We couldn't load that"),
    cause: cause || (locale === "ar" ? "حدث خلل مؤقّت في الخدمة." : "A temporary service issue occurred."),
    retry: locale === "ar" ? "إعادة المحاولة" : "Retry",
    status: locale === "ar" ? "افتح حالة الخدمة" : "Open status",
  };
  return (
    <Card
      variant="default"
      className={cn(
        "px-6 py-10 flex flex-col items-center text-center border-destructive/30 bg-destructive/5",
        className
      )}
      data-testid={testId || "error-state"}
    >
      <div className="mx-auto mb-3 inline-flex items-center justify-center w-10 h-10 rounded-md bg-destructive/10 border border-destructive/30 text-destructive">
        <AlertTriangle className="w-5 h-5" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{t.title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground max-w-sm">{t.cause}</p>
      <div className="mt-5 flex items-center gap-2 flex-wrap justify-center">
        {onRetry && (
          <Button size="sm" onClick={onRetry} data-testid="error-state-retry">
            <RefreshCw className="w-3.5 h-3.5" />
            {t.retry}
          </Button>
        )}
        {onOpenStatus && (
          <Button size="sm" variant="ghost" onClick={onOpenStatus} data-testid="error-state-status">
            <ExternalLink className="w-3.5 h-3.5" />
            {t.status}
          </Button>
        )}
      </div>
    </Card>
  );
}
