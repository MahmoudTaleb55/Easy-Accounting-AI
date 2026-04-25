/**
 * Object-storage-backed persistence for user avatar images. Files are
 * written to the bucket configured by `PRIVATE_OBJECT_DIR` under
 * `avatars/<userId>/<sha256>.<ext>` and tagged with a public ACL so the
 * standard `/objects/<entityId>` route can serve them to anyone with
 * the URL.
 *
 * Hashing the buffer means re-uploading the same image is idempotent;
 * we sweep older avatars for the same user when a new one is saved so
 * old objects don't pile up in the bucket.
 */
import crypto from "crypto";
import path from "path";
import {
  objectStorageClient,
  ObjectStorageService,
} from "../replit_integrations/object_storage";

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export const ALLOWED_AVATAR_MIME_TYPES = Object.keys(MIME_TO_EXT);
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB

export interface SavedAvatarFile {
  /** Sha-hashed filename, e.g. "<sha256>.png". */
  filename: string;
  /** Absolute object path within the bucket (without the bucket name). */
  objectName: string;
  /** Public URL the client should render — `/objects/avatars/<userId>/<filename>`. */
  publicUrl: string;
  sizeBytes: number;
}

function parseObjectPath(p: string): { bucketName: string; objectName: string } {
  const normalized = p.startsWith("/") ? p : `/${p}`;
  const parts = normalized.split("/");
  if (parts.length < 3) {
    throw new Error(`Invalid object path: ${p}`);
  }
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

function getPrivateRoot(): { bucketName: string; rootPrefix: string } {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR is not configured — set up object storage before uploading avatars.",
    );
  }
  const { bucketName, objectName } = parseObjectPath(dir);
  // Strip a trailing slash so we can join cleanly with `/`.
  const rootPrefix = objectName.replace(/\/+$/, "");
  return { bucketName, rootPrefix };
}

function safeUserId(userId: string): string {
  const cleaned = userId.replace(/[^A-Za-z0-9._-]/g, "");
  if (!cleaned) throw new Error("Invalid user id");
  return cleaned;
}

function avatarObjectName(userId: string, filename: string): string {
  const { rootPrefix } = getPrivateRoot();
  const safeId = safeUserId(userId);
  return `${rootPrefix}/avatars/${safeId}/${filename}`;
}

/**
 * Build the public-facing URL the client should use to render the avatar.
 * Stored on `users.profileImageUrl`. The standard `/objects/:objectPath(*)`
 * route registered by the object-storage blueprint serves these.
 */
export function buildAvatarUrl(userId: string, filename: string): string {
  const safeId = safeUserId(userId);
  // Components are filename-safe — no need to encode `/` separators.
  return `/objects/avatars/${encodeURIComponent(safeId)}/${encodeURIComponent(filename)}`;
}

export async function saveAvatarFile(opts: {
  userId: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<SavedAvatarFile> {
  const ext = MIME_TO_EXT[opts.mimeType.toLowerCase()];
  if (!ext) {
    throw new Error(`Unsupported avatar mime type: ${opts.mimeType}`);
  }
  const safeId = safeUserId(opts.userId);

  const sha256 = crypto.createHash("sha256").update(opts.buffer).digest("hex");
  const filename = `${sha256}${ext}`;
  const objectName = avatarObjectName(safeId, filename);
  const { bucketName } = getPrivateRoot();

  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);

  // Avatars are intended to be visible to anyone in the app (member
  // rosters, comment threads). Storing them with a public ACL means
  // the standard /objects/:objectPath route serves them without
  // requiring a session — matching how user-uploaded avatars work on
  // most fintech tools.
  const aclPolicy = {
    owner: safeId,
    visibility: "public" as const,
  };

  await file.save(opts.buffer, {
    contentType: opts.mimeType,
    metadata: {
      contentType: opts.mimeType,
      cacheControl: "public, max-age=86400, immutable",
      metadata: {
        "custom:aclPolicy": JSON.stringify(aclPolicy),
      },
    },
    resumable: false,
  });

  await pruneOtherAvatars(safeId, filename);

  return {
    filename,
    objectName,
    publicUrl: buildAvatarUrl(safeId, filename),
    sizeBytes: opts.buffer.length,
  };
}

/**
 * Best-effort cleanup of any other avatar objects this user owns that
 * aren't the one we just saved. A failure here must never break the
 * upload — we just leak a small object until the next successful save.
 */
async function pruneOtherAvatars(userId: string, keepFilename: string): Promise<void> {
  try {
    const { bucketName, rootPrefix } = getPrivateRoot();
    const prefix = `${rootPrefix}/avatars/${userId}/`;
    const bucket = objectStorageClient.bucket(bucketName);
    const [files] = await bucket.getFiles({ prefix });
    await Promise.all(
      files
        .filter((f) => path.posix.basename(f.name) !== keepFilename)
        .map((f) => f.delete({ ignoreNotFound: true }).catch(() => undefined)),
    );
  } catch {
    // best-effort
  }
}

/**
 * Build an `ObjectStorageService` instance — exposed so callers can
 * reuse the same client without re-instantiating.
 */
export function getObjectStorageService(): ObjectStorageService {
  return new ObjectStorageService();
}
