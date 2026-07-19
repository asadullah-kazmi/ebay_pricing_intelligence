# Object storage setup

PartPulse supports private AWS S3 and S3-compatible storage such as Cloudflare R2. R2 is a practical starting choice because its S3-compatible API works with the same application code. Confirm current provider limits and pricing before choosing a production plan.

## Required API variables

```env
STORAGE_BUCKET=partpulse-production
STORAGE_REGION=auto
STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
STORAGE_ACCESS_KEY_ID=<private-access-key-id>
STORAGE_SECRET_ACCESS_KEY=<private-secret-access-key>
STORAGE_FORCE_PATH_STYLE=false
STORAGE_UPLOAD_URL_TTL_SECONDS=300
STORAGE_MAX_IMAGE_BYTES=20971520
STORAGE_MAX_IMPORT_BYTES=10485760
```

For AWS S3, use the bucket's AWS region and leave `STORAGE_ENDPOINT` empty. For a local S3-compatible service, an HTTPS endpoint is required by production configuration; path-style access can be enabled when the provider requires it.

Add these variables only to the Railway API service. Never prefix them with `NEXT_PUBLIC_`, expose them to the web build, or commit their values.

## Cloudflare R2

1. Create a private R2 bucket.
2. Create an R2 API token restricted to Object Read and Object Write for that bucket.
3. Copy the S3 access-key ID, secret access key, bucket name, account endpoint, and use region `auto`.
4. Add the variables above to the Railway API service.
5. Configure bucket CORS using the exact deployed web origin.

Example CORS policy:

```json
[
  {
    "AllowedOrigins": ["https://your-web-service.up.railway.app"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Content-Type", "x-amz-*"],
    "ExposeHeaders": ["ETag", "x-amz-checksum-sha256"],
    "MaxAgeSeconds": 3600
  }
]
```

## AWS S3

1. Create a private S3 bucket with public access blocked.
2. Create an IAM user or role restricted to `s3:PutObject`, `s3:GetObject`, and `s3:HeadObject` for that bucket's object ARN.
3. Store its access key and secret in the Railway API service.
4. Configure equivalent bucket CORS for the web origin.

Do not grant bucket administration or public-object permissions to the application credentials.

## Upload flow

1. The authenticated web app calculates the image's SHA-256 digest.
2. It requests `POST /api/media/upload-url` with `filename`, `mimeType`, `byteSize`, and the hexadecimal `checksum`.
3. It uploads the file with `PUT` to the returned URL using every returned `requiredHeaders` value.
4. It calls `POST /api/media/uploads/confirm` with the returned `storageKey`.
5. The API checks organization ownership, content length, MIME type, signed metadata, and the storage-provider SHA-256 checksum before creating the `MediaAsset` row.

Objects remain private. `GET /api/media/:id/download-url` returns a short-lived download URL only after an organization-scoped database lookup.

Spreadsheet uploads received by `POST /api/imports/validate` are stored under an organization-specific `imports/` prefix before staging rows are written. `STORAGE_MAX_IMPORT_BYTES` limits the compressed CSV/XLSX request size; the XLSX parser separately limits expanded worksheet data.
