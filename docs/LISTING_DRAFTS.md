# Listing drafts and publication readiness

Step 17 adds the editable preparation layer between catalog data and future eBay publication. It does not create, revise, or publish an eBay listing.

## Workflow

1. Select up to 25 catalog parts and choose a marketplace.
2. Choose **Create drafts**.
3. The API creates or refreshes one organization-scoped draft per part and marketplace.
4. Open a draft to edit its title, description, category, condition, price, quantity, business-policy IDs, and merchant location.
5. Review blockers and warnings. Save revalidates the draft and records a new immutable version.

Draft creation uses the part number, description, latest matching pricing result, inventory quantity, approved images, approved fitment, and connected seller state already stored in PartPulse. Repeating the create command is protected by an `Idempotency-Key`.

## Readiness rules

A draft is `READY` only when it has:

- an active eBay seller connection;
- a non-empty title no longer than 80 characters;
- a description and eBay category ID;
- a positive price, supported currency, and non-negative quantity;
- at least one approved, ready image;
- payment, return, and shipping policy IDs;
- a merchant location key; and
- an MPN item specific.

Missing approved fitment is currently a warning because some parts or categories do not require vehicle compatibility. Until Step 18 live validation succeeds, eBay category/aspect verification is shown as pending. Step 18 replaces that warning with concrete required/recommended aspect and seller-resource results.

## Version safety

Every edit supplies the version the editor originally loaded. If another request has already changed the draft, the API rejects the stale edit instead of silently overwriting it. Each successful edit increments the version and stores an immutable JSON snapshot with the actor and optional reason.

Draft creation and updates also write transactional outbox events:

- `listing.draft.created`
- `listing.draft.updated`

These events provide the handoff point for a future publishing service.

## API

- `POST /api/listing-drafts` creates drafts for selected part IDs.
- `GET /api/listing-drafts` lists recent drafts with marketplace/status filters.
- `GET /api/listing-drafts/:id` retrieves an editable draft and version history.
- `PATCH /api/listing-drafts/:id` applies an optimistic-concurrency edit.
- `POST /api/listing-drafts/:id/validate` reruns readiness validation.

All routes require a valid tenant access token. Creation, editing, and validation require an owner, admin, manager, or publisher role.

## Deployment

Apply the committed Prisma migrations before deploying the API:

```text
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Deploy the API before the web application so the new catalog controls do not call missing endpoints.

## Not yet included

- Inventory API item/offer writes;
- publish, revise, withdraw, or listing-ID persistence; and
- bulk publication jobs.

Those operations belong in the next publication integration steps and must consume only validated, explicitly selected drafts.
