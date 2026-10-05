import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * M1 verification — document storage against REAL S3 (through the app's own
 * functions, not the AWS CLI).
 *
 * The existing server/ai/object_storage/objectStorage.test.ts mocks the AWS
 * SDK, so it proves the adapter's logic but never touches a bucket. This test
 * exercises the actual exported document-storage functions end-to-end against
 * a live S3-compatible bucket:
 *
 *   saveDocumentFile  -> PutObject
 *   readDocumentFile  -> GetObject (byte-for-byte round trip)
 *   missing object    -> GetObject on a bogus key throws (controlled error)
 *   deleteDocumentFileIfOrphaned (referenced)   -> keeps the object
 *   deleteDocumentFileIfOrphaned (unreferenced) -> deletes the object
 *
 * It is GATED on a configured S3 bucket (OBJECT_STORAGE_PROVIDER=s3 +
 * AWS_S3_BUCKET) and skips cleanly otherwise, exactly like the DB-backed
 * tests skip without DATABASE_URL. Run it against the NON-ROOT
 * `easy-accounting-dev` IAM profile so a pass also proves the least-privilege
 * policy (s3:PutObject / GetObject / DeleteObject / ListBucket) is sufficient.
 *
 * Server modules are imported dynamically so this file does not crash to load
 * in environments where ../db (pulled in transitively) throws on a missing
 * DATABASE_URL.
 */

const S3_CONFIGURED =
  process.env.OBJECT_STORAGE_PROVIDER === "s3" &&
  Boolean(process.env.AWS_S3_BUCKET && process.env.AWS_S3_BUCKET.trim());

const d = S3_CONFIGURED ? describe : describe.skip;

const TAG = `s3doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
// A test-only company id high enough not to collide with any real workspace.
const TEST_COMPANY_ID = 990000000 + Math.floor(Math.random() * 9_000_000);

let docStorage: typeof import("../services/document-storage");
const savedPaths: string[] = [];

beforeAll(async () => {
  if (!S3_CONFIGURED) return;
  docStorage = await import("../services/document-storage");
});

afterAll(async () => {
  if (!S3_CONFIGURED || !docStorage) return;
  // Best-effort cleanup: force-delete anything this test wrote, treating each
  // as unreferenced so the orphan guard actually removes it.
  for (const p of savedPaths) {
    await docStorage
      .deleteDocumentFileIfOrphaned(p, async () => false)
      .catch(() => undefined);
  }
});

d("document-storage against real S3 (M1)", () => {
  it("uploads to S3 and reads the exact same bytes back", async () => {
    const buffer = Buffer.from(`hello-s3-${TAG}-\u0000\u00ff binary payload`, "utf8");
    const saved = await docStorage.saveDocumentFile({
      companyId: TEST_COMPANY_ID,
      buffer,
      originalName: "receipt.pdf",
    });
    savedPaths.push(saved.storagePath);

    // storagePath must be an s3:// URI under documents/<companyId>/.
    expect(saved.storagePath).toMatch(/^s3:\/\/.+\/documents\/\d+\/[0-9a-f]{64}\.pdf$/);
    expect(saved.sizeBytes).toBe(buffer.length);

    const readBack = await docStorage.readDocumentFile(saved.storagePath);
    expect(Buffer.compare(readBack, buffer)).toBe(0);
  });

  it("deduplicates identical content to the same key (same sha256)", async () => {
    const buffer = Buffer.from(`dedupe-${TAG}`, "utf8");
    const a = await docStorage.saveDocumentFile({
      companyId: TEST_COMPANY_ID,
      buffer,
      originalName: "a.png",
    });
    const b = await docStorage.saveDocumentFile({
      companyId: TEST_COMPANY_ID,
      buffer,
      originalName: "b.png",
    });
    savedPaths.push(a.storagePath, b.storagePath);
    // Same bytes -> same sha256 -> same key, regardless of original filename.
    expect(a.storagePath).toBe(b.storagePath);
    expect(a.sha256).toBe(b.sha256);
  });

  it("throws a controlled error when reading a missing object", async () => {
    const bucket = process.env.AWS_S3_BUCKET!.trim();
    const bogus = `s3://${bucket}/documents/${TEST_COMPANY_ID}/${"0".repeat(64)}.bin`;
    await expect(docStorage.readDocumentFile(bogus)).rejects.toBeTruthy();
  });

  it("keeps the object when a row still references it (orphan guard)", async () => {
    const buffer = Buffer.from(`keep-${TAG}`, "utf8");
    const saved = await docStorage.saveDocumentFile({
      companyId: TEST_COMPANY_ID,
      buffer,
      originalName: "keep.pdf",
    });
    savedPaths.push(saved.storagePath);

    // isReferenced() returns true -> delete must be a no-op.
    await docStorage.deleteDocumentFileIfOrphaned(saved.storagePath, async () => true);

    // Still readable.
    const readBack = await docStorage.readDocumentFile(saved.storagePath);
    expect(Buffer.compare(readBack, buffer)).toBe(0);
  });

  it("deletes the object when no row references it (orphan cleanup)", async () => {
    const buffer = Buffer.from(`drop-${TAG}`, "utf8");
    const saved = await docStorage.saveDocumentFile({
      companyId: TEST_COMPANY_ID,
      buffer,
      originalName: "drop.pdf",
    });

    // isReferenced() returns false -> object must be deleted.
    await docStorage.deleteDocumentFileIfOrphaned(saved.storagePath, async () => false);

    // Now a read must fail (object gone).
    await expect(docStorage.readDocumentFile(saved.storagePath)).rejects.toBeTruthy();
  });
});
