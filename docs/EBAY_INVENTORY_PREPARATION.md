# eBay image staging and inventory preparation

Step 19 prepares a live-validated listing draft for future Inventory API writes. The background worker uploads approved images to eBay Picture Services through the current Media API, builds inventory-item and product-compatibility JSON, and stores an immutable payload preview for the exact draft version.

This step does not call `createOrReplaceInventoryItem`, `createOrReplaceProductCompatibility`, create an offer, or publish a listing.

Step 20 consumes the preview only after the operator chooses an exact condition returned by eBay's live category condition policy. The generic catalog condition is never silently converted to a used-condition grade.

## Why image staging uses the worker

A part can have many approved images and each Media API upload is an external operation. `POST /api/listing-drafts/:id/prepare-inventory` therefore creates a durable job and returns HTTP 202. The worker:

1. claims the job with a renewable database lease;
2. reads approved images from private object storage in display order;
3. uploads each image with Media API `createImageFromFile`;
4. stores the returned eBay image ID, HTTPS EPS URL, maximum-dimension URL, and expiry;
5. reuses a checksum-matching image while it has more than three days before expiry;
6. creates the immutable payload preparation and outbox event; and
7. marks the job completed or stores an actionable failure.

The legacy Trading API picture-upload operation is not used.

## Preconditions

The draft must:

- be the version supplied by the caller;
- have `READY` status;
- have a current `liveValidatedAt` value;
- have inventory data;
- have at least one approved `READY` image; and
- use an SKU no longer than 50 characters.

Any draft edit clears its live-validation timestamp and requires live validation again before another preparation.

## Generated inventory payload

The preview contains:

- ship-to-home quantity;
- Inventory API condition;
- used-item condition description;
- title and description;
- item-specific aspects;
- ordered EPS image URLs; and
- package weight and dimensions when complete.

The current catalog condition model only distinguishes `NEW` and `USED`. `NEW` maps to `NEW`; `USED` is staged as `USED_GOOD` with an explicit warning. Step 20 must verify the final condition through eBay category condition policies before writing the inventory item.

At most the first 24 approved images are staged. Extra images create a warning rather than silently changing display order.

## Generated compatibility payload

Approved fitment applications for the listing's exact marketplace become:

```json
{
  "compatibleProducts": [
    {
      "compatibilityProperties": [
        { "name": "Year", "value": "2020" },
        { "name": "Make", "value": "BMW" },
        { "name": "Model", "value": "X3" }
      ]
    }
  ]
}
```

No approved fitment produces a warning and a null compatibility payload.
Pending, rejected, superseded, or other-marketplace applications are excluded.

## API

- `POST /api/listing-drafts/:id/prepare-inventory` queues preparation. Body: `{ "expectedVersion": 4 }`. Send a unique `Idempotency-Key`.
- `GET /api/inventory-preparation-jobs/:id` returns queue status, attempts, failure, and the completed preparation.
- `GET /api/listing-drafts/:id/inventory-preparation` returns the latest stored preparation for a draft.

The preparation stores a SHA-256 hash over the SKU and generated payloads. A future publishing command must use a preparation whose `draftVersion` still matches the selected draft.

## Deployment

Apply migrations once through the API pre-deploy command, then deploy the API, worker, and web application:

```text
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

The API and worker require the existing database, eBay application credentials, and object-storage variables. No new environment variables are introduced.

Production must use `JOB_EXECUTION_MODE=worker` on both API and worker services. Do not create a public Railway domain for the worker.

## Still excluded

- category-specific final condition selection;
- Inventory API writes;
- compatibility writes;
- offer creation;
- fee preview;
- publish, revise, withdraw, and listing-ID persistence.
