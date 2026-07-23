# eBay Automotive Competitor Price Intelligence

MVP implementation of the supplied system design. Search an OEM/MPN, verify exact part-number matches, exclude owned sellers, and calculate landed-price analytics.

## Run locally

1. Copy `.env.example` to `.env` and set credentials when available. Never put secrets in `.env.example`.
2. Install packages with `npm install`.
3. Create the PostgreSQL database named in `DATABASE_URL`.
4. Generate the client with `npm run db:generate`.
5. Apply the schema with `npm run db:migrate`.
6. Run both applications with `npm run dev`.
7. Open http://localhost:3000. The API runs on http://localhost:4000.

Without eBay credentials, the API intentionally uses realistic demo listings. Search results, listing snapshots, and price history are persisted in PostgreSQL through Prisma, so a valid `DATABASE_URL` and migrated database are required.

Check `GET http://localhost:4000/health` after startup. Its `ebay.mode` value is `demo` when credentials are absent and `live` when both credentials are configured. The persistence status reports whether PostgreSQL is reachable. It never returns credential values.

Use `GET /health/live` for process liveness and `GET /health/ready` for Railway readiness. Readiness returns HTTP 503 when PostgreSQL is unavailable.

For the production API/worker split, set `JOB_EXECUTION_MODE=worker` on both services and deploy `@price-intel/worker` without a public domain. Local development defaults to `inline`; `npm run dev:services` runs the API, worker, and web app together. See [Microservice Architecture](docs/MICROSERVICES_ARCHITECTURE.md) for Railway commands, ownership boundaries, and scaling limits.

The worker uses renewable database leases, bounded eBay retries, graceful shutdown, and persisted heartbeats. Monitor `GET /health/worker`; see [Background Worker Operations](docs/WORKER_OPERATIONS.md) for variables, alerting, and recovery behavior.

State-changing job commands support idempotency keys, job creation emits transactional outbox events, and exhausted items enter an operator-controlled dead-letter queue. See [Delivery Safety](docs/DELIVERY_SAFETY.md).

Run `npm run db:check` to test the configured PostgreSQL connection without starting the applications.
Run `npm run ebay:check` to verify the configured eBay credentials without performing a listing search.

## SaaS authentication foundation

New tenant-owned API routes use short-lived HS256 JWT access tokens and resolve the user's current organization membership from PostgreSQL on every request. Refresh JWTs use a separate signing secret, are stored only as SHA-256 hashes, and rotate after every successful refresh. Configure two different private random secrets of at least 32 characters:

```env
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ISSUER=partpulse-api
JWT_AUDIENCE=partpulse-web
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=2592000
WEB_ORIGIN=http://localhost:3000
```

`GET /api/session` accepts an access token in `Authorization: Bearer <token>`. Its token must contain `sub` (user ID) and `organizationId`; a valid signature alone is insufficient because the API also verifies the corresponding `OrganizationMembership`. `POST /api/auth/refresh` rotates the secure, HTTP-only `partpulse_refresh` cookie and returns a new access token. `POST /api/auth/logout` revokes and clears that refresh token. Initial token issuance is exposed as a server-side service for the login/onboarding flow; refresh tokens are never returned to browser JavaScript by these endpoints.

Set `WEB_ORIGIN` to the exact web application origin in Railway. Authentication cookie endpoints reject other origins. Use different access and refresh secrets in every environment and never commit them.

Generate each secret independently from a terminal (run this command twice and use a different result for each variable):

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

`JWT_ISSUER` and `JWT_AUDIENCE` are identifiers chosen by this application, not credentials supplied by another service. The TTL values are durations in seconds. In Railway, add the variables to the API service only; `WEB_ORIGIN` must be the public HTTPS domain of the web service without a trailing slash.

## eBay production notifications

eBay requires production applications that persist eBay data to receive marketplace account-deletion notifications. Deploy the API at a public HTTPS URL, then configure the exact callback URL and a private 32-80 character token:

```env
EBAY_NOTIFICATION_ENDPOINT=https://your-api.example.com/api/ebay/account-deletion
EBAY_NOTIFICATION_VERIFICATION_TOKEN=replace-with-a-private-random-token
```

Enter those same values in the eBay developer portal. The callback supports eBay's `GET` verification challenge and signed `POST` deletion notifications. If a notice contains a seller username, stored listings for that seller are deleted. If eBay omits the username, all stored listings are deleted so that unidentified account data cannot be retained.

## Applications

- `apps/web`: Next.js search dashboard.
- `apps/api`: Express API, matching engine, analytics, eBay provider boundary, and Prisma schema.

## Product roadmap

See [Automotive Catalog and eBay Publishing SaaS Implementation Plan](docs/SAAS_IMPLEMENTATION_PLAN.md) for the complete multi-tenant catalog, image mapping, pricing, fitment, editing, publishing, administration, testing, and delivery plan.

See [Object Storage Setup](docs/OBJECT_STORAGE_SETUP.md) for private AWS S3 or Cloudflare R2 configuration, Railway variables, bucket CORS, and the signed upload flow.

See [Catalog Intake Spreadsheet v1.0](docs/SPREADSHEET_TEMPLATE.md) for the versioned CSV template, column definitions, units, and data-entry rules.

See [Image Archive Format](docs/IMAGE_ARCHIVE_FORMAT.md) for ZIP structure, manifest fields, deterministic mapping precedence, and safety limits.

See [Import Review and Confirmation](docs/IMPORT_REVIEW.md) for preview pagination, manual image corrections, readiness blockers, and atomic catalog creation.

See [Catalog Workspace](docs/CATALOG_WORKSPACE.md) for catalog filters, editing, bulk status changes, export, and frontend session behavior.

See [Bulk Pricing Jobs](docs/BULK_PRICING.md) for selected-part eBay pricing, condition controls, job polling, exact-match evidence, and competitor listing snapshots.

See [eBay Seller Connection Setup](docs/EBAY_SELLER_OAUTH.md) for production RuName configuration, encrypted OAuth token storage, Railway variables, connection endpoints, and troubleshooting.

See [Listing Drafts and Publication Readiness](docs/LISTING_DRAFTS.md) for draft creation, editing, version history, readiness blockers, and the boundary before live eBay publication.

See [eBay Seller Resources and Live Listing Validation](docs/EBAY_LIVE_METADATA.md) for policy/location synchronization, category item specifics, OAuth scope requirements, and the live validation workflow.

See [eBay Image Staging and Inventory Preparation](docs/EBAY_INVENTORY_PREPARATION.md) for Media API image uploads, worker jobs, immutable payload previews, compatibility JSON, and the boundary before Inventory API writes.

See [Production Release Checklist](docs/PRODUCTION_RELEASE.md) before deploying. It contains the Railway service commands, required variables, health checks, smoke test, rollback process, and current release limitations.

## API

- `POST /api/search` — body: `{ "oem": "8K0615301M", "marketplace": "EBAY_US", "condition": "NEW" }` (`condition`: `ANY`, `NEW`, or `USED`)
- `GET /api/listings/:id`
- `GET /api/analytics/:oem`
- `GET /api/history/:oem`
- `GET /api/session` â€” authenticated user, organization, and role context
- `POST /api/auth/refresh` â€” rotate refresh cookie and return a new access token
- `POST /api/auth/logout` â€” revoke the current refresh session
- `POST /api/media/upload-url` â€” create an organization-scoped signed image upload
- `POST /api/media/uploads/confirm` â€” verify an upload and create its media record
- `GET /api/media/:id/download-url` â€” create a short-lived private download URL
- `GET /api/imports/template` â€” download the current catalog intake CSV
- `GET /api/imports/template/schema` â€” retrieve the machine-readable field contract
- `POST /api/imports/validate` â€” store, parse, normalize, and stage a CSV/XLSX import
- `POST /api/imports/:id/images` â€” validate, store, and map an image ZIP to staged SKUs
- `GET /api/imports/:id/preview` - preview staged rows, issues, image matches, and confirmation readiness
- `PATCH /api/imports/:id/media-matches/:matchId` - assign or reorder a staged image
- `DELETE /api/imports/:id/media-matches/:matchId` - discard an irrelevant image from the import
- `POST /api/imports/:id/confirm` - atomically create catalog, vehicle, inventory, number, and media records
- `GET /api/parts` - search and filter the organization catalog
- `GET /api/parts/export` - export up to 5,000 filtered parts as CSV
- `GET /api/parts/:id` - retrieve a complete editable catalog record
- `PATCH /api/parts/:id` - update core part and inventory fields
- `PATCH /api/parts/bulk-status` - update the status of up to 500 selected parts
- `POST /api/pricing/jobs` - create a tenant-scoped pricing job for up to 25 selected parts
- `GET /api/pricing/jobs` - list recent pricing jobs for the organization
- `GET /api/pricing/jobs/:id` - poll job progress and inspect competitor listing snapshots
- `POST /api/fitment/jobs` - discover scored eBay catalog fitment candidates for up to 10 selected parts
- `GET /api/fitment/jobs` / `GET /api/fitment/jobs/:id` - list and poll tenant-scoped fitment jobs
- `POST /api/fitment/items/:id/approve` - approve an ePID candidate and import its compatibility applications
- `GET /api/ebay/connection` - retrieve the organization's sanitized eBay seller connection status
- `POST /api/ebay/connection/authorize` - start owner/admin eBay seller consent
- `GET /api/ebay/oauth/callback` - validate eBay consent and store encrypted seller credentials
- `DELETE /api/ebay/connection` - disconnect the organization and delete local token material
- `POST /api/listing-drafts` - create idempotent, tenant-scoped listing drafts for selected catalog parts
- `GET /api/listing-drafts` / `GET /api/listing-drafts/:id` - list drafts or retrieve one with version history
- `PATCH /api/listing-drafts/:id` - edit a draft using optimistic concurrency
- `POST /api/listing-drafts/:id/validate` - rerun publication-readiness checks without publishing
- `GET /api/ebay/resources` / `POST /api/ebay/resources/sync` - read or refresh seller policies and inventory locations
- `POST /api/ebay/categories/:categoryId/aspects/refresh` - retrieve and cache live category item specifics
- `POST /api/listing-drafts/:id/validate-live` - validate a versioned draft against live eBay metadata
- `POST /api/listing-drafts/:id/prepare-inventory` - queue approved-image staging and an immutable Inventory API payload preview
- `POST /api/inventory-preparations/:id/apply` - explicitly queue the non-publishing eBay inventory and compatibility write
- `GET /api/ebay/inventory-sync-jobs/:id` - inspect a durable eBay inventory sync job
- `POST /api/ebay/inventory-sync-jobs/:id/offer` - prepare an unpublished offer and expected fee preview
- `POST /api/ebay/offers/:id/publish` - explicitly approve and queue live publication
- `GET /api/ebay/offer-jobs/:id` - inspect offer preparation or publication
- `GET /api/inventory-preparation-jobs/:id` - poll the worker job and retrieve its completed preparation
- `GET /api/listing-drafts/:id/inventory-preparation` - retrieve the latest preparation for a draft
- `GET /health`
- `GET /health/live`
- `GET /health/ready`
