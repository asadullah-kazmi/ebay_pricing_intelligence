# Catalog Operations

Step 29 turns the catalog into an operator workspace for finding, grouping, and changing inventory at scale.

## Advanced filters

`GET /api/parts` supports the original text, status, condition, image, warehouse, date, and sort filters plus:

- `minQuantity` / `maxQuantity`
- `minCost` / `maxCost`
- `hasPricing` for an approved or overridden governed price
- `hasFitment` for at least one approved compatibility application
- `hasDraft` and `draftStatus`
- `marketplace`
- `hasShippingPolicy`

All predicates are applied together and remain organization-scoped. CSV export uses the same filter contract.

## Personal saved views

Saved views belong to the authenticated user and organization. A user cannot read, replace, or delete another user's view. Names are unique per user within an organization, and selecting a default view clears that user's previous default.

- `GET /api/catalog/saved-views`
- `POST /api/catalog/saved-views`
- `PATCH /api/catalog/saved-views/:id`
- `DELETE /api/catalog/saved-views/:id`

Only validated filter fields are stored. Access tokens and tenant identifiers are never stored in the view JSON.

## Atomic bulk catalog editing

`PATCH /api/parts/bulk-edit` accepts up to 500 unique part IDs and one or more changes to status, condition, placement, quantity, warehouse, or bin. The operation:

1. verifies every part belongs to the organization;
2. resolves the warehouse and bin;
3. updates all selected records in one database transaction;
4. blocks and versions affected listing drafts for review;
5. writes one organization audit event.

If validation or any write fails, none of the selected parts are changed.

## Bulk eBay policy assignment

`POST /api/listing-drafts/bulk-policies` assigns payment, return, fulfillment, and merchant-location values to the selected parts' drafts for one marketplace.

The endpoint requires a draft for every selected part, validates every value against the organization's current enabled eBay resource cache, recalculates readiness, increments each draft version, clears stale live validation, and emits an outbox event. The database updates are atomic.

Sync seller resources before assignment whenever the seller changes policies or locations in eBay.

## Deployment

Apply migration `20260724120000_add_catalog_saved_views` before deploying the Step 29 API and web services.

Pilot with a small selection and verify:

1. advanced filters and CSV export return the same part set;
2. a saved view remains private to its creator;
3. an invalid ID causes the complete bulk edit to roll back;
4. a catalog edit blocks an existing listing draft;
5. only enabled policies for the selected marketplace can be assigned.
