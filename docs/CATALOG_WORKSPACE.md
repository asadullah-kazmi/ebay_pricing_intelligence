# Catalog workspace

Step 9 adds the first catalog management workspace at `/catalog`. It operates only on parts created by a confirmed import and always derives the organization from the JWT access token.

## Catalog API

`GET /api/parts` supports these query parameters:

- `q`: partial SKU, primary/interchange part number, brand, part name, or donor VIN.
- `status`: `IMPORTED`, `NEEDS_IMAGES`, `IMPORT_ERROR`, `READY_FOR_ENRICHMENT`, or `ARCHIVED`.
- `condition`: `NEW` or `USED`.
- `hasImages`: `true` or `false`.
- `warehouseId`: an organization-owned warehouse ID.
- `createdFrom` and `createdTo`: ISO dates/timestamps.
- `sort`: `newest`, `oldest`, `updated`, or `sku`.
- `page` and `pageSize`; page size is limited to 100.

Responses include page totals, organization-wide status counts, warehouse filter options, inventory/location summaries, and the first media asset ID. The browser exchanges a media ID for a short-lived private URL only when needed.

Additional endpoints:

```text
GET   /api/parts/export
GET   /api/parts/{partId}
PATCH /api/parts/{partId}
PATCH /api/parts/bulk-status
```

Exports apply the same filters and are capped at 5,000 rows. Updates re-normalize changed SKUs and part numbers, use a transaction for inventory/location changes, and convert uniqueness conflicts into HTTP 409 responses. Bulk status updates accept no more than 500 unique part IDs and reject cross-organization IDs without partially updating the selection.

## Web workspace

The responsive workspace provides:

- Table and gallery views.
- Search, status, condition, image, warehouse, and sorting controls.
- Page selection and bulk archive action.
- Catalog totals and actionable status counters.
- A complete core-part and inventory editor.
- Private image previews and filtered CSV export.

On startup, the browser obtains a new access token through the secure HTTP-only refresh cookie. Because password login/onboarding UI has not been implemented yet, the session-required screen also accepts an already-issued short-lived access token for development. The token is kept only in React memory and is not written to local or session storage.

For visual development only, `http://localhost:3000/catalog?demo=1` renders three sample records when Next.js runs in development mode. This path cannot enable demo data in a production build and never bypasses an API authorization check.
