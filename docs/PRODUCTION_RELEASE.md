# Production release checklist

This checklist releases the current catalog preparation milestone: authenticated organization context, spreadsheet staging, image mapping, import confirmation, catalog management, tenant-scoped competitor pricing and fitment, seller OAuth, and editable listing drafts with readiness checks. Live eBay publishing, complete login/onboarding, and the admin panel are later product phases. Do not market this build as the complete publishing SaaS yet.

## 1. Security prerequisites

- Rotate the JWT access secret that was previously committed. Removing it from the current file does not invalidate copies in Git history.
- Rotate any eBay sandbox credentials previously committed in `.env.example`, even if GitHub blocked some pushes.
- Use different JWT access and refresh secrets, each generated independently.
- Keep secrets in Railway server services only. The API and worker need the database/provider variables used by their code. Never add them to the web service or prefix them with `NEXT_PUBLIC_`.
- Confirm the GitHub repository and latest push pass secret scanning.
- Restrict Railway project access and enable MFA for Railway, GitHub, eBay, the database provider, and object-storage provider.
- Enable automated PostgreSQL backups and object-storage lifecycle/retention rules.

## 2. Railway API service

Use the repository root as the service root.

```text
Build command: npm run build -w @price-intel/api
Pre-deploy command: npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
Start command: npm run start -w @price-intel/api
Health-check path: /health/ready
```

Railway supplies `PORT`; do not hard-code a production port. Set `API_SHUTDOWN_TIMEOUT_MS=10000` and `JOB_EXECUTION_MODE=worker`. Keep one API replica because rate limits are held in process memory. Move rate-limit counters to Redis before enabling multiple API replicas.

The API fails at startup when `NODE_ENV=production` and any core production variable is missing. Configure:

```text
DATABASE_URL
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
JWT_ISSUER
JWT_AUDIENCE
JWT_ACCESS_TTL_SECONDS
JWT_REFRESH_TTL_SECONDS
WEB_ORIGIN
STORAGE_BUCKET
STORAGE_REGION
STORAGE_ENDPOINT (for an S3-compatible provider when required)
STORAGE_ACCESS_KEY_ID
STORAGE_SECRET_ACCESS_KEY
STORAGE_FORCE_PATH_STYLE
STORAGE_UPLOAD_URL_TTL_SECONDS
STORAGE_MAX_IMAGE_BYTES
STORAGE_MAX_IMPORT_BYTES
STORAGE_MAX_IMAGE_ARCHIVE_BYTES
EBAY_CLIENT_ID
EBAY_CLIENT_SECRET
EBAY_ENVIRONMENT=production
EBAY_NOTIFICATION_ENDPOINT
EBAY_NOTIFICATION_VERIFICATION_TOKEN
OWN_SELLERS
API_SHUTDOWN_TIMEOUT_MS
JOB_EXECUTION_MODE=worker
```

`WEB_ORIGIN` must be the exact public HTTPS origin of the web service. `EBAY_NOTIFICATION_ENDPOINT` must be the exact public API callback ending in `/api/ebay/account-deletion` and must match the value registered with eBay.

## 2a. Railway worker service

Create another Railway service from the same repository. It does not need a public domain.

```text
Build command: npm run build:worker
Start command: npm run start:worker
Replicas: exactly one
```

Configure the lease, heartbeat, retry, and shutdown variables in [Background Worker Operations](WORKER_OPERATIONS.md), plus the same `DATABASE_URL`, eBay credentials, and provider variables used by pricing and fitment. Monitor `GET /health/worker` from the public API domain. See [Microservice Architecture](MICROSERVICES_ARCHITECTURE.md) for the complete boundary and deployment rules.

Deploy the delivery-safety migration before the API/worker release. See [Idempotency, Outbox, and Dead-letter Handling](DELIVERY_SAFETY.md) for command headers, event delivery, operator replay, and deployment order.

Deploy the listing-draft migration before exposing the Step 17 web controls. See [Listing Drafts and Publication Readiness](LISTING_DRAFTS.md). Draft validation is local preparation only and does not authorize or perform an eBay publish operation.

Deploy the Step 18 seller-resource/category-metadata migration before exposing live validation controls. Verify the connected seller granted both `sell.account` and `sell.inventory`, then follow [eBay Seller Resources and Live Listing Validation](EBAY_LIVE_METADATA.md). Live validation still does not publish.

Deploy the Step 19 preparation migration before exposing image-staging controls. Both API and worker need object-storage and eBay application credentials. Follow [eBay Image Staging and Inventory Preparation](EBAY_INVENTORY_PREPARATION.md) and confirm the worker is healthy before queueing a production preparation.

## 3. Railway web service

Use the repository root as the service root.

```text
Build command: npm run build -w @price-intel/web
Start command: npm run start -w @price-intel/web
```

Configure only:

```text
NEXT_PUBLIC_API_URL=https://your-api-service.up.railway.app
```

This value is embedded during the Next.js build, so changing it requires a web redeploy. It must be the public API URL because catalog requests originate in the user's browser.

## 4. Release gate

Run locally or in CI from a clean checkout:

```powershell
npm ci
npm run release:check
npm audit --omit=dev
git diff --check
```

Review `npm audit` findings rather than applying a forced major-version update automatically. Confirm all Prisma migrations are committed and ordered before deployment.

## 5. Deploy and smoke test

1. Deploy the API and allow the pre-deploy migration to complete.
2. Confirm `/health/live` returns HTTP 200.
3. Confirm `/health/ready` returns HTTP 200 and reports PostgreSQL connected.
4. Deploy the web service.
5. Run the read-only smoke test:

```powershell
$env:API_BASE_URL="https://your-api-service.up.railway.app"
$env:API_ACCESS_TOKEN="a-short-lived-access-token"
npm run smoke:production
```

Omit `API_ACCESS_TOKEN` to run only public health/security checks. The script never creates, edits, publishes, or deletes data.

6. Confirm eBay's marketplace account-deletion test succeeds.
7. In a dedicated test organization, perform the golden flow: upload one spreadsheet, upload its image ZIP, resolve every review item, confirm once, verify catalog rows/images/inventory, edit one part, export CSV, and confirm a second organization cannot access any IDs from the first.

## 6. Monitoring

- Railway should restart the API when readiness remains unhealthy.
- Logs are one-line JSON for HTTP requests and include `requestId`, method, path, status, and duration without query strings or authorization headers.
- Error responses include the same `requestId` so an operator can find the matching log.
- Alert on repeated HTTP 500/503 responses, database connection failures, eBay 401/403/429 responses, failed notification deliveries, storage failures, and forced shutdowns.
- Review rate-limit 429 counts. Current per-instance limits are 600 general requests per 15 minutes, 120 searches per minute, 30 imports per hour, 30 refresh attempts per 15 minutes, and 240 catalog writes per 15 minutes per client IP.

## 7. Rollback

1. Stop new imports and catalog edits if data integrity is in question.
2. Roll back the API/web deployment to the previous Railway deployment.
3. Do not manually reverse an applied Prisma migration or delete production rows. Prefer a forward corrective migration.
4. If credentials may have leaked, rotate them before restoring traffic.
5. Re-run `/health/ready` and the smoke test after rollback.

## 8. Known release limitations

- Apply `20260723060000_add_inventory_sync`, deploy API/worker/web from one commit, and smoke-test one dedicated non-publishing SKU before enabling Step 20 for operators.
- Apply `20260723070000_add_offer_publication` before Step 21. Prepare and inspect fees for a dedicated low-risk SKU before explicitly approving its first live publication.

- The current Next.js 15 dependency pins PostCSS 8.4.31, which npm audit reports for a moderate CSS-stringification XSS advisory. This application does not stringify user-supplied CSS, so the vulnerable path is not currently exposed. Track the upstream Next.js fix and upgrade when a compatible release is available; do not use npm's suggested forced downgrade to Next 9.
- Login, password reset, invitations, and onboarding UI are not complete. The catalog UI currently relies on an existing refresh session or a short-lived development access token.
- Rate limiting is per API process, not distributed.
- Pricing and fitment jobs run in the dedicated worker in production and currently use PostgreSQL leases rather than a broker-backed queue.
- Pricing recommendations are market statistics only. Cost floors, pricing rules, proposal approval, overrides, and audit events are not implemented yet.
- Sensitive catalog changes do not yet have a durable audit-event model.
- Object-storage uploads performed immediately before a failed database transaction may require an orphan cleanup job.
- Large import confirmation is transactional and synchronous; queue-based processing is still required before high-volume use.
- Creating missing policies/locations, category suggestion, Inventory API writes, publishing/revision/withdrawal, and admin functionality remain unimplemented product phases.
