import imageCompression from "browser-image-compression";

/**
 * Apply a light image-processing pass to a captured/uploaded frame to
 * improve OCR/legibility:
 *   - autoLevels-style contrast stretch on the luminance channel
 *   - mild gamma correction to lift mid-tones
 * This is intentionally conservative — strong filters can break colour
 * invoices.
 */
export function enhanceImageData(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.drawImage(img, 0, 0);
  try {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;

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
    // getImageData can fail under certain CORS/tainted-canvas conditions;
    // fall back to the raw frame.
  }
  return canvas;
}

export function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = dataUrl;
  });
}

export function canvasToBlob(
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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// Single source of truth for the auto-levels + compression pipeline so that
// camera captures and direct uploads always produce identical output.
const COMPRESSION_OPTIONS = {
  maxSizeMB: 1.5,
  maxWidthOrHeight: 2400,
  useWebWorker: true,
  fileType: "image/jpeg" as const,
  initialQuality: 0.85,
};

/**
 * Run the auto-levels + gamma + JPEG compression pipeline starting from a
 * data URL (typical of a camera screenshot). Returns a JPEG File.
 */
export async function enhanceAndCompressDataUrl(
  dataUrl: string,
  fileNameHint = "invoice-camera",
): Promise<File> {
  const img = await dataUrlToImage(dataUrl);
  const enhanced = enhanceImageData(img);
  const rawBlob = await canvasToBlob(enhanced, "image/jpeg", 0.92);
  const rawFile = new File(
    [rawBlob],
    `${fileNameHint}-${Date.now()}.jpg`,
    { type: "image/jpeg" },
  );
  const compressed = await imageCompression(rawFile, COMPRESSION_OPTIONS);
  return compressed instanceof File
    ? compressed
    : new File([compressed], rawFile.name, { type: "image/jpeg" });
}

/**
 * Run the same enhancement + compression pipeline used for camera-captured
 * receipts on an arbitrary image File (e.g. a user-uploaded JPEG/PNG of a
 * receipt). Returns a JPEG File suitable for upload or for embedding as a
 * base64 data URL.
 *
 * If the file is not an image we recognise (e.g. HEIC on browsers without
 * decoder support, or anything that fails to decode), the original file is
 * returned unchanged so the caller's existing behaviour is preserved.
 */
export async function enhanceAndCompressImageFile(
  file: File,
  fileNameHint?: string,
): Promise<File> {
  try {
    const dataUrl = await fileToDataUrl(file);
    const baseName = (fileNameHint || file.name || "image").replace(
      /\.[^.]+$/,
      "",
    );
    return await enhanceAndCompressDataUrl(dataUrl, baseName || "image");
  } catch {
    return file;
  }
}
