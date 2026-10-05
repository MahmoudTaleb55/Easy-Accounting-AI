/**
 * On-disk persistent storage for uploaded source documents (receipts,
 * invoices). Files are written under `uploads/documents/<companyId>/`
 * keyed by a content-hashed filename to deduplicate re-uploads of the
 * same file. Stored bytes are never returned to a different workspace.
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { objectStorageClient } from "../ai/object_storage";

const ROOT = path.resolve(process.cwd(), "uploads", "documents");

function s3Enabled(): boolean {
  return process.env.OBJECT_STORAGE_PROVIDER === "s3";
}

function s3Bucket(): string {
  const bucket = process.env.AWS_S3_BUCKET?.trim();
  if (!bucket) throw new Error("AWS_S3_BUCKET must be set when S3 storage is enabled");
  return bucket;
}

function parseS3Path(storagePath: string): { bucket: string; key: string } | null {
  if (!storagePath.startsWith("s3://")) return null;
  const value = storagePath.slice("s3://".length);
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) return null;
  const bucket = value.slice(0, separator);
  const key = value.slice(separator + 1);
  return key.startsWith("documents/") ? { bucket, key } : null;
}

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
  const sha256 = crypto.createHash("sha256").update(opts.buffer).digest("hex");
  const ext = path.extname(opts.originalName).toLowerCase().replace(/[^a-z0-9.]/g, "") || ".bin";
  const key = `documents/${opts.companyId}/${sha256}${ext}`;

  if (s3Enabled()) {
    const bucket = s3Bucket();
    await objectStorageClient.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: opts.buffer,
      ServerSideEncryption: "AES256",
    }));
    return {
      storagePath: `s3://${bucket}/${key}`,
      sizeBytes: opts.buffer.length,
      sha256,
    };
  }

  const dir = path.join(ROOT, String(opts.companyId));
  await fs.mkdir(dir, { recursive: true });

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
  const s3 = parseS3Path(storagePath);
  if (s3) {
    const response = await objectStorageClient.send(new GetObjectCommand({
      Bucket: s3.bucket,
      Key: s3.key,
    }));
    if (!response.Body) throw new Error("Document object is empty");
    return Buffer.from(await response.Body.transformToByteArray());
  }

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
  const s3 = parseS3Path(storagePath);
  if (s3) {
    if (await isReferenced()) return;
    try {
      await objectStorageClient.send(new DeleteObjectCommand({
        Bucket: s3.bucket,
        Key: s3.key,
      }));
    } catch {
      // Best-effort cleanup. The database row is already deleted.
    }
    return;
  }

  const resolved = path.resolve(storagePath);
  if (!resolved.startsWith(ROOT)) return;
  if (await isReferenced()) return;
  try {
    await fs.unlink(resolved);
  } catch {
    // best-effort
  }
}
