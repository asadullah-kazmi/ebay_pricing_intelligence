# Bulk pricing jobs

Step 11 adds organization-scoped competitor pricing to the catalog workspace. Users with `OWNER`, `ADMIN`, `MANAGER`, or `PRICING_OPERATOR` roles can select up to 25 non-archived parts and start an eBay Browse API pricing job without holding the browser request open.

## User workflow

1. Open `/catalog` and select parts across one or more result pages.
2. Choose eBay US, UK, or Germany.
3. Choose `Match each part`, `Any condition`, `New only`, or `Used only`.
4. Select **Price selected**.
5. The workspace polls the job and displays progress per part.
6. Completed parts show exact competitor count, lowest landed price, median, recommended price, and expandable competitor evidence.
7. Each evidence row contains the eBay listing ID, seller, condition, item price plus shipping, and an outbound eBay link.

`Match each part` searches new competitors for a new catalog part and used competitors for a used catalog part. The recommended price remains the existing market formula of 98% of the competitor median. It is not yet a publishable or approved price proposal.

## Exact-match rules

The Browse search result is only retained when its structured item specifics contain the complete normalized query in one of these fields:

- Manufacturer Part Number
- MPN
- OE/OEM Part Number
- Interchange Part Number

Punctuation and casing are ignored, but partial values are rejected. Sellers configured in `OWN_SELLERS` are excluded case-insensitively. A title containing the part number does not by itself qualify a competitor.

## API

Create a job:

```http
POST /api/pricing/jobs
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "partIds": ["part-id-1", "part-id-2"],
  "marketplace": "EBAY_US",
  "conditionMode": "MATCH_PART"
}
```

The response is HTTP 202. An organization can have one queued or running job at a time.

```http
GET /api/pricing/jobs?limit=10
GET /api/pricing/jobs/:jobId
```

Job statuses are `QUEUED`, `RUNNING`, `COMPLETED`, `PARTIAL`, or `FAILED`. Item statuses are `QUEUED`, `RUNNING`, `COMPLETED`, `NO_MATCHES`, or `FAILED`. A failed item does not discard successful evidence for other items.

## Persistence and deployment

Migration `20260720040000_add_bulk_pricing_jobs` creates:

- `PricingJob` for tenant, creator, parameters, counters, and lifecycle.
- `PricingJobItem` for the part-number snapshot, condition, analytics, and item error.
- `CompetitorListingSnapshot` for immutable listing evidence captured by that job item.

Migration `20260720041000_enforce_single_active_pricing_job` adds a database-level partial unique index so simultaneous requests cannot create multiple active jobs for one organization.

Run migrations before deploying the API:

```powershell
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

The current worker is in-process and handles items sequentially. On API startup, queued jobs and items interrupted while running are safely returned to the queue and resumed. Keep one Railway API replica and jobs to 25 parts. A later milestone must move execution to Redis-backed workers and add quota-aware delayed retries before increasing volume.
