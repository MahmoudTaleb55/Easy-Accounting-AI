/**
 * Document scanner — perspective-correct a captured invoice/receipt frame
 * before it goes through the Smart Inbox upload pipeline.
 *
 * Wraps `jscanify` (which uses OpenCV.js under the hood) behind a
 * single-flight, lazily-initialised loader so:
 *   - the heavy OpenCV.js WASM module is only fetched on first use
 *     (a user who never opens the camera dialog never pays for it);
 *   - environments without WebAssembly support (very old browsers,
 *     hardened embedded webviews, Safari Lockdown Mode, etc.) get a
 *     graceful `null` instead of a runtime crash;
 *   - any failure inside the loader, the OpenCV runtime callback, the
 *     contour finder, or the perspective transform returns `null` so
 *     the camera dialog can fall back to the raw frame instead of
 *     stranding the user. There is no error path that bubbles up.
 *
 * The OpenCV.js bundle is loaded from the jsDelivr CDN as a side-effect
 * `<script>` tag because @techstark/opencv-js is ~10MB and bundling it
 * would balloon the main JS chunk. Loading from a CDN is the standard
 * jscanify pattern documented at https://github.com/puffinsoft/jscanify.
 *
 * See task #345.
 */

const OPENCV_CDN_URL = "https://docs.opencv.org/4.10.0/opencv.js";
// Subresource Integrity hash (SHA-384) for the pinned OpenCV.js build.
// Computed from the upstream artefact at OPENCV_CDN_URL — recompute and
// update this constant if (and only if) the pinned URL is ever changed.
// This is the supply-chain guard: the browser refuses to execute the
// downloaded script if the bytes don't hash to this exact value, so a
// CDN compromise can't silently inject code into the camera pipeline.
const OPENCV_CDN_SRI =
  "sha384-VZ75HIsZdBZqbKCiCOX/HR/1GH5mxbz/2SNXc5FBjK9MsOagud59+jw4pBMpaMH7";

type CvWindow = typeof window & {
  cv?: { onRuntimeInitialized?: () => void } & Record<string, unknown>;
};

let openCvPromise: Promise<unknown> | null = null;

function loadOpenCv(): Promise<unknown> {
  if (openCvPromise) return openCvPromise;
  openCvPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("scanner unavailable in non-browser environment"));
      return;
    }
    if (typeof WebAssembly === "undefined") {
      reject(new Error("WebAssembly unavailable"));
      return;
    }
    const w = window as CvWindow;
    if (w.cv && typeof (w.cv as Record<string, unknown>).Mat !== "undefined") {
      resolve(w.cv);
      return;
    }
    // OpenCV.js exposes a `Module` that fires `onRuntimeInitialized` once the
    // WASM heap is ready. Wire the callback BEFORE inserting the script so we
    // don't race the very fast cached-load case.
    w.cv = w.cv ?? {};
    (w.cv as { onRuntimeInitialized?: () => void }).onRuntimeInitialized = () => {
      resolve(w.cv);
    };
    const script = document.createElement("script");
    script.src = OPENCV_CDN_URL;
    script.async = true;
    // SRI requires CORS for cross-origin scripts. Together they let the
    // browser fetch the bundle, hash it, and refuse to execute on any
    // mismatch — even if the CDN is later compromised.
    script.crossOrigin = "anonymous";
    script.integrity = OPENCV_CDN_SRI;
    script.onerror = () => {
      // Reset the single-flight promise so a later retry (e.g. after the
      // user's network comes back) can re-attempt without permanently
      // memoising the failure.
      openCvPromise = null;
      reject(new Error("failed to load opencv.js"));
    };
    document.head.appendChild(script);
  });
  return openCvPromise;
}

let scannerPromise: Promise<unknown> | null = null;

async function getScanner(): Promise<unknown> {
  if (scannerPromise) return scannerPromise;
  scannerPromise = (async () => {
    await loadOpenCv();
    // Dynamic import keeps jscanify out of the initial Vite chunk for the
    // (common) page loads where the camera dialog is never opened.
    //
    // We deliberately import the `/client` subpath: jscanify's default
    // entry (`src/jscanify-node.js`) drags in `jsdom` and `canvas` for
    // server-side use, both of which transitively `require("https")`,
    // which Vite cannot pre-bundle for the browser. The `/client` entry
    // is the same scanner class minus the Node shims.
    const mod = await import("jscanify/client");
    const Ctor = (mod as { default?: unknown }).default ?? mod;
    // jscanify is a class; instantiate it once and reuse.
    return new (Ctor as new () => unknown)();
  })().catch((err) => {
    scannerPromise = null;
    throw err;
  });
  return scannerPromise;
}

/**
 * Best-effort detect → perspective-correct → return a new canvas.
 *
 * Returns `null` on any failure (no WASM, library load fail, no paper
 * detected, opencv error, etc.) — the caller is expected to fall back to
 * the raw frame.
 */
export async function scanCanvasToCanvas(
  src: HTMLCanvasElement,
): Promise<HTMLCanvasElement | null> {
  try {
    const scanner = (await getScanner()) as {
      extractPaper: (
        image: HTMLCanvasElement,
        w: number,
        h: number,
      ) => HTMLCanvasElement | null;
    };
    // Match the source aspect ratio so the perspective-corrected output
    // doesn't get squished. jscanify's extractPaper takes a target
    // width/height — we pass the source dimensions, which produces a
    // 1:1-pixel output for the detected paper.
    const out = scanner.extractPaper(src, src.width, src.height);
    if (!out || out.width === 0 || out.height === 0) return null;
    return out;
  } catch {
    return null;
  }
}

/**
 * Convenience wrapper around `scanCanvasToCanvas` that takes a data URL
 * (typical of a `Webcam.getScreenshot()` output) and returns a data URL.
 * Returns `null` on any failure.
 */
export async function scanDataUrl(
  dataUrl: string,
  mimeType = "image/jpeg",
  quality = 0.95,
): Promise<string | null> {
  if (typeof window === "undefined" || typeof Image === "undefined") return null;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("decode failed"));
      i.src = dataUrl;
    });
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = img.naturalWidth;
    srcCanvas.height = img.naturalHeight;
    const ctx = srcCanvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const out = await scanCanvasToCanvas(srcCanvas);
    if (!out) return null;
    return out.toDataURL(mimeType, quality);
  } catch {
    return null;
  }
}

/**
 * Cheap synchronous probe — does this environment plausibly support the
 * scanner pipeline at all? Used by callers that want to skip showing the
 * "scanning…" badge entirely on environments that will definitely fall
 * back to the raw frame.
 */
export function isScannerSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof WebAssembly === "undefined") return false;
  return true;
}
