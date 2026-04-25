/**
 * Shared image-format gate.
 *
 * The browser-supplied `Content-Type` (and the multipart `filename`) on an
 * upload are trivially forgeable — `curl -F file=@evil.sh;type=image/png`
 * would otherwise be enough to land arbitrary bytes in object storage and
 * have them re-served as `Content-Type: image/png`, or to feed a renamed
 * text file straight into the AI vision extractor on the document inbox.
 *
 * `detectImageMimeFromBuffer` inspects the leading bytes of an upload and
 * returns the canonical MIME type those bytes describe — or `null` if the
 * buffer does not match one of the four image formats the app accepts
 * (PNG / JPEG / WEBP / GIF). Both the avatar route (server/auth/local-routes.ts)
 * and the document-inbox route (server/routes.ts → registerDocumentRoutes)
 * trust the bytes here, not the caller. See task #146 (avatar) and #196
 * (documents).
 */

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

/** Canonical MIME types accepted everywhere we sniff image uploads. */
export const ALLOWED_IMAGE_MIME_TYPES = Object.keys(MIME_TO_EXT);

/** Map a sniffed MIME (e.g. "image/png") to its canonical file extension. */
export function imageMimeToExt(mime: string): string | undefined {
  return MIME_TO_EXT[mime];
}

/**
 * Inspect the first few bytes of an upload and return the canonical MIME
 * type that those bytes describe, or `null` if the buffer does not match
 * one of the four image formats we accept (PNG / JPEG / WEBP / GIF).
 */
export function detectImageMimeFromBuffer(buf: Buffer): string | null {
  if (!buf || buf.length < 8) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }

  // GIF: "GIF87a" or "GIF89a"
  if (buf.length >= 6) {
    const head = buf.toString("ascii", 0, 6);
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }

  // WEBP: "RIFF????WEBP" — 4-byte size in between is ignored.
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Thrown when an upload claims to be an image but the bytes don't match
 * any supported format. Callers translate this into a 400 response.
 */
export class InvalidImageError extends Error {
  readonly code = "INVALID_IMAGE";
  constructor(message = "Only image uploads are supported (PNG, JPEG, WEBP, GIF).") {
    super(message);
    this.name = "InvalidImageError";
  }
}
