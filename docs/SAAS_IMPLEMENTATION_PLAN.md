# Automotive Catalog and eBay Publishing SaaS

**Implementation plan — Version 1.0**  
**Prepared:** July 19, 2026

## 1. Executive summary

This project will evolve the existing PartPulse competitor-pricing MVP into a multi-tenant SaaS product for automotive dismantlers, recyclers, parts sellers, and other companies that prepare and publish parts inventory to eBay.

The core workflow is:

1. A company uploads a spreadsheet containing VINs, SKUs, part numbers, and inventory information.
2. The company uploads part photographs using a defined folder and filename mapping structure.
3. The system validates the import, associates images with parts, and creates editable catalog drafts.
4. Users select drafts and run eBay competitor-price analysis.
5. Users select drafts and request fitment from eBay catalog/compatibility data.
6. Users review and edit titles, images, specifics, fitment, pricing, quantity, and shipping.
7. Users publish approved drafts to a connected eBay seller account.
8. The system synchronizes listing state, price, and quantity and provides complete administrative oversight.

The product is feasible. Spreadsheet intake, deterministic image mapping, catalog editing, Browse API pricing, and eBay publication all have high feasibility. Fitment is feasible with an important limitation: eBay can return compatibility for products it recognizes in its catalog, but an arbitrary part number is not guaranteed to resolve to an eBay catalog product. The product must therefore support both automatic catalog-based fitment and a user-reviewed fallback.

## 2. Scope and product boundaries

### 2.1 In scope

- Multi-company SaaS accounts and role-based access.
- Spreadsheet and CSV inventory imports.
- ZIP or multi-file image uploads with deterministic mapping.
- Editable automotive parts catalog.
- Bulk competitor pricing through eBay Browse API.
- eBay catalog-product discovery and compatibility retrieval.
- Manual/user-reviewed compatibility fallback.
- eBay category and item-specific validation.
- Listing titles and descriptions generated from verified data.
- Image processing and eBay Picture Services upload.
- Shipping, payment, return, and location policy mapping.
- Bulk draft validation and eBay publication.
- Published listing revisions, withdrawal, price, and quantity synchronization.
- Organization dashboards and a platform administration panel.
- Audit logs, background jobs, notifications, and operational monitoring.

### 2.2 Out of scope for the first release

- Automated extraction from Partslink, PartSouq, or other catalog websites.
- Inferring a part number purely from an unlabeled photograph.
- Claiming broad vehicle interchange based only on the donor VIN.
- Publishing without human approval.
- Multiple marketplaces in the first pilot.
- Auctions, variations, kits, and assemblies in the first pilot.
- Automated supplier purchasing and dropshipping in the first pilot.
- Full accounting or ERP functionality.

### 2.3 First-pilot constraints

- One platform administrator.
- One pilot customer organization.
- One production eBay US Motors seller account.
- Used fixed-price automotive parts.
- One warehouse/inventory location.
- One spreadsheet template.
- Folder/filename-based image mapping.
- Human review before publishing.
- 100–500 imported parts.
- Initial controlled publication of 10–25 listings.

## 3. Feasibility assessment

| Capability | Feasibility | Conditions and limitations |
|---|---:|---|
| Spreadsheet inventory import | High | A strict, versioned template is required. |
| Deterministic image assignment | High | Images must include SKU/image-group references in folder or filenames. |
| OCR-assisted image assignment | Medium | Suggestions require confidence scores and user review. |
| Arbitrary photo-to-part recognition | Low | It is not safe enough for unattended publication. |
| Editable parts catalog | High | Standard multi-tenant CRUD and workflow implementation. |
| Competitor pricing | High | The current application already proves the core Browse API path. |
| eBay product fitment lookup | Medium–high | Works when the part resolves to an eBay catalog product with compatibility. |
| Fitment for unmatched part numbers | Medium | Requires source-VIN vehicle mapping and user review. |
| Broad interchange discovery | Low without another data source | One donor VIN cannot prove every compatible vehicle. |
| Item-specific/category validation | High | Category selection must happen before validation. |
| Image processing/EPS upload | High | Actual-item images and acceptable formats are required. |
| eBay publication | High | Requires seller OAuth, business policies, and valid drafts. |
| Multi-company SaaS | High | Strong tenant isolation and encrypted seller tokens are mandatory. |
| Fully automatic publishing | Medium after maturity | Start with approval gates and measured automation. |

## 4. Important fitment decision

### 4.1 What eBay can provide

The current eBay Sell Metadata API provides `get_product_compatibilities`. It accepts a recognized product identifier such as ePID, UPC, EAN, or product ID and returns the compatibility details attached to that product.

The expected automatic path is:

```text
Part number + brand + category
        ↓
Search eBay Catalog API
        ↓
Candidate eBay catalog products
        ↓
User/rules confirm the correct product
        ↓
Sell Metadata get_product_compatibilities
        ↓
Store compatibility applications on the draft
```

An MPN can be used as a catalog-search keyword and may contribute to a catalog match, but it is not guaranteed that every MPN has an eBay product or fitment record. The system must never choose a weak catalog match based only on similar wording.

### 4.2 Fallback when no product is recognized

```text
Donor VIN
   ↓
VIN decoder produces Year/Make/Model/Trim/Engine
   ↓
Select eBay compatibility-enabled leaf category
   ↓
Query valid eBay compatibility property names and values
   ↓
Map decoded vehicle to eBay values
   ↓
User confirms the source-vehicle application
```

This proves only the donor/source vehicle application. Additional years, trims, engines, or models must come from an eBay catalog product, another licensed source, or explicit user selection.

### 4.3 APIs to use

- Commerce Catalog API for current product search.
- Sell Metadata API `get_product_compatibilities` for catalog-product fitment.
- Sell Metadata or Taxonomy compatibility-property APIs for valid Year/Make/Model/Trim/Engine values.
- Sell Metadata `getAutomotivePartsCompatibilityPolicies` for supported categories and limits.
- Inventory API `createOrReplaceProductCompatibility` to attach approved applications to the SKU.

Do not build new functionality on the legacy Product API or Product Metadata API. eBay states that those APIs are being decommissioned in July/August 2026 and directs users to the Catalog and Metadata APIs.

## 5. Image mapping contract

Automatic image assignment will be driven by structure, not visual guessing.

### 5.1 Preferred ZIP structure

```text
upload.zip
├── VIN-1GNEK13Z43R000001
│   ├── SKU-001
│   │   ├── 01.jpg
│   │   ├── 02.jpg
│   │   └── 03.jpg
│   └── SKU-002
│       ├── 01.jpg
│       └── 02.jpg
└── VIN-WVWZZZ1JZXW000001
    └── SKU-003
        ├── 01.jpg
        └── 02.jpg
```

### 5.2 Supported alternatives

- Flat files named `SKU-001_01.jpg`, `SKU-001_02.jpg`.
- An `ImageGroup` spreadsheet column matching a folder name.
- A separate manifest containing `filename,sku,displayOrder`.

### 5.3 Assignment priority

1. Exact manifest mapping.
2. Exact SKU folder mapping.
3. Exact image-group folder mapping.
4. Exact SKU filename prefix.
5. OCR/barcode suggestion.
6. Manual assignment.

Low-confidence OCR results must remain in `IMAGE_REVIEW_REQUIRED` and cannot be published.

### 5.4 Image processing

- Preserve the original upload in object storage.
- Validate MIME type and reject executable or malformed files.
- Apply EXIF orientation.
- Record width, height, size, and checksum.
- Produce thumbnails and web-preview variants.
- Allow crop, rotation, ordering, and removal.
- Detect exact duplicate files through SHA-256 hashes.
- Upload approved listing images through eBay Media API/EPS.
- Store eBay image ID, EPS URL, and expiration information.

## 6. Spreadsheet contract

### 6.1 Required columns

| Column | Rule |
|---|---|
| `VIN` | Valid normalized VIN or explicitly marked unavailable. |
| `SKU` | Required and unique inside an organization. |
| `PartNumber` | Required; punctuation is preserved and a normalized search value is stored. |
| `Condition` | Controlled values such as `USED` or `NEW`. |
| `Quantity` | Non-negative integer. |
| `Cost` | Non-negative decimal with currency. |
| `ImageGroup` | Folder/manifest mapping value. |

### 6.2 Recommended optional columns

```text
Brand
PartName
InterchangeNumbers
Description
DonorMileage
DonorColor
Placement
Warehouse
BinLocation
Weight
Length
Width
Height
Notes
```

### 6.3 Import process

1. Upload file.
2. Detect file type and spreadsheet version.
3. Parse into a staging table; do not create live catalog rows yet.
4. Normalize VINs, SKUs, part numbers, numbers, dates, and currencies.
5. Validate required columns and company-level uniqueness.
6. Match uploaded images.
7. Produce row-level errors and warnings.
8. Show a preview and summary.
9. User confirms the import.
10. Commit valid rows idempotently to the catalog.
11. Keep the raw input, checksum, importer, and audit event.

Re-uploading the same file or retrying a timed-out job must not duplicate parts.

## 7. Multi-tenant data model

### 7.1 Identity and tenancy

- `Organization`
- `User`
- `OrganizationMembership`
- `Role`
- `Permission`
- `Subscription`
- `UsageRecord`
- `AuditEvent`

Every tenant-owned table must contain `organizationId`. The API must derive organization scope from the authenticated session and must never accept arbitrary organization IDs without an authorization check.

### 7.2 Inventory intake

- `ImportBatch`
- `ImportRow`
- `Vehicle`
- `Part`
- `PartNumber`
- `InventoryItem`
- `Warehouse`
- `BinLocation`
- `MediaAsset`
- `PartMedia`

### 7.3 Enrichment and listings

- `ListingDraft`
- `ListingDraftVersion`
- `ListingAspect`
- `ListingCategory`
- `PricingJob`
- `PricingSnapshot`
- `CompetitorListing`
- `FitmentJob`
- `VehicleApplication`
- `CatalogProductMatch`
- `ValidationIssue`

### 7.4 eBay channel

- `EbayConnection`
- `EbayOAuthToken`
- `EbayInventoryLocation`
- `EbayPolicyMapping`
- `EbayImage`
- `EbayOffer`
- `ChannelListing`
- `PublishJob`
- `ListingRevision`

### 7.5 Background processing

- `Job`
- `JobAttempt`
- `OutboxEvent`
- `WebhookEvent`
- `Notification`

## 8. Listing workflow and state machine

```text
IMPORTED
  ├── NEEDS_IMAGES
  ├── IMPORT_ERROR
  └── READY_FOR_ENRICHMENT
          ↓
     PRICING_PENDING
          ↓
     PRICING_REVIEW
          ↓
     FITMENT_PENDING
          ↓
     FITMENT_REVIEW
          ↓
     CONTENT_REVIEW
          ↓
     READY_TO_PUBLISH
          ↓
       PUBLISHING
       ├── PUBLISHED
       └── PUBLISH_ERROR
```

Readiness should be calculated from validation rules rather than trusted as a freely editable flag.

### 8.1 Minimum publication rules

- SKU is unique.
- Quantity is valid.
- Condition is mapped to an eBay condition.
- Title is within eBay limits.
- Description is present.
- At least one approved image is present.
- Leaf category is selected.
- All required item specifics are present.
- Price satisfies the company minimum-margin rule.
- Shipping, payment, and return policies are assigned.
- Inventory location is assigned.
- Compatibility is valid when required by the category.
- Seller connection is healthy.
- No blocking validation issues remain.

## 9. User interface

### 9.1 Organization onboarding

- Create organization.
- Invite users.
- Configure roles.
- Connect eBay seller account.
- Select marketplace.
- Map/create eBay policies and inventory location.
- Configure pricing defaults.
- Configure image and spreadsheet conventions.

### 9.2 Imports

- New import wizard.
- Download template.
- Upload spreadsheet.
- Upload ZIP/images.
- Parsing progress.
- Image-match summary.
- Errors/warnings table.
- Preview and confirm.
- Import history and retry.

### 9.3 Catalog

- Table and optional gallery view.
- Configurable columns.
- Bulk selection across pages.
- Saved filters/views.
- CSV export.
- Bulk pricing, fitment, validation, and publication actions.

### 9.4 Listing editor

Tabs or sections:

- Core part information.
- Images.
- eBay category.
- Title and description.
- Item specifics.
- Pricing and competitors.
- Fitment.
- Quantity and location.
- Shipping/payment/returns.
- Validation.
- Revision and audit history.

### 9.5 Filters

- Created, imported, updated, priced, and published date ranges.
- Import batch.
- VIN.
- SKU and part number.
- Condition.
- Workflow status.
- Image status.
- Pricing status.
- Fitment status.
- Content/validation status.
- Publication status and error.
- Price and cost ranges.
- Quantity.
- Category.
- Warehouse/bin.
- Marketplace and store.
- Shipping policy.
- Assigned user.

## 10. Pricing implementation

### 10.1 Bulk pricing workflow

1. User selects drafts.
2. User chooses marketplace and competitor condition.
3. API creates a `PricingJob` and returns immediately.
4. Worker searches eBay Browse API per normalized part number.
5. Worker retrieves listing details with controlled concurrency.
6. Matching engine validates structured MPN/OEM data and approved fallbacks.
7. Connected seller usernames are excluded.
8. Competitor snapshots and landed prices are stored.
9. Pricing rules calculate recommendations.
10. User reviews and accepts or overrides proposals.

### 10.2 Pricing formula

```text
minimumPrice =
  cost
  + packagingCost
  + expectedOutboundShipping
  + marketplaceFeeAllowance
  + advertisingAllowance
  + returnsRiskAllowance
  + requiredMargin
```

The recommended price may consider competitor median, lowest comparable listing, condition, and seller rules, but it must never fall below `minimumPrice` unless an authorized user explicitly overrides it with a reason.

### 10.3 Pricing controls

- Marketplace and currency.
- New/used competitor filter.
- Excluded sellers.
- Minimum competitor count.
- Maximum snapshot age.
- Percentage or fixed margin.
- Psychological rounding.
- Maximum automatic increase/decrease.
- Manual override reason.

## 11. Fitment implementation

### 11.1 Fitment job

1. Require an eBay leaf category.
2. Search the current eBay Catalog API using part number, brand, category, and available identifiers.
3. Score candidates using exact identifiers and verified attributes.
4. Automatically accept only a uniquely strong match; otherwise request review.
5. For an approved catalog product, call Sell Metadata `get_product_compatibilities`.
6. Normalize returned applications and cache with metadata version/date.
7. Display the proposed applications and source product.
8. User accepts/removes applications.
9. Before publishing, validate against current category policies.
10. Send approved applications through Inventory API product compatibility.

### 11.2 Candidate-match rules

Strong signals:

- Exact ePID/UPC/EAN/product ID.
- Exact brand plus MPN.
- Exact OEM number in structured catalog properties.
- Exact category.

Weak signals that cannot independently authorize a match:

- Similar title.
- Partial part number.
- Same generic part type.
- Same donor vehicle only.

### 11.3 Fallback fitment

- Decode donor VIN through a selected VIN-decoder provider.
- Map decoded properties to eBay-valid compatibility values.
- Show ambiguity for trim/engine/body-style selection.
- Store the approved source vehicle as one application.
- Let users add further applications using dependent eBay selectors.
- Label the source of every application: `EBAY_PRODUCT`, `DONOR_VIN`, or `USER_ADDED`.

## 12. Item specifics and content

1. Suggest an eBay category using verified part name and number.
2. User confirms the leaf category.
3. Fetch required and recommended aspects for that category.
4. Map spreadsheet/catalog fields into aspect values.
5. Present missing required values as blocking issues.
6. Generate a title from a company template.
7. Generate a structured description from verified data.
8. Allow editing and store revisions.

Example title template:

```text
{Condition} {Brand} {PartName} {PrimaryVehicle} {PartNumber}
```

Content generation must not invent part numbers, fitment, brand, placement, dimensions, condition, or warranty.

## 13. Seller connection and publication

### 13.1 OAuth

The current Browse implementation uses an application access token. Selling APIs require a user access token created through eBay Authorization Code Grant.

Implementation:

- Configure production RuName/redirect URLs.
- Generate consent URLs with state/CSRF protection.
- Exchange the authorization code server-side.
- Encrypt refresh tokens at rest.
- Refresh short-lived access tokens automatically.
- Store granted scopes and token health.
- Let users disconnect/reconnect accounts.
- Never expose access or refresh tokens to the browser.

### 13.2 Policy onboarding

- Verify seller business-policy enrollment.
- Retrieve payment policies.
- Retrieve fulfillment policies.
- Retrieve return policies.
- Retrieve/create inventory locations.
- Let the organization map defaults by marketplace, condition, category, warehouse, and shipping class.

### 13.3 Publish pipeline

```text
Validate draft
   ↓
Upload/confirm EPS images
   ↓
Create or replace Inventory Item
   ↓
Create or replace Product Compatibility
   ↓
Create or update Offer
   ↓
Publish Offer
   ↓
Store offerId + listingId + response/warnings
```

Every external operation must have an idempotency key or stable local reference so retries cannot create duplicate offers/listings.

### 13.4 After publication

- Pull current listing state.
- Update price and quantity through Inventory API.
- Record every revision.
- Surface eBay warnings and errors.
- Allow withdraw/end and controlled relist.
- Detect listing changes or failures.
- Add order and shipment integration in a later release.

Listings managed through Inventory API should continue to be revised through the API; the UI must be treated as the system of record for those listing fields.

## 14. Administration

### 14.1 Organization administration

- Users, roles, and invitations.
- Store connection.
- Pricing rules.
- Shipping and policy mappings.
- Warehouses.
- Templates.
- Usage and job history.
- Audit log.

### 14.2 Platform administration

- Organizations and memberships.
- Plans, limits, trials, and billing state.
- Import, pricing, fitment, image, and publishing jobs.
- Queue health and failed-job retry.
- eBay connection health with masked identifiers.
- Catalog/product-match corrections.
- System-level feature flags.
- Storage and API usage.
- Errors, alerts, and webhook health.
- Support impersonation with explicit permission and a complete audit trail.

Platform administrators must not be able to reveal stored OAuth refresh tokens or other raw credentials.

## 15. Application architecture

### 15.1 Services

```text
Next.js Web
    ↓ HTTPS
Express API
    ├── PostgreSQL / Prisma
    ├── Object Storage (S3/R2)
    ├── Redis
    └── Job Queue
             ↓
          Worker Service
          ├── imports
          ├── images
          ├── pricing
          ├── fitment
          ├── publishing
          └── synchronization
```

### 15.2 Recommended infrastructure

- Railway service for web.
- Railway service for API.
- Separate Railway worker service.
- Neon PostgreSQL initially.
- Railway Redis or equivalent.
- S3-compatible object storage such as Cloudflare R2 or AWS S3.
- Error monitoring and structured logs.
- Transactional email provider for invitations and job notifications.
- Billing provider after the pilot.

Browser requests must not wait for large imports, bulk pricing, image processing, fitment, or publishing. Those operations create jobs and report progress through polling or server-sent events.

## 16. Internal API outline

### 16.1 Imports and media

```text
POST   /api/imports
POST   /api/imports/:id/spreadsheet
POST   /api/imports/:id/images
POST   /api/imports/:id/validate
POST   /api/imports/:id/commit
GET    /api/imports/:id
GET    /api/imports/:id/issues
POST   /api/media/upload-url
PUT    /api/parts/:id/images
```

### 16.2 Catalog

```text
GET    /api/parts
GET    /api/parts/:id
PATCH  /api/parts/:id
POST   /api/parts/bulk-update
GET    /api/listing-drafts/:id
PATCH  /api/listing-drafts/:id
POST   /api/listing-drafts/:id/validate
```

### 16.3 Pricing and fitment

```text
POST   /api/pricing/jobs
GET    /api/pricing/jobs/:id
POST   /api/pricing/proposals/bulk-accept
POST   /api/fitment/jobs
GET    /api/fitment/jobs/:id
POST   /api/fitment/:draftId/approve
GET    /api/ebay/compatibility/properties
GET    /api/ebay/compatibility/values
```

### 16.4 Seller and publishing

```text
GET    /api/ebay/connect
GET    /api/ebay/callback
DELETE /api/ebay/connections/:id
GET    /api/ebay/policies
POST   /api/publish/jobs
GET    /api/publish/jobs/:id
POST   /api/listings/:id/revise
POST   /api/listings/:id/withdraw
```

### 16.5 Administration

```text
GET    /api/admin/organizations
GET    /api/admin/jobs
POST   /api/admin/jobs/:id/retry
GET    /api/admin/audit
GET    /api/admin/system-health
```

## 17. Security and compliance

- Enforce organization scope on every tenant query.
- Use server-side sessions or signed short-lived application tokens.
- Apply CSRF protection to seller OAuth and sensitive actions.
- Encrypt eBay refresh tokens with a managed encryption key.
- Mask credentials and identifiers in logs.
- Use signed, expiring object-storage upload URLs.
- Validate spreadsheet contents and prevent formula injection on export.
- Validate image payloads by content, not extension.
- Rate-limit authentication, imports, pricing, and publishing endpoints.
- Require explicit permissions for bulk publication and admin impersonation.
- Preserve immutable audit events for pricing overrides and publication.
- Back up PostgreSQL and define restore procedures.
- Continue complying with eBay marketplace account deletion notifications.
- Define retention and deletion policies for VIN and order/customer data.

## 18. Testing strategy

### 18.1 Unit tests

- VIN/SKU/part-number normalization.
- Spreadsheet validation.
- Image mapping precedence.
- Pricing and margin calculations.
- Catalog-product candidate scoring.
- Compatibility normalization.
- Title generation.
- Listing readiness rules.
- Permission checks.

### 18.2 Integration tests

- Import commit and retry idempotency.
- Object-storage upload flow.
- Background job retries.
- eBay token refresh.
- Browse pricing with mocked provider responses.
- Catalog and Metadata compatibility responses.
- Draft-to-offer payload generation.
- Database transaction rollback.
- Tenant isolation.

### 18.3 End-to-end tests

- Organization onboarding.
- Spreadsheet plus ZIP import.
- Image correction.
- Bulk pricing and approval.
- Fitment review.
- Draft editing and validation.
- Controlled publication.
- Revision and withdrawal.
- Platform-admin audit trail.

### 18.4 Production pilot gates

- No cross-tenant data access in automated security tests.
- At least 95% deterministic image mapping on the agreed upload format.
- Zero duplicate SKUs from import retries.
- Every published listing has approved actual-item images.
- Every published fitment has a recorded source and approver.
- No price may publish below the configured floor without an audited override.
- 10–25 controlled listings publish and revise successfully.

## 19. Observability and operations

- Correlation ID for each browser request and background job.
- Structured logs without secrets.
- Job progress, attempt count, and last error.
- eBay request operation, status, error ID, and retry classification.
- Metrics for import speed, image failures, pricing coverage, fitment coverage, publish success, and queue delay.
- Alerts for failed production authentication, stale inventory, queue backlog, database failure, and webhook downtime.
- Dead-letter queue with administrator retry controls.
- Daily reconciliation between local published listings and eBay offers.

## 20. Implementation phases

### Phase 0 — Product contract and UX prototype

**Estimate:** 1–2 weeks

Implementation:

- Finalize spreadsheet columns and image-folder rules.
- Collect 50 representative parts and images from the pilot customer.
- Document user roles and approval rules.
- Prototype import, catalog, editor, and bulk-action screens.
- Confirm eBay marketplace, categories, seller policies, and store structure.

Acceptance criteria:

- A signed-off spreadsheet template.
- A signed-off ZIP/image convention.
- A set of 50 golden test parts.
- Confirmed pilot seller and policies.

### Phase 1 — SaaS identity and tenant foundation

**Estimate:** 2–4 weeks

Implementation:

- Add organization, membership, roles, and permissions.
- Add authentication and invitations.
- Add organization selection and tenant-scoped repositories.
- Add audit event infrastructure.
- Add plan/usage placeholders.
- Migrate existing competitor data into an organization-aware module.

Acceptance criteria:

- Two organizations cannot access each other's records.
- Roles restrict pricing, publishing, and administration.
- Sensitive actions create audit events.

### Phase 2 — Spreadsheet and image intake

**Estimate:** 3–5 weeks

Implementation:

- Add object storage.
- Add import staging models.
- Implement CSV/XLSX parsing and validation.
- Implement direct and ZIP image upload.
- Implement deterministic mapping and thumbnails.
- Build preview, errors, warnings, and commit screens.
- Add retry-safe import jobs.

Acceptance criteria:

- Import 50 golden parts without duplicates.
- Map at least 95% of correctly structured images.
- Reject or quarantine invalid files.
- Re-running a job produces the same result.

### Phase 3 — Catalog and listing editor

**Estimate:** 3–5 weeks

Implementation:

- Build catalog table, gallery, filters, saved views, and export.
- Implement listing draft and version history.
- Build image ordering/editor.
- Implement bulk editing and assignments.
- Add validation issue framework and state machine.

Acceptance criteria:

- Users can find and edit any imported part.
- Bulk actions are permission checked and audited.
- Draft history identifies who changed each listing.

### Phase 4 — Bulk competitor pricing

**Estimate:** 2–4 weeks

Step 11 implements the first production slice of this phase: tenant-scoped jobs for up to 25 selected parts, marketplace and condition controls, exact item-specific matching, owned-seller exclusion, persisted competitor snapshots, polling, and catalog recommendations. Durable queue workers, company rules, floors, approval/override flows, and 100-part capacity remain in this phase.

Implementation:

- Refactor current synchronous search into queued pricing jobs.
- Add bulk selection and progress UI.
- Add company pricing rules and price floors.
- Store immutable snapshots and proposals.
- Add approve, reject, override, and reason flows.

Acceptance criteria:

- Price 100 selected parts without browser timeouts.
- Exclude connected company sellers.
- Preserve competitor evidence for every proposal.
- Block below-floor publication unless authorized override exists.

### Phase 5 — Category, specifics, and fitment

Step 12 implements the first review-first fitment slice: tenant-scoped discovery jobs for up to 10 selected parts, Taxonomy-assisted Catalog ePID candidates, deterministic evidence scoring, explicit candidate approval, Metadata compatibility import, normalized application persistence, polling, and startup recovery. Manual fitment editing, approval revision, durable external workers, and mapping approved applications into publishing payloads remain in this phase.

**Estimate:** 4–7 weeks

Implementation:

- Add category suggestion/confirmation.
- Integrate required/recommended eBay aspects.
- Implement Catalog API candidate discovery.
- Implement Metadata product compatibility retrieval.
- Add candidate scoring and review.
- Add donor-VIN/user-selected fallback.
- Add compatibility validation and source tracking.

Acceptance criteria:

- Strong catalog matches retrieve and display fitment.
- Ambiguous matches require user selection.
- Unmatched products can receive a reviewed source-vehicle application.
- Every compatibility row has provenance.

### Phase 6 — eBay seller onboarding and publication

**Estimate:** 4–7 weeks

**Step 13 delivered:** the seller-connection foundation now provides one production or sandbox eBay connection per organization, owner/admin consent controls, one-use hashed OAuth state, server-side authorization-code exchange, AES-256-GCM encrypted token storage, automatic access-token refresh, sanitized status, reconnection, and local disconnect. Policy discovery, listing readiness, and publication remain later steps in this phase.

Implementation:

- Add seller OAuth Authorization Code Grant.
- Add encrypted token storage and refresh.
- Add policy/location discovery and mapping.
- Add EPS image upload.
- Implement inventory item, compatibility, offer, and publish operations.
- Implement idempotent retries and response mapping.
- Add preview, readiness checklist, and bulk publish jobs.

Acceptance criteria:

- Connect and reconnect a production seller safely.
- Publish 10–25 approved pilot drafts without duplicates.
- Save listing and offer identifiers.
- Revise price/quantity and withdraw a controlled listing.

### Phase 7 — Administration, billing, and hardening

**Estimate:** 4–6 weeks

Implementation:

- Complete organization and platform admin panels.
- Add subscription plans, quotas, and usage recording.
- Add monitoring, alerts, dead-letter jobs, and support tools.
- Add backups, restore testing, retention, and deletion workflows.
- Perform security, load, and tenant-isolation testing.

Acceptance criteria:

- Operators can diagnose and retry failed jobs.
- Usage limits are enforced.
- Restore procedure is tested.
- Security review has no unresolved high-risk findings.

## 21. Delivery timeline

For a small experienced team, a controlled pilot is approximately 4–6 months. A production multi-company SaaS is approximately 6–10 months. A solo implementation is more realistically 9–15 months.

The sequence matters. Publishing should not be built before import idempotency, image provenance, editing, validation, and tenant isolation are reliable.

## 22. First development milestone

The first milestone is **Catalog Intake v1**:

> A company user can upload one versioned spreadsheet and one structured image ZIP, preview validation and image matches, confirm the import, and view 50 editable, organization-isolated parts in the catalog without duplicates.

Implementation order:

1. Create organization and role schema.
2. Add authenticated tenant context.
3. Add import, vehicle, part, inventory, and media schemas.
4. Configure object storage.
5. Define and publish the spreadsheet template.
6. Implement staging parser and validation.
7. Implement ZIP/image mapping.
8. Build import preview and confirmation.
9. Build the initial catalog table and part editor.
10. Add unit, integration, and tenant-isolation tests.

Only after this milestone is accepted should implementation proceed to queued bulk pricing.

## 23. Reference documentation

- eBay Sell Metadata product identifiers: https://developer.ebay.com/api-docs/sell/metadata/types/api%3AProductIdentifier
- eBay Sell Metadata product compatibility request: https://developer.ebay.com/api-docs/sell/metadata/types/api%3AProductRequest
- eBay compatibility property values: https://developer.ebay.com/api-docs/sell/taxonomy/resources/category_tree/methods/getCompatibilityPropertyValues
- eBay product compatibility management: https://developer.ebay.com/api-docs/sell/static/inventory/managing-product-compatibility.html
- eBay Inventory API publishing requirements: https://developer.ebay.com/api-docs/sell/static/inventory/publishing-offers.html
- eBay authorization: https://developer.ebay.com/develop/guides-v2/authorization
- eBay image management: https://developer.ebay.com/api-docs/sell/static/inventory/managing-image-media.html
- eBay Inventory API overview: https://developer.ebay.com/api-docs/sell/inventory/static/overview.html
- Legacy Product API decommission notice: https://developer.ebay.com/devzone/product/CallRef/getProductCompatibilities.html
