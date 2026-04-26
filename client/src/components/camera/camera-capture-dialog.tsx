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
  Upload,
} from "lucide-react";
import type { Locale } from "@/contexts/locale-context";
import {
  enhanceAndCompressDataUrl,
  enhanceAndCompressImageFile,
} from "@/lib/image-enhance";

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
  hardwareMissing: string;
  hardwareBusy: string;
  overconstrained: string;
  processing: string;
  hint: string;
  previewAlt: string;
  processingFailed: string;
  iframeBlocked: string;
  openInNewTab: string;
  insecureContext: string;
  tryAgain: string;
  uploadInstead: string;
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
      "تم رفض الوصول إلى الكاميرا. فعّل الإذن من إعدادات المتصفح ثم أعد المحاولة.",
    unavailable: "تعذّر الاتصال بالكاميرا. حاول مجدداً أو ارفع صورة من جهازك.",
    hardwareMissing:
      "لم يتم العثور على كاميرا متصلة. تحقق من توصيل الكاميرا أو ارفع صورة بدلاً من ذلك.",
    hardwareBusy:
      "الكاميرا قيد الاستخدام من قبل تطبيق آخر. أغلق تطبيقات الفيديو الأخرى ثم أعد المحاولة.",
    overconstrained:
      "إعدادات الكاميرا المطلوبة غير مدعومة. حاول تبديل الكاميرا الأمامية/الخلفية أو ارفع صورة.",
    processing: "جارٍ المعالجة…",
    hint: "نصيحة: حاذِ حواف الفاتورة داخل الإطار.",
    previewAlt: "معاينة الفاتورة الملتقطة",
    processingFailed: "تعذرت معالجة الصورة. حاول إعادة التصوير.",
    iframeBlocked:
      "الكاميرا محظورة داخل النافذة المضمّنة (iframe) في بيئة المعاينة. افتح التطبيق في علامة تبويب جديدة للسماح بالكاميرا.",
    openInNewTab: "فتح في علامة تبويب جديدة",
    insecureContext:
      "تتطلب الكاميرا اتصالاً آمناً (HTTPS) أو localhost.",
    tryAgain: "إعادة المحاولة",
    uploadInstead: "رفع صورة بدلاً من ذلك",
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
    unavailable:
      "Could not connect to the camera. Try again or upload a file instead.",
    hardwareMissing:
      "No camera was detected. Check that a camera is connected, or upload a file instead.",
    hardwareBusy:
      "The camera is being used by another application. Close other video apps and try again.",
    overconstrained:
      "The requested camera settings are not supported. Try switching the camera or upload a file instead.",
    processing: "Processing…",
    hint: "Tip: align the edges of the invoice within the frame.",
    previewAlt: "Preview of the captured invoice",
    processingFailed: "Could not process the image. Please retake the photo.",
    iframeBlocked:
      "Camera is blocked inside the embedded preview frame. Open the app in a new browser tab to allow the camera.",
    openInNewTab: "Open in a new tab",
    insecureContext: "Camera requires a secure connection (HTTPS) or localhost.",
    tryAgain: "Try again",
    uploadInstead: "Upload a file instead",
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
    unavailable:
      "Verbindung zur Kamera fehlgeschlagen. Versuchen Sie es erneut oder laden Sie eine Datei hoch.",
    hardwareMissing:
      "Keine Kamera erkannt. Prüfen Sie die Verbindung oder laden Sie stattdessen eine Datei hoch.",
    hardwareBusy:
      "Die Kamera wird von einer anderen Anwendung verwendet. Schließen Sie andere Video-Apps und versuchen Sie es erneut.",
    overconstrained:
      "Die angeforderten Kameraeinstellungen werden nicht unterstützt. Wechseln Sie die Kamera oder laden Sie eine Datei hoch.",
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
    tryAgain: "Erneut versuchen",
    uploadInstead: "Stattdessen Datei hochladen",
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
    unavailable:
      "Impossible de se connecter à la caméra. Réessayez ou téléversez un fichier.",
    hardwareMissing:
      "Aucune caméra détectée. Vérifiez le branchement ou téléversez un fichier à la place.",
    hardwareBusy:
      "La caméra est utilisée par une autre application. Fermez les autres applications vidéo et réessayez.",
    overconstrained:
      "Les réglages de caméra demandés ne sont pas pris en charge. Changez de caméra ou téléversez un fichier.",
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
    tryAgain: "Réessayer",
    uploadInstead: "Téléverser un fichier à la place",
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

/** All the realistic block reasons we surface to the user. `unknown` is the
 *  catch-all for unmapped DOMException names so we still show *some* recovery
 *  affordance even when the browser invents a new error name. */
type BlockReason =
  | "iframe"
  | "insecure"
  | "permission"
  | "hardware-missing"
  | "hardware-busy"
  | "overconstrained"
  | "unknown";

export function CameraCaptureDialog({
  open,
  onOpenChange,
  onCapture,
  locale,
}: Props) {
  const t = I18N[locale] ?? I18N.en;
  const isRtl = locale === "ar";
  const webcamRef = useRef<Webcam>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment",
  );
  const [error, setError] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState<BlockReason | null>(null);
  const [processing, setProcessing] = useState(false);
  // Bumping `streamKey` re-mounts the underlying <Webcam>, which is the
  // cleanest way to force a fresh getUserMedia() request after the user fixes
  // a permission issue or another app releases the camera.
  const [streamKey, setStreamKey] = useState(0);

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
      setBlockReason("unknown");
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
    // Bump the stream key too — switching facing mode after an
    // OverconstrainedError needs a fresh getUserMedia() with the new
    // constraints object, otherwise some browsers stay stuck on the failed
    // device.
    setStreamKey((k) => k + 1);
    setBlockReason(null);
    setError(null);
  }, []);

  /** Re-run getUserMedia without closing the dialog. Resets every error/block
   *  state, then nudges the <Webcam> to re-mount via streamKey. The
   *  Permissions-Policy / insecure-context environments are re-checked on the
   *  way through so a user who, say, just reloaded the parent frame to grant
   *  camera permission gets recovered too. */
  const handleTryAgain = useCallback(() => {
    const env = detectCameraEnvironment();
    if (env.kind !== "ok") {
      setBlockReason(env.kind);
      if (env.kind === "iframe") setError(t.iframeBlocked);
      else if (env.kind === "insecure") setError(t.insecureContext);
      // Even when the env still blocks, bump the key so the next ok detection
      // remounts cleanly.
      setStreamKey((k) => k + 1);
      return;
    }
    setBlockReason(null);
    setError(null);
    setSnapshot(null);
    setStreamKey((k) => k + 1);
  }, [t.iframeBlocked, t.insecureContext]);

  /** Always-available escape hatch: open the system file picker and feed the
   *  chosen image through the same enhance/compress pipeline as a captured
   *  frame would. This is what the user clicks when the camera is genuinely
   *  unreachable. */
  const handleUploadFallback = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFilePicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset the input so picking the same file twice still triggers change.
      e.target.value = "";
      if (!file) return;
      setProcessing(true);
      try {
        const finalFile = await enhanceAndCompressImageFile(file);
        onCapture(finalFile);
        setSnapshot(null);
        setError(null);
        setBlockReason(null);
        onOpenChange(false);
      } catch {
        setError(t.processingFailed);
      } finally {
        setProcessing(false);
      }
    },
    [onCapture, onOpenChange, t.processingFailed],
  );

  const handleUserMediaError = useCallback(
    (err: string | DOMException) => {
      const name = typeof err === "string" ? err : err.name;
      const inIframe =
        typeof window !== "undefined" && window.self !== window.top;
      // Inside an iframe whose Permissions-Policy doesn't allow `camera`, the
      // browser denies the request without ever prompting — that is the
      // single most common cause for our preview environment, so surface
      // the "open in a new tab" recovery instead of the generic message.
      if (
        (name === "NotAllowedError" ||
          name === "PermissionDeniedError" ||
          name === "SecurityError") &&
        inIframe
      ) {
        setBlockReason("iframe");
        setError(t.iframeBlocked);
        return;
      }
      switch (name) {
        case "NotAllowedError":
        case "PermissionDeniedError":
        case "SecurityError":
          setBlockReason("permission");
          setError(t.permissionDenied);
          return;
        case "NotFoundError":
        case "DevicesNotFoundError":
          setBlockReason("hardware-missing");
          setError(t.hardwareMissing);
          return;
        case "NotReadableError":
        case "TrackStartError":
          setBlockReason("hardware-busy");
          setError(t.hardwareBusy);
          return;
        case "OverconstrainedError":
        case "ConstraintNotSatisfiedError":
          setBlockReason("overconstrained");
          setError(t.overconstrained);
          return;
        default:
          setBlockReason("unknown");
          setError(t.unavailable);
      }
    },
    [
      t.permissionDenied,
      t.unavailable,
      t.iframeBlocked,
      t.hardwareMissing,
      t.hardwareBusy,
      t.overconstrained,
    ],
  );

  // The "Try again" button only makes sense when the failure could plausibly
  // be transient — i.e. the user just fixed permissions, closed the other app
  // holding the camera, or wants to retry after a network blip. For an
  // iframe-blocked environment the only real recovery is opening a new tab,
  // so we surface "open in new tab" instead of "try again" there.
  const showTryAgain =
    error != null && blockReason !== "iframe" && blockReason !== "insecure";
  // Upload fallback must always be reachable — even before the camera fails,
  // a user on a borrowed/locked-down device may prefer to skip the camera
  // entirely and pick a photo from disk. We only hide it once a snapshot is
  // taken (the user has already chosen the camera path at that point and
  // the next decision is accept/retake, not upload).
  const showUploadFallback = !snapshot;
  // The "switch camera" button has historically been a "live preview only"
  // affordance, but it's also the natural recovery from an
  // OverconstrainedError (the requested facingMode/resolution didn't match
  // any device). Surface it in that error state too so the user can flip
  // from rear→front (or vice versa) without leaving the dialog.
  const showSwitchCamera =
    (!error && !snapshot) || (error != null && blockReason === "overconstrained");

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

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFilePicked}
          data-testid="input-camera-file-fallback"
        />

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
                key={streamKey}
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

          {/* Iframe block: only meaningful recovery is opening a new tab */}
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

          {/* Upload-instead is the always-available escape hatch from any
              error state — a user must never be left without a path forward. */}
          {showUploadFallback && (
            <Button
              type="button"
              variant="outline"
              onClick={handleUploadFallback}
              disabled={processing}
              data-testid="button-camera-upload-fallback"
            >
              <Upload className="me-2 h-4 w-4" />
              {t.uploadInstead}
            </Button>
          )}

          {/* Try-again re-runs getUserMedia in place — no need to close and
              reopen the dialog after fixing the underlying problem. */}
          {showTryAgain && (
            <Button
              type="button"
              onClick={handleTryAgain}
              disabled={processing}
              data-testid="button-camera-try-again"
            >
              <RefreshCcw className="me-2 h-4 w-4" />
              {t.tryAgain}
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
