# Import review and confirmation

Step 8 is the mandatory review gate between spreadsheet/image staging and the organization catalog. All endpoints require an access token and are scoped to the organization in that token.

## Preview

```http
GET /api/imports/{batchId}/preview?page=1&pageSize=50
```

The response contains:

- Batch totals, validation issues, image issues, and current status.
- `readiness.canConfirm` plus machine-readable blockers.
- Paginated staged rows with normalized data and assigned images.
- Up to 100 currently unassigned images and their total count.
- Media asset IDs that the UI can exchange for short-lived URLs through `GET /api/media/{id}/download-url`.

The maximum preview page size is 100 so a 5,000-row import does not produce an unbounded API response.

## Correct an image assignment

Assign an image to a valid row and optionally change its relative ordering:

```http
PATCH /api/imports/{batchId}/media-matches/{matchId}
Content-Type: application/json

{
  "importRowId": "staged-row-id",
  "displayOrder": 2
}
```

Set `importRowId` to `null` to unassign it. A corrected assignment is recorded with the `MANUAL` strategy. The API recalculates all image counters and confirmation readiness in the same transaction.

If an archive contains an irrelevant image, remove only its staging match:

```http
DELETE /api/imports/{batchId}/media-matches/{matchId}
```

This does not delete the underlying private media asset because it may be content-deduplicated and referenced elsewhere.

## Readiness rules

Confirmation is blocked when:

- The spreadsheet failed or has no rows.
- Any spreadsheet row is invalid. Correct the source sheet and upload it as a new import.
- Any image remains unmatched or requires review.
- Another confirmation is in progress.

Warnings do not block confirmation. An image ZIP is optional; parts without assigned images enter the catalog with `NEEDS_IMAGES` status.

## Confirm

```http
POST /api/imports/{batchId}/confirm
```

Confirmation rechecks SKU uniqueness and normalized row data, locks the batch, and creates the following in one PostgreSQL transaction:

- Donor vehicles, deduplicated by organization and VIN.
- Parts and primary/interchange part numbers.
- Inventory, warehouse, bin, dimensions, and weight data.
- Approved part-media links in deterministic display order.
- Links from every staging row to its created part.

Parts with images receive `READY_FOR_ENRICHMENT`; parts without images receive `NEEDS_IMAGES`. The batch becomes `COMPLETED` only after every row succeeds. A database error rolls back the entire catalog import. Calling confirm again after success returns the existing completion summary instead of creating duplicates.
