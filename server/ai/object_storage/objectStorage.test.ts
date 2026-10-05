import { describe, it, expect } from "vitest";

import { ObjectStorageService } from "./objectStorage";

describe("ObjectStorageService", () => {
  it("supports AWS S3 environment configuration without platform-specific sidecar settings", () => {
    const previous = {
      PUBLIC_OBJECT_SEARCH_PATHS: process.env.PUBLIC_OBJECT_SEARCH_PATHS,
      PRIVATE_OBJECT_DIR: process.env.PRIVATE_OBJECT_DIR,
      AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
      AWS_REGION: process.env.AWS_REGION,
      OBJECT_STORAGE_PROVIDER: process.env.OBJECT_STORAGE_PROVIDER,
    };

    try {
      process.env.OBJECT_STORAGE_PROVIDER = "s3";
      process.env.AWS_S3_BUCKET = "acme-assets";
      process.env.AWS_REGION = "us-east-1";
      process.env.PUBLIC_OBJECT_SEARCH_PATHS = "/acme-assets/public, /acme-assets/media";
      process.env.PRIVATE_OBJECT_DIR = "/acme-assets/private";

      const service = new ObjectStorageService();

      expect(service.getPublicObjectSearchPaths()).toEqual([
        "/acme-assets/public",
        "/acme-assets/media",
      ]);
      expect(service.getPrivateObjectDir()).toBe("/acme-assets/private");
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
