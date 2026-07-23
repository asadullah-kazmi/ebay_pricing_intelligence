# Step 22 — Published listing operations and reconciliation

Step 22 manages listings created by Step 21 without bypassing the draft, inventory, compatibility, or approval workflow.

## Revision

A live listing can be revised only after:

1. editing and live-validating a newer listing-draft version;
2. preparing that version's images and immutable inventory payload;
3. completing its inventory and compatibility sync; and
4. explicitly approving the live revision.

Because the SKU already belongs to a published offer, the preceding inventory/compatibility sync is itself an external write and may affect data used by the active listing. The UI identifies that impact before confirmation; operators should proceed directly through revision after the sync rather than leaving the two states separated.

`POST /api/ebay/offers/:id/revise` requires the completed sync job, `{ "confirmRevision": true, "confirmation": "REVISE" }`, and an `Idempotency-Key`. SKU and marketplace cannot change through this revision path.

The worker verifies that the remote listing is still active, then fully replaces the published offer. eBay applies a successful `updateOffer` to the live listing immediately, so the UI displays a strong confirmation. The resulting remote snapshot, revision count, timestamp, target draft version, and any drift are persisted.

## Withdrawal

`POST /api/ebay/offers/:id/withdraw` requires `{ "confirmWithdraw": true, "confirmation": "WITHDRAW" }` and an `Idempotency-Key`. The worker first checks remote state, withdraws only an active/out-of-stock listing, and checks remote state again.

Withdrawal ends the listing but preserves its eBay offer as unpublished. Step 22 does not relist it.

## Reconciliation

`POST /api/ebay/offers/:id/reconcile` queues a remote `getOffer` read and compares the following controlled fields:

- SKU and marketplace;
- category and available quantity;
- merchant location;
- payment, return, and fulfillment policies; and
- price currency and value.

The raw remote snapshot, listing status, listing ID, check time, and field-level differences are stored. Active listings with differences become `DRIFTED`; inactive or ended listings become `WITHDRAWN`. Reconciliation never changes eBay.

## Durable evidence

Revision, withdrawal, and reconciliation each have a tenant-scoped leased job containing the requesting user, action, target version, requested payload, remote response, drift result, attempts, and errors. Outbox events include `listing.revised`, `listing.withdrawn`, `listing.reconciled`, and `listing.reconciliation.drifted`.

## Deployment

Apply migration `20260723080000_add_listing_operations`, then deploy API, worker, and web from the same commit. No new environment variables are required.
