# Step 28 — Manual fitment and donor-VIN fallback

Step 28 provides the reviewed fallback for parts that eBay cannot resolve to a
confident catalog product. Automatic ePID discovery remains the preferred source,
but authorized users can now create, revise, approve, reject, replace, or
supersede manual compatibility applications.

## Sources and provenance

Every application records one source:

- `EBAY_CATALOG` — applications returned for an approved eBay catalog product;
- `MANUAL` — applications entered from reviewed external evidence; or
- `DONOR_VEHICLE` — an application initialized from the part's VIN-linked donor
  vehicle.

Donor fallback copies available Year, Make, Model, Trim, and Engine fields and
stores the donor vehicle ID and VIN as source evidence. It does not claim that
every part from the vehicle fits every related vehicle. A person must review and
approve the application.

Manual and donor applications require Year, Make, and Model. The API supports up
to 50 named properties so category-specific qualifiers can be added even though
the initial UI emphasizes the standard automotive fields.

## Lifecycle

Applications use:

- `PENDING` — awaiting a decision;
- `APPROVED` — included in the eBay compatibility payload;
- `REJECTED` — reviewed but not accepted; and
- `SUPERSEDED` — previously approved but replaced or removed.

Editing a manual or donor application creates a revision snapshot and returns it
to `PENDING`. eBay catalog applications are immutable; create a reviewed manual
replacement instead. Approvers may add an application to the current set or
replace the entire approved set for that part and marketplace. Only owners,
admins, and managers can replace or remove approved compatibility.

## Publication safety

Inventory preparation uses only `APPROVED` applications for the exact listing
marketplace. Whenever approved compatibility changes, every affected listing
draft:

1. receives a new version;
2. becomes `BLOCKED`;
3. loses its live-validation timestamp;
4. records a `FITMENT_REVALIDATION_REQUIRED` issue and immutable version
   snapshot; and
5. emits an outbox event.

This prevents a preparation created from an older compatibility set from being
silently reused. Run live validation and create a new inventory preparation
before publication or revision.

## API

```http
GET  /api/parts/:partId/fitment?marketplace=EBAY_US
POST /api/parts/:partId/fitment
PATCH /api/fitment/applications/:applicationId
POST /api/fitment/applications/:applicationId/decision
```

Create a donor application:

```json
{
  "marketplace": "EBAY_US",
  "source": "DONOR_VEHICLE",
  "properties": {
    "Trim": "LT"
  },
  "notes": "Reviewed against donor VIN and OEM catalog"
}
```

Approve and replace older compatibility:

```json
{
  "action": "APPROVE",
  "reason": "Verified against OEM application data",
  "replaceExisting": true
}
```

## Deployment

Apply `20260724110000_add_manual_fitment`, then deploy API, worker, and web from
the same commit:

```powershell
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

The migration preserves existing eBay-derived applications as approved and
backfills their marketplace from the original fitment job.

