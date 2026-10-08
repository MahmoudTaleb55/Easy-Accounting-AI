import { Response } from "express";
import { randomUUID } from "crypto";
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  PutObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
  type ObjectStorageFileLike,
} from "./objectAcl";

class S3ObjectFile implements ObjectStorageFileLike {
  constructor(
    public readonly client: S3Client,
    public readonly bucket: string,
    public readonly key: string,
  ) {}

  get name(): string {
    return `${this.bucket}/${this.key}`;
  }

  async exists(): Promise<[boolean]> {
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.key,
      }));
      return [true];
    } catch (error: any) {
      if (error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404) {
        return [false];
      }
      throw error;
    }
  }

  async getMetadata(): Promise<any[]> {
    const result = await this.client.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: this.key,
    }));

    return [{
      contentType: result.ContentType ?? "application/octet-stream",
      size: Number(result.ContentLength ?? 0),
      metadata: result.Metadata ?? {},
    }];
  }

  async setMetadata(payload: { metadata?: Record<string, string> }): Promise<void> {
    const response = await this.client.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: this.key,
    }));

    const metadata = { ...(response.Metadata ?? {}), ...(payload.metadata ?? {}) };

    await this.client.send(new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${this.key}`,
      Key: this.key,
      MetadataDirective: "REPLACE",
      Metadata: metadata,
      ContentType: response.ContentType ?? "application/octet-stream",
      CacheControl: response.CacheControl,
    }));
  }

  async createReadStream(): Promise<NodeJS.ReadableStream> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.key,
    }));
    if (!response.Body) {
      throw new Error(`Object is empty: ${this.name}`);
    }
    return response.Body as NodeJS.ReadableStream;
  }
}

function getObjectStorageClient(): S3Client {
  const region = process.env.AWS_REGION || "us-east-1";
  const endpoint = process.env.AWS_S3_ENDPOINT || process.env.S3_ENDPOINT;
  const config: S3ClientConfig = { region };

  if (endpoint) {
    config.endpoint = endpoint;
    config.forcePathStyle = true;
  }

  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    };
  }
  // NOTE: When static AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY are absent but
  // AWS_PROFILE is set (the current .env case: OBJECT_STORAGE_PROVIDER=s3,
  // empty keys, AWS_PROFILE=easy-accounting-dev), we deliberately leave
  // `config.credentials` unset so the S3 client resolves credentials via the
  // ambient AWS credential provider chain, which picks up AWS_PROFILE from
  // ~/.aws/config|credentials. Binding the profile explicitly would require
  // `fromIni` from `@aws-sdk/credential-providers`, which is NOT a declared
  // dependency of this project — adding it is out of scope here. If uploads
  // 500 with a credentials error, ensure the AWS_PROFILE named in .env
  // resolves to valid credentials in the server process's environment.

  return new S3Client(config);
}

export const objectStorageClient = getObjectStorageClient();

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const bucket = process.env.AWS_S3_BUCKET;
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || (bucket ? `/${bucket}/public` : "");
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Set OBJECT_STORAGE_PROVIDER=s3 and provide PUBLIC_OBJECT_SEARCH_PATHS or AWS_S3_BUCKET.",
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const bucket = process.env.AWS_S3_BUCKET;
    const dir = process.env.PRIVATE_OBJECT_DIR || (bucket ? `/${bucket}/private` : "");
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Set PRIVATE_OBJECT_DIR or AWS_S3_BUCKET for S3-compatible storage.",
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<S3ObjectFile | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const file = new S3ObjectFile(objectStorageClient, bucketName, objectName);
      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(file: S3ObjectFile, res: Response, cacheTtlSec: number = 3600) {
    try {
      const [metadata] = await file.getMetadata();
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";

      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": String(metadata.size ?? 0),
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
      });

      const stream = await file.createReadStream();
      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });

      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: objectName,
      ContentType: "application/octet-stream",
    });

    return getSignedUrl(objectStorageClient, command, { expiresIn: 900 });
  }

  async getObjectEntityFile(objectPath: string): Promise<S3ObjectFile> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const objectFile = new S3ObjectFile(objectStorageClient, bucketName, objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("http://") && !rawPath.startsWith("https://")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = decodeURIComponent(url.pathname);
    const objectEntityDir = this.getPrivateObjectDir();
    const { bucketName, objectName } = parseObjectPath(objectEntityDir);
    const bucketPrefix = `/${bucketName}/${objectName}`;

    if (!rawObjectPath.startsWith(`${bucketPrefix}/`)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(`${bucketPrefix}/`.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: S3ObjectFile;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  const trimmed = path.trim();
  const normalizedPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const pathParts = normalizedPath.split("/").filter(Boolean);
  if (pathParts.length < 2) {
    throw new Error("Invalid path: must contain at least a bucket name and object key");
  }

  const [bucketName, ...objectParts] = pathParts;
  return {
    bucketName,
    objectName: objectParts.join("/"),
  };
}

