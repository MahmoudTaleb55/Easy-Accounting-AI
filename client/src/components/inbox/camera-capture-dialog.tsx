import { useCallback, useMemo, useRef, useState } from "react";
import Webcam from "react-webcam";
import imageCompression from "browser-image-compression";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, RefreshCcw, SwitchCamera, Check, Loader2 } from "lucide-react";
import type { Locale } from "@/contexts/locale-context";

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
  },
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (file: File) => void;
  locale: Locale;
};

/**
 * Apply a light image-processing pass to a captured frame to improve OCR/legibility:
 *   - autoLevels-style contrast stretch on the luminance channel
 *   - mild gamma correction to lift mid-tones
 * This is intentionally conservative — strong filters can break colour invoices.
 */
function enhanceImageData(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.drawImage(img, 0, 0);
  try {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;

    // First pass: collect luminance histogram extremes (1st / 99th percentile).
    const hist = new Uint32Array(256);
    for (let i = 0; i < px.length; i += 4) {
      const y = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
      hist[y | 0]++;
    }
    const total = (px.length / 4) | 0;
    const lo = Math.floor(total * 0.01);
    const hi = Math.floor(total * 0.99);
    let acc = 0;
    let loY = 0;
    let hiY = 255;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= lo) {
        loY = v;
        break;
      }
    }
    acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= hi) {
        hiY = v;
        break;
      }
    }
    const range = Math.max(1, hiY - loY);
    const gamma = 0.9;

    // Second pass: stretch + gamma per channel.
    for (let i = 0; i < px.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let v = (px[i + c] - loY) * (255 / range);
        v = Math.max(0, Math.min(255, v));
        v = 255 * Math.pow(v / 255, gamma);
        px[i + c] = v;
      }
    }
    ctx.putImageData(data, 0, 0);
  } catch {
    // getImageData can fail under certain CORS/tainted-canvas conditions; fall
    // back to the raw frame.
  }
  return canvas;
}

function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode captured image"));
    img.src = dataUrl;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/jpeg",
  quality = 0.92,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob failed"))),
      type,
      quality,
    );
  });
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
  const [processing, setProcessing] = useState(false);

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
      const img = await dataUrlToImage(snapshot);
      const enhanced = enhanceImageData(img);
      const rawBlob = await canvasToBlob(enhanced, "image/jpeg", 0.92);
      const rawFile = new File(
        [rawBlob],
        `invoice-camera-${Date.now()}.jpg`,
        { type: "image/jpeg" },
      );
      const compressed = await imageCompression(rawFile, {
        maxSizeMB: 1.5,
        maxWidthOrHeight: 2400,
        useWebWorker: true,
        fileType: "image/jpeg",
        initialQuality: 0.85,
      });
      const finalFile =
        compressed instanceof File
          ? compressed
          : new File([compressed], rawFile.name, { type: "image/jpeg" });
      onCapture(finalFile);
      setSnapshot(null);
      onOpenChange(false);
    } catch {
      setError(t.processingFailed);
    } finally {
      setProcessing(false);
    }
  }, [snapshot, onCapture, onOpenChange]);

  const handleSwitch = useCallback(() => {
    setFacingMode((m) => (m === "environment" ? "user" : "environment"));
    setSnapshot(null);
  }, []);

  const handleUserMediaError = useCallback(
    (err: string | DOMException) => {
      const name = typeof err === "string" ? err : err.name;
      if (
        name === "NotAllowedError" ||
        name === "PermissionDeniedError" ||
        name === "SecurityError"
      ) {
        setError(t.permissionDenied);
      } else {
        setError(t.unavailable);
      }
    },
    [t.permissionDenied, t.unavailable],
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
