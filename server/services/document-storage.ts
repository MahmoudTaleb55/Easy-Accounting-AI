/**
 * On-disk persistent storage for uploaded source documents (receipts,
 * invoices). Files are written under `uploads/documents/<companyId>/`
 * keyed by a content-hashed filename to deduplicate re-uploads of the
 * same file. Stored bytes are never returned to a different workspace.
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = path.resolve(process.cwd(), "uploads", "documents");

export interface SavedDocumentFile {
  storagePath: string; // path on disk
  sizeBytes: number;
  sha256: string;
}

export async function saveDocumentFile(opts: {
  companyId: number;
  buffer: Buffer;
  originalName: string;
}): Promise<SavedDocumentFile> {
  const dir = path.join(ROOT, String(opts.companyId));
  await fs.mkdir(dir, { recursive: true });

  const sha256 = crypto.createHash("sha256").update(opts.buffer).digest("hex");
  const ext = path.extname(opts.originalName).toLowerCase().replace(/[^a-z0-9.]/g, "") || ".bin";
  const filename = `${sha256}${ext}`;
  const storagePath = path.join(dir, filename);

  // If the same file already exists, reuse it (saves disk + lets the
  // caller detect duplicate uploads downstream).
  try {
    const stat = await fs.stat(storagePath);
    return { storagePath, sizeBytes: stat.size, sha256 };
  } catch {
    // not present — write it
  }

  await fs.writeFile(storagePath, opts.buffer);
  return { storagePath, sizeBytes: opts.buffer.length, sha256 };
}

export async function readDocumentFile(storagePath: string): Promise<Buffer> {
  // Constrain reads to the uploads root — defence in depth against any
  // future caller passing in an attacker-controlled path.
  const resolved = path.resolve(storagePath);
  if (!resolved.startsWith(ROOT)) {
    throw new Error("Document path is outside the uploads directory");
  }
  return fs.readFile(resolved);
}

/**
 * Delete the on-disk file ONLY when no remaining document row references it.
 * Files are deduped by sha256 across a workspace, so two upload rows can
 * legitimately point at the same `storagePath` — unconditional unlink would
 * break the surviving row.
 */
export async function deleteDocumentFileIfOrphaned(
  storagePath: string,
  isReferenced: () => Promise<boolean>,
): Promise<void> {
  const resolved = path.resolve(storagePath);
  if (!resolved.startsWith(ROOT)) return;
  if (await isReferenced()) return;
  try {
    await fs.unlink(resolved);
  } catch {
    // best-effort
  }
}
