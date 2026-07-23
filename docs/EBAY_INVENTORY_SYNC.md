# Step 20 — Controlled eBay inventory sync

Step 20 writes a current, live-validated preparation to the connected seller account. It creates or replaces the SKU through the Inventory API and then replaces its product compatibility. It does **not** create an offer, publish an offer, or make a listing visible to buyers.

## Safety and correctness

- Supported conditions come from eBay `getItemConditionPolicies`; the operator selects an exact Inventory API condition.
- A preparation is immutable and tied to a listing-draft version and SHA-256 payload hash.
- The API requires `{ "confirmInventoryWrite": true }`, an `Idempotency-Key`, and a publisher-capable organization role.
- The worker rejects a stale preparation when the draft changed or lost live readiness.
- Replace-style inventory and compatibility `PUT` operations make same-payload retries safe. With no approved fitment, stale remote compatibility is removed.
- The job records the inventory and compatibility timestamps and emits an outbox event only after both succeed.

## Workflow

1. Live validate the category, select a supported eBay condition, save, and validate again.
2. Queue `POST /api/listing-drafts/:id/prepare-inventory`.
3. Review the immutable payload preview.
4. Confirm `POST /api/inventory-preparations/:id/apply` with an `Idempotency-Key`.
5. Poll `GET /api/ebay/inventory-sync-jobs/:id`.

A completed job means the SKU exists in seller inventory. It is not purchasable until a later step creates and publishes an offer.

## Deployment

Apply migration `20260723060000_add_inventory_sync`, then deploy API, worker, and web from the same commit. No new environment variables are required. Seller OAuth must include `sell.inventory`.
