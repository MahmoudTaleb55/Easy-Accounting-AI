import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Webcam from "react-webcam";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Camera,
  RefreshCcw,
  SwitchCamera,
  Check,
  Loader2,
  ExternalLink,
} from "lucide-react";
import type { Locale } from "@/contexts/locale-context";
import { enhanceAndCompressDataUrl } from "@/lib/image-enhance";

type Strings = {
  title: string;
  description: string;
  capture: string;
  retake: string;
  accept: string;
  cancel: string;
  switchCamera: string;
  permissionDenied: string;
  unavailable: string;
  processing: string;
  hint: string;
  previewAlt: string;
  processingFailed: string;
  iframeBlocked: string;
  openInNewTab: string;
  insecureContext: string;
};

const I18N: Record<Locale, Strings> = {
  ar: {
    title: "تصوير الفاتورة بالكاميرا",
    description:
      "ضع الفاتورة أمام الكاميرا في إضاءة جيدة، ثم اضغط لالتقاط الصورة. سنقوم بتحسينها وضغطها قبل الرفع.",
    capture: "التقاط",
    retake: "إعادة التصوير",
    accept: "اعتماد ورفع",
    cancel: "إلغاء",
    switchCamera: "تبديل الكاميرا",
    permissionDenied:
      "تم رفض الوصول إلى الكاميرا. فعّل الإذن من إعدادات المتصفح ثم حاول مجدداً.",
    unavailable: "الكاميرا غير متاحة على هذا الجهاز.",
    processing: "جارٍ المعالجة…",
    hint: "نصيحة: حاذِ حواف الفاتورة داخل الإطار.",
    previewAlt: "معاينة الفاتورة الملتقطة",
    processingFailed: "تعذرت معالجة الصورة. حاول إعادة التصوير.",
    iframeBlocked:
      "الكاميرا محظورة داخل النافذة المضمّنة (iframe) في بيئة المعاينة. افتح التطبيق في علامة تبويب جديدة للسماح بالكاميرا.",
    openInNewTab: "فتح في علامة تبويب جديدة",
    insecureContext:
      "تتطلب الكاميرا اتصالاً آمناً (HTTPS) أو localhost.",
  },
  en: {
    title: "Capture invoice with camera",
    description:
      "Place the invoice in front of the camera under good lighting, then tap to capture. We will enhance and compress it before upload.",
    capture: "Capture",
    retake: "Retake",
    accept: "Accept & upload",
    cancel: "Cancel",
    switchCamera: "Switch camera",
    permissionDenied:
      "Camera access was denied. Enable the permission in your browser settings and try again.",
    unavailable: "No camera is available on this device.",
    processing: "Processing…",
    hint: "Tip: align the edges of the invoice within the frame.",
    previewAlt: "Preview of the captured invoice",
    processingFailed: "Could not process the image. Please retake the photo.",
    iframeBlocked:
      "Camera is blocked inside the embedded preview frame. Open the app in a new browser tab to allow the camera.",
    openInNewTab: "Open in a new tab",
    insecureContext: "Camera requires a secure connection (HTTPS) or localhost.",
  },
  de: {
    title: "Rechnung mit Kamera erfassen",
    description:
      "Halten Sie die Rechnung bei guter Beleuchtung vor die Kamera und tippen Sie zum Aufnehmen. Wir verbessern und komprimieren das Bild vor dem Hochladen.",
    capture: "Aufnehmen",
    retake: "Neu aufnehmen",
    accept: "Übernehmen & hochladen",
    cancel: "Abbrechen",
    switchCamera: "Kamera wechseln",
    permissionDenied:
      "Kamerazugriff wurde verweigert. Aktivieren Sie die Berechtigung in den Browsereinstellungen und versuchen Sie es erneut.",
    unavailable: "Auf diesem Gerät ist keine Kamera verfügbar.",
    processing: "Wird verarbeitet…",
    hint: "Tipp: Richten Sie die Kanten der Rechnung im Rahmen aus.",
    previewAlt: "Vorschau der erfassten Rechnung",
    processingFailed:
      "Das Bild konnte nicht verarbeitet werden. Bitte erneut aufnehmen.",
    iframeBlocked:
      "Die Kamera ist im eingebetteten Vorschau-Frame blockiert. Öffnen Sie die App in einem neuen Browser-Tab, um die Kamera zu erlauben.",
    openInNewTab: "In neuem Tab öffnen",
    insecureContext:
      "Die Kamera erfordert eine sichere Verbindung (HTTPS) oder localhost.",
  },
  fr: {
    title: "Capturer la facture avec la caméra",
    description:
      "Placez la facture devant la caméra avec un bon éclairage, puis appuyez pour capturer. Nous améliorerons et compresserons l'image avant l'envoi.",
    capture: "Capturer",
    retake: "Reprendre",
    accept: "Valider et envoyer",
    cancel: "Annuler",
    switchCamera: "Changer de caméra",
    permissionDenied:
      "L'accès à la caméra a été refusé. Activez l'autorisation dans les paramètres du navigateur et réessayez.",
    unavailable: "Aucune caméra n'est disponible sur cet appareil.",
    processing: "Traitement…",
    hint: "Astuce : alignez les bords de la facture dans le cadre.",
    previewAlt: "Aperçu de la facture capturée",
    processingFailed:
      "Impossible de traiter l'image. Veuillez reprendre la photo.",
    iframeBlocked:
      "La caméra est bloquée dans le cadre d'aperçu intégré. Ouvrez l'application dans un nouvel onglet du navigateur pour autoriser la caméra.",
    openInNewTab: "Ouvrir dans un nouvel onglet",
    insecureContext:
      "La caméra nécessite une connexion sécurisée (HTTPS) ou localhost.",
  },
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (file: File) => void;
  locale: Locale;
};

type EnvBlock =
  | { kind: "ok" }
  | { kind: "iframe"; topUrl: string }
  | { kind: "insecure" };

function detectCameraEnvironment(): EnvBlock {
  if (typeof window === "undefined") return { kind: "ok" };
  // Embedded inside another browsing context (e.g. the Replit workspace iframe).
  // The wrapper iframe must include `allow="camera"` in its Permissions-Policy
  // for getUserMedia to even prompt; without it the browser denies the request
  // silently with NotAllowedError, never showing the permission UI.
  const inIframe = window.self !== window.top;
  // Best-effort: feature-policy / permissions-policy check. Some browsers don't
  // expose this, so we treat `undefined` as "unknown — try anyway" and only
  // short-circuit when we can prove the camera feature is disallowed.
  const fp = (document as unknown as {
    featurePolicy?: { allowsFeature?: (name: string) => boolean };
    permissionsPolicy?: { allowsFeature?: (name: string) => boolean };
  });
  const policy = fp.featurePolicy ?? fp.permissionsPolicy;
  const cameraExplicitlyBlocked =
    typeof policy?.allowsFeature === "function"
      ? policy.allowsFeature("camera") === false
      : false;
  if (inIframe && cameraExplicitlyBlocked) {
    return { kind: "iframe", topUrl: window.location.href };
  }
  // Browsers require a secure context (HTTPS or localhost) for getUserMedia.
  if (!window.isSecureContext) {
    return { kind: "insecure" };
  }
  return { kind: "ok" };
}

export function CameraCaptureDialog({
  open,
  onOpenChange,
  onCapture,
  locale,
}: Props) {
  const t = I18N[locale] ?? I18N.en;
  const isRtl = locale === "ar";
  const webcamRef = useRef<Webcam>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment",
  );
  const [error, setError] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState<EnvBlock["kind"] | null>(null);
  const [processing, setProcessing] = useState(false);

  // Re-detect each time the dialog is opened so the user can fix permissions
  // and try again without a full reload.
  useEffect(() => {
    if (!open) return;
    const env = detectCameraEnvironment();
    if (env.kind === "ok") {
      setBlockReason(null);
      setError(null);
      return;
    }
    setBlockReason(env.kind);
    if (env.kind === "iframe") setError(t.iframeBlocked);
    else if (env.kind === "insecure") setError(t.insecureContext);
  }, [open, t.iframeBlocked, t.insecureContext]);

  const videoConstraints = useMemo(
    () => ({
      facingMode,
      width: { ideal: 1920 },
      height: { ideal: 1440 },
    }),
    [facingMode],
  );

  const handleCapture = useCallback(() => {
    const cam = webcamRef.current;
    if (!cam) return;
    const shot = cam.getScreenshot({ width: 1920, height: 1440 });
    if (!shot) {
      setError(t.unavailable);
      return;
    }
    setSnapshot(shot);
  }, [t.unavailable]);

  const handleRetake = useCallback(() => {
    setSnapshot(null);
  }, []);

  const handleAccept = useCallback(async () => {
    if (!snapshot) return;
    setProcessing(true);
    try {
      const finalFile = await enhanceAndCompressDataUrl(
        snapshot,
        "invoice-camera",
      );
      onCapture(finalFile);
      setSnapshot(null);
      onOpenChange(false);
    } catch {
      setError(t.processingFailed);
    } finally {
      setProcessing(false);
    }
  }, [snapshot, onCapture, onOpenChange, t.processingFailed]);

  const handleSwitch = useCallback(() => {
    setFacingMode((m) => (m === "environment" ? "user" : "environment"));
    setSnapshot(null);
  }, []);

  const handleUserMediaError = useCallback(
    (err: string | DOMException) => {
      const name = typeof err === "string" ? err : err.name;
      const inIframe =
        typeof window !== "undefined" && window.self !== window.top;
      if (
        name === "NotAllowedError" ||
        name === "PermissionDeniedError" ||
        name === "SecurityError"
      ) {
        // Inside an iframe whose Permissions-Policy doesn't allow `camera`, the
        // browser denies the request without ever prompting — that is the
        // single most common cause for our preview environment, so surface
        // the "open in a new tab" recovery instead of the generic message.
        if (inIframe) {
          setBlockReason("iframe");
          setError(t.iframeBlocked);
        } else {
          setError(t.permissionDenied);
        }
      } else {
        setError(t.unavailable);
      }
    },
    [t.permissionDenied, t.unavailable, t.iframeBlocked],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSnapshot(null);
          setError(null);
          setProcessing(false);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent
        className="max-w-2xl"
        dir={isRtl ? "rtl" : "ltr"}
        data-testid="dialog-camera-capture"
      >
        <DialogHeader>
          <DialogTitle data-testid="text-camera-title">{t.title}</DialogTitle>
          <DialogDescription data-testid="text-camera-description">
            {t.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div
            className="relative aspect-[4/3] w-full overflow-hidden rounded-md border border-border bg-black"
            data-testid="camera-stage"
          >
            {error ? (
              <div
                className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-white"
                data-testid="text-camera-error"
              >
                {error}
              </div>
            ) : snapshot ? (
              <img
                src={snapshot}
                alt={t.previewAlt}
                className="h-full w-full object-contain"
                data-testid="img-camera-preview"
              />
            ) : (
              <Webcam
                ref={webcamRef}
                audio={false}
                screenshotFormat="image/jpeg"
                screenshotQuality={0.95}
                videoConstraints={videoConstraints}
                onUserMediaError={handleUserMediaError}
                className="h-full w-full object-cover"
                data-testid="video-camera-stream"
              />
            )}
            {!error && !snapshot && (
              <div className="pointer-events-none absolute inset-0 border-2 border-white/40 m-6 rounded" />
            )}
          </div>
          {!error && !snapshot && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="text-camera-hint"
            >
              {t.hint}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="button-camera-cancel"
          >
            {t.cancel}
          </Button>
          {error && blockReason === "iframe" && (
            <Button
              type="button"
              onClick={() =>
                window.open(window.location.href, "_blank", "noopener")
              }
              data-testid="button-camera-open-new-tab"
            >
              <ExternalLink className="me-2 h-4 w-4" />
              {t.openInNewTab}
            </Button>
          )}
          {!error && !snapshot && (
            <Button
              type="button"
              variant="outline"
              onClick={handleSwitch}
              data-testid="button-camera-switch"
            >
              <SwitchCamera className="me-2 h-4 w-4" />
              {t.switchCamera}
            </Button>
          )}
          {snapshot ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleRetake}
                disabled={processing}
                data-testid="button-camera-retake"
              >
                <RefreshCcw className="me-2 h-4 w-4" />
                {t.retake}
              </Button>
              <Button
                type="button"
                onClick={handleAccept}
                disabled={processing}
                data-testid="button-camera-accept"
              >
                {processing ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t.processing}
                  </>
                ) : (
                  <>
                    <Check className="me-2 h-4 w-4" />
                    {t.accept}
                  </>
                )}
              </Button>
            </>
          ) : (
            !error && (
              <Button
                type="button"
                onClick={handleCapture}
                data-testid="button-camera-capture"
              >
                <Camera className="me-2 h-4 w-4" />
                {t.capture}
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
