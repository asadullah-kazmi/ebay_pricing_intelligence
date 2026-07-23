# Review-first eBay fitment jobs

Step 12 adds tenant-scoped fitment discovery and approval to the catalog workspace. Users with `OWNER`, `ADMIN`, `MANAGER`, or `CATALOG_OPERATOR` roles can select up to 10 non-archived parts per job.

## Why approval is required

An automotive part number is not guaranteed to identify exactly one eBay catalog product. The worker uses eBay Taxonomy category suggestions and Catalog product search to discover ePIDs, then scores evidence from exact part-number aspects, brand, and title. It does not assign vehicle compatibility during discovery.

The catalog UI displays every credible candidate with its ePID, score, and matching evidence. A user must approve one candidate. Only then does the API call eBay Metadata `get_product_compatibilities` and persist the returned applications, selected candidate, and approver-visible evidence. A metadata version is retained when eBay supplies one.

## API

```text
POST /api/fitment/jobs
{
  "partIds": ["part-id"],
  "marketplace": "EBAY_US"
}

GET /api/fitment/jobs?limit=10
GET /api/fitment/jobs/:jobId

POST /api/fitment/items/:itemId/approve
{
  "candidateId": "candidate-id"
}
```

Discovery returns HTTP `202`; the web client polls while the job is `QUEUED` or `RUNNING`. Candidate approval returns the updated job. All reads and writes are restricted to the authenticated organization.

## Statuses

- Job: `QUEUED`, `RUNNING`, `REVIEW_REQUIRED`, `COMPLETED`, `PARTIAL`, `FAILED`.
- Item: `QUEUED`, `RUNNING`, `REVIEW_REQUIRED`, `NO_CANDIDATE`, `APPROVED`, `FAILED`.

`NO_CANDIDATE` is a safe outcome, not an automatic match. Step 28 lets the operator open the part's fitment editor and create a reviewed manual or donor-VIN application. See [Manual Fitment and Donor-VIN Fallback](MANUAL_FITMENT.md).

## Runtime and deployment

- Interrupted `QUEUED`/`RUNNING` jobs are recovered on API startup.
- Work is sequential and in-process. Run one API replica until this worker is moved to a durable queue with distributed claiming.
- Production requires enabled eBay production credentials. Sandbox catalog coverage is limited; use demo mode for deterministic local workflow tests and production for real catalog data.
- Compatibility applications are stored as normalized property maps with a SHA-256 fingerprint so duplicate rows are removed.
- The first 100 applications are returned in job detail for UI preview; the total count is retained on the item.

## Known boundaries

- Approved applications are catalog enrichment records; the later inventory workflow writes them to eBay.
- Automatic eBay catalog applications remain immutable, but Step 28 can replace them with an audited manual application.
- Category suggestions and catalog coverage vary by marketplace and product family.
