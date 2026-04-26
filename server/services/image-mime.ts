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
 *
 * `detectDocumentMimeFromBuffer` is the document-inbox-flavoured sibling:
 * it accepts everything `detectImageMimeFromBuffer` accepts, PLUS
 * `application/pdf` (sniffed from the `%PDF-` header). Vendor invoices
 * arrive as PDFs far more often than as phone photos, so the document
 * route widens the gate without weakening the avatar route — avatars
 * would still reject a PDF outright. See task #248.
 */

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const DOCUMENT_MIME_TO_EXT: Record<string, string> = {
  ...MIME_TO_EXT,
  "application/pdf": ".pdf",
};

/** Canonical MIME types accepted everywhere we sniff image uploads. */
export const ALLOWED_IMAGE_MIME_TYPES = Object.keys(MIME_TO_EXT);

/**
 * Canonical MIME types accepted by the document inbox — the four image
 * formats plus `application/pdf` for forwarded vendor invoices.
 */
export const ALLOWED_DOCUMENT_MIME_TYPES = Object.keys(DOCUMENT_MIME_TO_EXT);

/** Map a sniffed MIME (e.g. "image/png") to its canonical file extension. */
export function imageMimeToExt(mime: string): string | undefined {
  return MIME_TO_EXT[mime];
}

/**
 * Map a sniffed document MIME to its canonical file extension. Accepts
 * everything `imageMimeToExt` accepts plus `application/pdf` → `.pdf`.
 */
export function documentMimeToExt(mime: string): string | undefined {
  return DOCUMENT_MIME_TO_EXT[mime];
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
 * Inspect the first few bytes of an upload and return the canonical MIME
 * type for an image OR a PDF, or `null` if the buffer is neither. This
 * is the document-inbox sibling of `detectImageMimeFromBuffer`: the
 * avatar route still rejects PDFs (it uses the image-only sniff), while
 * the document route accepts them.
 */
export function detectDocumentMimeFromBuffer(buf: Buffer): string | null {
  const asImage = detectImageMimeFromBuffer(buf);
  if (asImage) return asImage;

  // PDF: "%PDF-" (25 50 44 46 2D). Real PDFs may have up to ~1 KB of
  // junk before the header, but the spec strongly recommends putting
  // it in the first 1024 bytes — and the major browsers/Acrobat refuse
  // anything that doesn't have it at offset 0. We match the strict
  // form so a renamed text file with "blah blah %PDF-" buried inside
  // doesn't sneak through.
  if (
    buf &&
    buf.length >= 5 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  ) {
    return "application/pdf";
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

/**
 * Thrown when an upload to the document inbox isn't one of the supported
 * formats. Distinct from `InvalidImageError` so the avatar route can
 * keep its narrower error message — and so a future audit of "where
 * are PDFs allowed?" comes back to exactly this class.
 */
export class InvalidDocumentError extends Error {
  readonly code = "INVALID_DOCUMENT";
  constructor(
    message = "Only image uploads (PNG, JPEG, WEBP, GIF) and PDF files are supported.",
  ) {
    super(message);
    this.name = "InvalidDocumentError";
  }
}
