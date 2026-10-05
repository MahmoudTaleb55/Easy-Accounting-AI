/**
 * Persistent storage for user avatar images.
 * New deployments use private S3 keys under avatars/<userId>/; legacy local
 * files remain readable while an existing deployment is being migrated.
 * Hashing keeps re-uploads idempotent and older avatars are swept.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Response } from "express";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { objectStorageClient } from "../ai/object_storage";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  InvalidImageError,
  detectImageMimeFromBuffer,
  imageMimeToExt,
} from "./image-mime";

export const ALLOWED_AVATAR_MIME_TYPES = ALLOWED_IMAGE_MIME_TYPES;
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB

/** Backwards-compatible aliases kept for existing callers. */
export const detectAvatarMimeFromBuffer = detectImageMimeFromBuffer;
export const InvalidAvatarImageError = InvalidImageError;
export type InvalidAvatarImageError = InvalidImageError;

export interface SavedAvatarFile {
  filename: string;
  objectName: string;
  publicUrl: string;
  sizeBytes: number;
}

// Legacy local root, used only when S3 is not enabled.
const AVATARS_ROOT = path.resolve(process.cwd(), "uploads", "avatars");

function s3Enabled(): boolean {
  return process.env.OBJECT_STORAGE_PROVIDER === "s3";
}

function s3Bucket(): string {
  const bucket = process.env.AWS_S3_BUCKET?.trim();
  if (!bucket) throw new Error("AWS_S3_BUCKET must be set when S3 storage is enabled");
  return bucket;
}

function safeUserId(userId: string): string {
  const cleaned = userId.replace(/[^A-Za-z0-9._-]/g, "");
  if (!cleaned) throw new Error("Invalid user id");
  // SECURITY (scan finding, PATH_TRAVERSAL): the character filter above
  // intentionally keeps "." for user ids, which leaves ".." / "." able to
  // escape the avatars/<userId>/ namespace when joined into a path or S3 key.
  // Real user ids are UUIDs/opaque strings and never contain "..", so reject
  // any dot-traversal sequence outright.
  if (cleaned === "." || cleaned === ".." || cleaned.includes("..")) {
    throw new Error("Invalid user id");
  }
  return cleaned;
}

function userAvatarDir(userId: string): string {
  return path.join(AVATARS_ROOT, safeUserId(userId));
}

/** URL the client renders. The backend protects this route with the session. */
export function buildAvatarUrl(userId: string, filename: string): string {
  const safeId = safeUserId(userId);
  return `/objects/avatars/${encodeURIComponent(safeId)}/${encodeURIComponent(filename)}`;
}

export async function saveAvatarFile(opts: {
  userId: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<SavedAvatarFile> {
  // Trust the bytes, not the caller-supplied mimeType.
  const detectedMime = detectImageMimeFromBuffer(opts.buffer);
  if (!detectedMime) throw new InvalidImageError();
  const ext = imageMimeToExt(detectedMime);
  if (!ext) throw new InvalidImageError();

  const safeId = safeUserId(opts.userId);
  const sha256 = crypto.createHash("sha256").update(opts.buffer).digest("hex");
  const filename = `${sha256}${ext}`;

  if (s3Enabled()) {
    const bucket = s3Bucket();
    const key = path.posix.join("avatars", safeId, filename);
    await objectStorageClient.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: opts.buffer,
      ContentType: detectedMime,
      CacheControl: "private, max-age=86400, immutable",
      ServerSideEncryption: "AES256",
    }));
    await pruneOtherAvatars(safeId, filename);
    return {
      filename,
      objectName: key,
      publicUrl: buildAvatarUrl(safeId, filename),
      sizeBytes: opts.buffer.length,
    };
  }

  const dir = userAvatarDir(safeId);
  const filePath = path.join(dir, filename);

  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(filePath, opts.buffer);

  // Best-effort sweep of older avatars for this user.
  await pruneOtherAvatars(safeId, filename);

  return {
    filename,
    objectName: path.posix.join("avatars", safeId, filename),
    publicUrl: buildAvatarUrl(safeId, filename),
    sizeBytes: opts.buffer.length,
  };
}

/**
 * Stream a stored avatar to the response.  Called by routes.ts for
 * GET /objects/avatars/:userId/:filename.
 * Throws { code: "NOT_FOUND" } when the file doesn't exist.
 */
export async function serveAvatar(
  reqPath: string,
  res: Response,
): Promise<void> {
  // reqPath looks like /objects/avatars/<userId>/<filename>
  const segments = reqPath.replace(/^\/objects\/avatars\//, "").split("/");
  if (segments.length < 2) {
    const err: any = new Error("Not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  const [rawUserId, rawFilename] = segments;
  const safeId = safeUserId(decodeURIComponent(rawUserId));
  const filename = path.basename(decodeURIComponent(rawFilename));

  if (s3Enabled()) {
    let buf: Buffer;
    try {
      const response = await objectStorageClient.send(new GetObjectCommand({
        Bucket: s3Bucket(),
        Key: path.posix.join("avatars", safeId, filename),
      }));
      if (!response.Body) {
        const err: any = new Error("Not found");
        err.code = "NOT_FOUND";
        throw err;
      }
      buf = Buffer.from(await response.Body.transformToByteArray());
    } catch (error: any) {
      // A missing object makes the AWS SDK throw (NoSuchKey / NotFound /
      // 404) BEFORE we can inspect `response.Body`. Map those to the same
      // NOT_FOUND contract the route (GET /objects/avatars/*) relies on to
      // return 404 instead of 500. Re-throw anything else (permissions,
      // network) so genuine failures still surface as 500.
      if (error?.code === "NOT_FOUND") throw error;
      if (
        error?.name === "NoSuchKey" ||
        error?.name === "NotFound" ||
        error?.$metadata?.httpStatusCode === 404
      ) {
        const err: any = new Error("Not found");
        err.code = "NOT_FOUND";
        throw err;
      }
      throw error;
    }
    const mime = detectImageMimeFromBuffer(buf) ?? "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "private, max-age=86400, immutable");
    res.end(buf);
    return;
  }

  const filePath = path.join(AVATARS_ROOT, safeId, filename);

  let buf: Buffer;
  try {
    buf = await fs.promises.readFile(filePath);
  } catch {
    const err: any = new Error("Not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  const mime = detectImageMimeFromBuffer(buf) ?? "application/octet-stream";
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.end(buf);
}

/** Best-effort cleanup of older avatars for a user. */
async function pruneOtherAvatars(userId: string, keepFilename: string): Promise<void> {
  try {
    if (s3Enabled()) {
      const bucket = s3Bucket();
      const prefix = path.posix.join("avatars", userId, "");
      const listed = await objectStorageClient.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
      }));
      await Promise.all(
        (listed.Contents ?? [])
          .filter((object) => object.Key && object.Key !== path.posix.join(prefix, keepFilename))
          .map((object) => objectStorageClient.send(new DeleteObjectCommand({
            Bucket: bucket,
            Key: object.Key,
          }))),
      );
      return;
    }

    const dir = userAvatarDir(userId);
    const files = await fs.promises.readdir(dir).catch(() => [] as string[]);
    await Promise.all(
      files
        .filter((f) => f !== keepFilename)
        .map((f) =>
          fs.promises.unlink(path.join(dir, f)).catch(() => undefined),
        ),
    );
  } catch {
    // best-effort — a sweep failure must never block the upload
  }
}