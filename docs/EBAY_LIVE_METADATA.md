# eBay seller resources and live listing validation

Step 18 connects listing drafts to the live eBay preparation APIs. It retrieves the connected seller's business policies and inventory locations, retrieves category item-specific requirements, and validates a draft against those results. It does not create an inventory item, offer, or listing.

## Prerequisites

The organization must have an active eBay seller connection. The existing authorization must include:

```text
https://api.ebay.com/oauth/api_scope/sell.account
https://api.ebay.com/oauth/api_scope/sell.inventory
```

These scopes are already part of PartPulse's default `EBAY_OAUTH_SCOPES`. If the connected account was authorized with an older or narrower scope list, disconnect and reconnect it after correcting the Railway variable.

The seller must create applicable payment, return, and fulfillment policies in eBay and enable at least one Inventory API location. PartPulse only offers policies applicable to parts and accessories (`ALL_EXCLUDING_MOTORS_VEHICLES`) and enabled inventory locations.

## Data flow

1. `POST /api/ebay/resources/sync` uses the seller access token to retrieve payment, return, and fulfillment policies plus inventory locations.
2. The API replaces the organization's cached snapshot for that marketplace only after every provider request succeeds.
3. `POST /api/listing-drafts/:id/validate-live` refreshes those resources and retrieves the selected leaf category's item-specific metadata.
4. The API validates selected IDs, required/recommended aspects, selection-only values, and single/multiple cardinality.
5. It records `liveValidatedAt`, increments the draft version, stores an immutable snapshot, and emits `listing.draft.live_validated`.

For US automotive categories, taxonomy lookup uses the eBay Motors US category tree. Business policies and the eventual offer continue to use the seller's `EBAY_US` marketplace.

## API

- `GET /api/ebay/resources?marketplace=EBAY_US` returns the last cached seller-resource snapshot.
- `POST /api/ebay/resources/sync` refreshes policies and locations. Body: `{ "marketplace": "EBAY_US" }`.
- `POST /api/ebay/categories/:categoryId/aspects/refresh` refreshes one category. Body: `{ "marketplace": "EBAY_US" }`.
- `POST /api/listing-drafts/:id/validate-live` refreshes both sources and validates the draft. Body: `{ "expectedVersion": 3 }`.

All operations are tenant scoped. Refresh and live-validation operations require an owner, admin, manager, or publisher role.

## Editor workflow

1. Save the draft with a leaf category ID.
2. Open the draft and choose **Validate with eBay**.
3. Select an available business policy and inventory location.
4. Complete the category-specific fields now shown in the editor.
5. Save, then run **Validate with eBay** again for the final live check.

Provider failures do not erase the previous cache. A draft cannot be considered live validated merely because older cached metadata exists; the explicit validation action records the successful provider check time.

## Deployment

Apply migrations before deploying the API:

```text
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Deploy in this order:

1. database migration;
2. API;
3. web application.

No additional environment variables are introduced by Step 18.

## Still excluded

- creating missing eBay policies or locations;
- category suggestion and leaf-category selection UI;
- associating staged images through an Inventory API write;
- Inventory API inventory-item and offer operations;
- publish, revise, withdraw, and listing-ID persistence.
