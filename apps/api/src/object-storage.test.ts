import { describe, expect, it } from "vitest";
import { createStorageKey, ObjectStorageError, validateConfirmedImage } from "./object-storage.js";

const checksum = "a".repeat(64);

describe("tenant object storage", () => {
  it("creates organization-isolated keys and removes path traversal", () => {
    const key = createStorageKey("org-1", "../../front view (1).jpg", "upload-1");
    expect(key).toBe("organizations/org-1/media/upload-1/front-view-1-.jpg");
    expect(key).not.toContain("..");
  });

  it("confirms an object only when its signed metadata and checksum match", () => {
    expect(validateConfirmedImage({
      organizationId: "org-1",
      storageKey: "organizations/org-1/media/upload-1/front.jpg",
      contentLength: 1_024,
      contentType: "image/jpeg",
      checksumSha256: Buffer.from(checksum, "hex").toString("base64"),
      metadata: {
        organizationid: "org-1",
        kind: "image",
        sha256: checksum,
        originalfilename: Buffer.from("front.jpg").toString("base64url"),
      },
    })).toMatchObject({
      originalFilename: "front.jpg",
      mimeType: "image/jpeg",
      byteSize: 1_024,
      checksum,
    });
  });

  it("rejects cross-organization keys and mismatched object checksums", () => {
    expect(() => validateConfirmedImage({
      organizationId: "org-2",
      storageKey: "organizations/org-1/media/upload-1/front.jpg",
    })).toThrow(ObjectStorageError);

    expect(() => validateConfirmedImage({
      organizationId: "org-1",
      storageKey: "organizations/org-1/media/upload-1/front.jpg",
      contentLength: 1_024,
      contentType: "image/jpeg",
      checksumSha256: Buffer.from("b".repeat(64), "hex").toString("base64"),
      metadata: {
        organizationid: "org-1",
        kind: "image",
        sha256: checksum,
        originalfilename: Buffer.from("front.jpg").toString("base64url"),
      },
    })).toThrow("does not match");
  });
});
