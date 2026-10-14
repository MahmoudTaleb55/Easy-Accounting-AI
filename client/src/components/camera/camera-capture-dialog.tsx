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
  VideoOff,
  RefreshCcw,
  SwitchCamera,
  Check,
  Loader2,
  ExternalLink,
  Upload,
} from "lucide-react";
import type { Locale } from "@/contexts/locale-context";
import { useT } from "@/i18n/dict";
import {
  enhanceAndCompressDataUrl,
  enhanceAndCompressImageFile,
} from "@/lib/image-enhance";
import { isScannerSupported, scanDataUrl } from "@/lib/document-scanner";

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
  // Embedded inside another browsing context (for example, an app-hosted iframe).
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
  const t = useT();
  const isRtl = locale === "ar";
  const webcamRef = useRef<Webcam>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // `rawSnapshot` is the unmodified data URL straight off the webcam,
  // kept around so we always have a fallback the user can fall back to.
  // `snapshot` is what we actually render (and ultimately upload) — it's
  // the perspective-corrected output when the scanner succeeds, otherwise
  // a copy of `rawSnapshot`. See task #345.
  const [rawSnapshot, setRawSnapshot] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  // 'idle'      — no snapshot yet
  // 'scanning'  — scanner pass in flight
  // 'scanned'   — perspective-correction succeeded; preview is the output
  // 'raw'       — scanner skipped/failed; preview is the unmodified frame
  const [scanState, setScanState] = useState<
    "idle" | "scanning" | "scanned" | "raw"
  >("idle");
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
  // Monotonically-incrementing scan request id. Each capture / retake /
  // close bumps this; the async scanner promise compares its captured id
  // against the live one before applying its result. This kills the
  // stale-result race where a user retakes (or closes the dialog) while
  // a slow OpenCV.js pass is still pending and the late resolution would
  // otherwise overwrite the new preview with the old corrected canvas.
  const scanRequestIdRef = useRef(0);

  // Re-detect each time the dialog is opened so the user can fix permissions
  // and try again without a full reload.
  useEffect(() => {
    if (!open) return;
    const env = detectCameraEnvironment();
    if (env.kind !== "ok") {
      setBlockReason(env.kind);
      if (env.kind === "iframe") setError(t("cam_iframe_blocked"));
      else if (env.kind === "insecure") setError(t("cam_insecure_context"));
      return;
    }
    setBlockReason(null);
    setError(null);

    // Proactively query the browser camera permission so we can show the right
    // error message *immediately* (without waiting for getUserMedia to fail),
    // and auto-recover when the user allows the camera from the address bar
    // while the dialog is still open.
    if (typeof navigator.permissions?.query !== "function") return;

    let dead = false;
    let permStatus: PermissionStatus | null = null;
    let changeHandler: (() => void) | null = null;

    const applyPermState = (state: PermissionState) => {
      if (dead) return;
      if (state === "denied") {
        const inIframe = window.self !== window.top;
        setBlockReason(inIframe ? "iframe" : "permission");
        setError(inIframe ? t("cam_iframe_blocked") : t("cam_permission_denied"));
      } else {
        // "granted" or "prompt" — only clear errors that *this* check set;
        // leave hardware-busy / overconstrained messages untouched.
        setBlockReason((prev) =>
          prev === "permission" || prev === "iframe" ? null : prev,
        );
        setError((prev) =>
          prev === t("cam_permission_denied") || prev === t("cam_iframe_blocked") ? null : prev,
        );
      }
    };

    navigator.permissions
      .query({ name: "camera" as PermissionName })
      .then((status) => {
        if (dead) return;
        permStatus = status;
        applyPermState(status.state);
        changeHandler = () => applyPermState(status.state);
        status.addEventListener("change", changeHandler);
      })
      .catch(() => {
        /* Permissions API not supported — fall through to getUserMedia */
      });

    return () => {
      dead = true;
      if (permStatus && changeHandler) {
        permStatus.removeEventListener("change", changeHandler);
      }
    };
  }, [open, t("cam_iframe_blocked"), t("cam_insecure_context"), t("cam_permission_denied")]);

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
      setError(t("cam_unavailable"));
      return;
    }
    // Always show the raw frame immediately so the operator gets instant
    // visual feedback while the (possibly slow, possibly WASM-bound)
    // scanner runs in the background. If the scanner returns a perspective-
    // corrected canvas, we silently swap the preview to it. If it bails
    // out for any reason, the raw frame stays.
    setRawSnapshot(shot);
    setSnapshot(shot);
    // Bump first, then capture: any in-flight scan from the previous
    // capture/retake now holds a stale id and its result will be ignored
    // when it eventually resolves.
    scanRequestIdRef.current += 1;
    const myRequestId = scanRequestIdRef.current;
    if (!isScannerSupported()) {
      setScanState("raw");
      return;
    }
    setScanState("scanning");
    void scanDataUrl(shot, "image/jpeg", 0.95)
      .then((scanned) => {
        // Ignore any result that no longer belongs to the current capture.
        if (scanRequestIdRef.current !== myRequestId) return;
        if (scanned) {
          setSnapshot(scanned);
          setScanState("scanned");
        } else {
          setScanState("raw");
        }
      })
      .catch(() => {
        if (scanRequestIdRef.current !== myRequestId) return;
        setScanState("raw");
      });
  }, [t]);

  const handleRetake = useCallback(() => {
    // Invalidate any in-flight scan so its late resolution doesn't paint
    // the just-discarded preview back over the live webcam view.
    scanRequestIdRef.current += 1;
    setSnapshot(null);
    setRawSnapshot(null);
    setScanState("idle");
  }, []);

  const handleAccept = useCallback(async () => {
    // Prefer the scanned (perspective-corrected) frame if the scanner
    // produced one; otherwise the raw frame. Both go through the same
    // enhance/compress pipeline as drag-drop uploads so the back-end
    // doesn't need to know which path produced the bytes — see
    // server/routes.ts → registerDocumentRoutes.
    const source = snapshot ?? rawSnapshot;
    if (!source) return;
    setProcessing(true);
    try {
      const finalFile = await enhanceAndCompressDataUrl(
        source,
        "invoice-camera",
      );
      onCapture(finalFile);
      setSnapshot(null);
      setRawSnapshot(null);
      setScanState("idle");
      onOpenChange(false);
    } catch {
      setError(t("cam_processing_failed"));
    } finally {
      setProcessing(false);
    }
  }, [snapshot, rawSnapshot, onCapture, onOpenChange, t("cam_processing_failed")]);

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
      if (env.kind === "iframe") setError(t("cam_iframe_blocked"));
      else if (env.kind === "insecure") setError(t("cam_insecure_context"));
      // Even when the env still blocks, bump the key so the next ok detection
      // remounts cleanly.
      setStreamKey((k) => k + 1);
      return;
    }
    setBlockReason(null);
    setError(null);
    setSnapshot(null);
    setStreamKey((k) => k + 1);
  }, [t]);

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
        setError(t("cam_processing_failed"));
      } finally {
        setProcessing(false);
      }
    },
    [onCapture, onOpenChange, t("cam_processing_failed")],
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
        setError(t("cam_iframe_blocked"));
        return;
      }
      switch (name) {
        case "NotAllowedError":
        case "PermissionDeniedError":
        case "SecurityError":
          setBlockReason("permission");
          setError(t("cam_permission_denied"));
          return;
        case "NotFoundError":
        case "DevicesNotFoundError":
          setBlockReason("hardware-missing");
          setError(t("cam_hardware_missing"));
          return;
        case "NotReadableError":
        case "TrackStartError":
          setBlockReason("hardware-busy");
          setError(t("cam_hardware_busy"));
          return;
        case "OverconstrainedError":
        case "ConstraintNotSatisfiedError":
          setBlockReason("overconstrained");
          setError(t("cam_overconstrained"));
          return;
        default:
          setBlockReason("unknown");
          setError(t("cam_unavailable"));
      }
    },
    [t],
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
          // Bump the request id so any in-flight scanner promise from a
          // capture taken before close resolves into a no-op instead of
          // re-painting state on the *next* time this dialog is opened.
          scanRequestIdRef.current += 1;
          setSnapshot(null);
          setRawSnapshot(null);
          setScanState("idle");
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
          <DialogTitle data-testid="text-camera-title">{t("cam_title")}</DialogTitle>
          <DialogDescription data-testid="text-camera-description">
            {t("cam_description")}
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
              blockReason === "permission" ? (
                // Structured step-by-step guide — much clearer than a text
                // blob when the user's browser has camera blocked and they
                // need to know exactly where to click to unblock it.
                <div
                  className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center text-white"
                  data-testid="text-camera-error"
                >
                  <VideoOff className="h-10 w-10 opacity-50" />
                  <p className="text-sm font-semibold">{t("cam_permission_denied_title")}</p>
                  <ol
                    className={`text-xs space-y-2 opacity-90 list-decimal ${isRtl ? "pr-4 text-right" : "pl-4 text-left"}`}
                  >
                    <li>{t("cam_permission_step1")}</li>
                    <li>{t("cam_permission_step2")}</li>
                    <li>{t("cam_permission_step3")}</li>
                  </ol>
                </div>
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-white"
                  data-testid="text-camera-error"
                >
                  {error}
                </div>
              )
            ) : snapshot ? (
              <>
                <img
                  src={snapshot}
                  alt={t("cam_preview_alt")}
                  className="h-full w-full object-contain"
                  data-testid="img-camera-preview"
                />
                {scanState !== "idle" && (
                  <div
                    className={
                      "pointer-events-none absolute bottom-2 left-2 right-2 mx-auto w-fit rounded px-2 py-1 text-xs " +
                      (scanState === "scanned"
                        ? "bg-emerald-600/90 text-white"
                        : scanState === "scanning"
                          ? "bg-black/60 text-white"
                          : "bg-amber-600/90 text-white")
                    }
                    data-testid={`badge-camera-scan-${scanState}`}
                  >
                    {scanState === "scanning"
                      ? t("cam_scanning")
                      : scanState === "scanned"
                        ? t("cam_scan_ready")
                        : t("cam_scan_raw")}
                  </div>
                )}
              </>
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
              {t("cam_hint")}
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
            {t("cam_cancel")}
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
              {t("cam_open_new_tab")}
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
              {t("cam_upload_instead")}
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
              {t("cam_try_again")}
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
              {t("cam_switch_camera")}
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
                {t("cam_retake")}
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
                    {t("cam_processing")}
                  </>
                ) : (
                  <>
                    <Check className="me-2 h-4 w-4" />
                    {t("cam_accept")}
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
                {t("cam_capture")}
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
