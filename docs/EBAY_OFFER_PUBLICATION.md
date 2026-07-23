# Step 21 — Offer preparation, fee review, and publication

Step 21 converts a completed Step 20 inventory sync into an unpublished eBay offer, retrieves expected listing fees, and then requires a separate human approval before publishing it.

## Two independent commands

### Prepare offer and fees

`POST /api/ebay/inventory-sync-jobs/:id/offer` creates or fully replaces an unpublished fixed-price, Good 'Til Cancelled offer. It uses the current category, quantity, price, business policies, location, marketplace, and SKU. The worker then calls `getListingFees` and persists the complete response, calculated fee total, currency, warnings, and remote offer ID.

This command never publishes.

The preview contains expected **listing-time fees** returned by this Inventory API method. It is not an estimate of final-value fees, payment fees, taxes, promoted-listing charges, international charges, or other costs that can depend on a later sale.

### Approve and publish

`POST /api/ebay/offers/:id/publish` requires:

- `{ "confirmPublish": true, "confirmation": "PUBLISH" }`;
- a unique `Idempotency-Key`;
- a publisher-capable role;
- a current `FEES_READY` offer;
- an unchanged live-validated draft; and
- the matching completed inventory sync.

The approving user and timestamp are persisted before the durable worker job is queued. A successful response from eBay supplies the listing ID, which is stored with the publication timestamp and emitted as `listing.published`.

## Network safety

Offer creation reconciles existing offers by SKU and marketplace before creating. If a create response is lost, it reconciles again before marking the job failed. Publication checks the remote offer for an existing listing ID before publishing and repeats that check after an ambiguous error. This prevents ordinary worker retries from intentionally creating another offer or listing.

## Not included

- Revising a published listing.
- Withdrawing or ending a listing.
- Bulk approval.
- Cost-floor and margin override policy.
- Reconciliation of local records with externally edited eBay listings.

## Deployment

Apply migration `20260723070000_add_offer_publication`, then deploy API, worker, and web from one commit. No new environment variables are required. Test first with a dedicated low-risk SKU and verify its business policies, location address, category, price, quantity, images, condition, and fitment.
