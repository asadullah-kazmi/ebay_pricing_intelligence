import { randomUUID } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { getConfig } from "./config.js";

export const allowedImageMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;

export const imageUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(allowedImageMimeTypes),
  byteSize: z.number().int().positive(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i, "checksum must be a SHA-256 hex digest").transform((value) => value.toLowerCase()),
});

export type ImageUploadInput = z.infer<typeof imageUploadSchema>;

export interface ConfirmedImageObject {
  storageKey: string;
  originalFilename: string;
  mimeType: (typeof allowedImageMimeTypes)[number];
  byteSize: number;
  checksum: string;
}

export class ObjectStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStorageError";
  }
}

function safeSegment(value: string): string {
  const sanitized = value.normalize("NFKC").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.slice(0, 120) || "file";
}

function safeFilename(value: string): string {
  const leaf = value.split(/[\\/]/).at(-1) ?? value;
  const sanitized = leaf
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return sanitized.slice(0, 120) || "file";
}

export function createStorageKey(organizationId: string, filename: string, id: string = randomUUID()): string {
  return `organizations/${safeSegment(organizationId)}/media/${safeSegment(id)}/${safeFilename(filename)}`;
}

export function createImportStorageKey(organizationId: string, filename: string, id: string = randomUUID()): string {
  return `organizations/${safeSegment(organizationId)}/imports/${safeSegment(id)}/${safeFilename(filename)}`;
}

export function assertOwnedStorageKey(organizationId: string, storageKey: string): void {
  const prefix = `organizations/${safeSegment(organizationId)}/media/`;
  if (!storageKey.startsWith(prefix) || storageKey.includes("..")) {
    throw new ObjectStorageError("The object does not belong to this organization");
  }
}

function encodeMetadataValue(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeMetadataValue(value: string | undefined): string {
  if (!value) throw new ObjectStorageError("Uploaded object metadata is incomplete");
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    throw new ObjectStorageError("Uploaded object metadata is invalid");
  }
}

export function validateConfirmedImage(input: {
  organizationId: string;
  storageKey: string;
  contentLength?: number;
  contentType?: string;
  checksumSha256?: string;
  metadata?: Record<string, string>;
}): ConfirmedImageObject {
  assertOwnedStorageKey(input.organizationId, input.storageKey);
  const originalFilename = decodeMetadataValue(input.metadata?.originalfilename);
  const parsed = imageUploadSchema.safeParse({
    filename: originalFilename,
    mimeType: input.contentType,
    byteSize: input.contentLength,
    checksum: input.metadata?.sha256,
  });
  const actualChecksum = parsed.success ? Buffer.from(parsed.data.checksum, "hex").toString("base64") : undefined;
  if (
    !parsed.success
    || input.metadata?.organizationid !== input.organizationId
    || input.metadata?.kind !== "image"
    || input.checksumSha256 !== actualChecksum
  ) {
    throw new ObjectStorageError("Uploaded object metadata does not match the upload request");
  }
  return { storageKey: input.storageKey, originalFilename, ...parsed.data };
}

export class ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: NonNullable<ReturnType<typeof getConfig>["storage"]>) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async createImageUpload(organizationId: string, rawInput: unknown) {
    const input = imageUploadSchema.parse(rawInput);
    if (input.byteSize > this.config.maxImageBytes) {
      throw new ObjectStorageError(`Image exceeds the ${this.config.maxImageBytes}-byte upload limit`);
    }
    const storageKey = createStorageKey(organizationId, input.filename);
    const metadata = {
      organizationid: organizationId,
      kind: "image",
      sha256: input.checksum,
      originalfilename: encodeMetadataValue(input.filename),
    };
    const checksumSha256 = Buffer.from(input.checksum, "hex").toString("base64");
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: storageKey,
      ContentType: input.mimeType,
      ContentLength: input.byteSize,
      ChecksumSHA256: checksumSha256,
      Metadata: metadata,
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: this.config.uploadUrlTtlSeconds });
    return {
      storageKey,
      uploadUrl,
      expiresIn: this.config.uploadUrlTtlSeconds,
      requiredHeaders: {
        "content-type": input.mimeType,
        "x-amz-checksum-sha256": checksumSha256,
        "x-amz-meta-organizationid": organizationId,
        "x-amz-meta-kind": "image",
        "x-amz-meta-sha256": input.checksum,
        "x-amz-meta-originalfilename": metadata.originalfilename,
      },
    };
  }

  async storeImportFile(input: {
    organizationId: string;
    filename: string;
    mimeType: string;
    bytes: Buffer;
    checksum: string;
  }): Promise<string> {
    if (input.bytes.length > this.config.maxImportBytes) {
      throw new ObjectStorageError(`Spreadsheet exceeds the ${this.config.maxImportBytes}-byte upload limit`);
    }
    const storageKey = createImportStorageKey(input.organizationId, input.filename);
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: storageKey,
        Body: input.bytes,
        ContentType: input.mimeType,
        ContentLength: input.bytes.length,
        ChecksumSHA256: Buffer.from(input.checksum, "hex").toString("base64"),
        Metadata: {
          organizationid: input.organizationId,
          kind: "spreadsheet",
          sha256: input.checksum,
          originalfilename: encodeMetadataValue(input.filename),
        },
      }));
      return storageKey;
    } catch {
      throw new ObjectStorageError("The source spreadsheet could not be stored");
    }
  }

  async storeImageArchive(input: {
    organizationId: string;
    importBatchId: string;
    filename: string;
    bytes: Buffer;
    checksum: string;
  }): Promise<string> {
    if (input.bytes.length > this.config.maxImageArchiveBytes) {
      throw new ObjectStorageError(`Image archive exceeds the ${this.config.maxImageArchiveBytes}-byte upload limit`);
    }
    const storageKey = `organizations/${safeSegment(input.organizationId)}/imports/${safeSegment(input.importBatchId)}/images/${randomUUID()}/${safeFilename(input.filename)}`;
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: storageKey,
        Body: input.bytes,
        ContentType: "application/zip",
        ContentLength: input.bytes.length,
        ChecksumSHA256: Buffer.from(input.checksum, "hex").toString("base64"),
        Metadata: {
          organizationid: input.organizationId,
          importbatchid: input.importBatchId,
          kind: "image-archive",
          sha256: input.checksum,
          originalfilename: encodeMetadataValue(input.filename),
        },
      }));
      return storageKey;
    } catch {
      throw new ObjectStorageError("The image archive could not be stored");
    }
  }

  async storeExtractedImage(input: {
    organizationId: string;
    filename: string;
    mimeType: ConfirmedImageObject["mimeType"];
    bytes: Buffer;
    checksum: string;
  }): Promise<ConfirmedImageObject> {
    if (input.bytes.length > this.config.maxImageBytes) throw new ObjectStorageError("Extracted image exceeds the configured size limit");
    const storageKey = createStorageKey(input.organizationId, input.filename);
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: storageKey,
        Body: input.bytes,
        ContentType: input.mimeType,
        ContentLength: input.bytes.length,
        ChecksumSHA256: Buffer.from(input.checksum, "hex").toString("base64"),
        Metadata: {
          organizationid: input.organizationId,
          kind: "image",
          sha256: input.checksum,
          originalfilename: encodeMetadataValue(input.filename),
        },
      }));
      return {
        storageKey,
        originalFilename: input.filename,
        mimeType: input.mimeType,
        byteSize: input.bytes.length,
        checksum: input.checksum,
      };
    } catch {
      throw new ObjectStorageError("An extracted image could not be stored");
    }
  }

  async confirmImageUpload(organizationId: string, storageKey: string): Promise<ConfirmedImageObject> {
    assertOwnedStorageKey(organizationId, storageKey);
    try {
      const object = await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: storageKey,
        ChecksumMode: "ENABLED",
      }));
      const confirmed = validateConfirmedImage({
        organizationId,
        storageKey,
        contentLength: object.ContentLength,
        contentType: object.ContentType,
        checksumSha256: object.ChecksumSHA256,
        metadata: object.Metadata,
      });
      if (confirmed.byteSize > this.config.maxImageBytes) throw new ObjectStorageError("Uploaded image exceeds the configured size limit");
      return confirmed;
    } catch (error) {
      if (error instanceof ObjectStorageError) throw error;
      throw new ObjectStorageError("The uploaded image could not be found or verified");
    }
  }

  async createDownloadUrl(organizationId: string, storageKey: string, expiresIn = 300): Promise<string> {
    assertOwnedStorageKey(organizationId, storageKey);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: storageKey }),
      { expiresIn: Math.min(Math.max(expiresIn, 60), 900) },
    );
  }

  async readImage(organizationId: string, storageKey: string): Promise<Uint8Array> {
    assertOwnedStorageKey(organizationId, storageKey);
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: storageKey }));
      if (!object.Body) throw new ObjectStorageError("The image object is empty");
      const bytes = await object.Body.transformToByteArray();
      if (!bytes.length || bytes.length > this.config.maxImageBytes) throw new ObjectStorageError("The image object has an invalid size");
      return bytes;
    } catch (error) {
      if (error instanceof ObjectStorageError) throw error;
      throw new ObjectStorageError("The image object could not be read");
    }
  }
}

let cachedStorage: ObjectStorage | undefined;

export function getObjectStorage(): ObjectStorage | null {
  const config = getConfig().storage;
  if (!config) return null;
  cachedStorage ??= new ObjectStorage(config);
  return cachedStorage;
}
