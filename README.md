# eBay Automotive Competitor Price Intelligence

MVP implementation of the supplied system design. Search an OEM/MPN, verify exact part-number matches, exclude owned sellers, and calculate landed-price analytics.

## Run locally

1. Copy `.env.example` to `.env` and set credentials when available. Never put secrets in `.env.example`.
2. Install packages with `npm install`.
3. Create the PostgreSQL database named in `DATABASE_URL`.
4. Generate the client with `npm run db:generate`.
5. Apply the schema with `npm run db:migrate`.
6. Run both applications with `npm run dev`.
7. Open http://localhost:3000. The API runs on http://localhost:4000.

Without eBay credentials, the API intentionally uses realistic demo listings. Search results, listing snapshots, and price history are persisted in PostgreSQL through Prisma, so a valid `DATABASE_URL` and migrated database are required.

Check `GET http://localhost:4000/health` after startup. Its `ebay.mode` value is `demo` when credentials are absent and `live` when both credentials are configured. The persistence status reports whether PostgreSQL is reachable. It never returns credential values.

Run `npm run db:check` to test the configured PostgreSQL connection without starting the applications.
Run `npm run ebay:check` to verify the configured eBay credentials without performing a listing search.

## SaaS authentication foundation

New tenant-owned API routes use a short-lived HS256 bearer token and resolve the user's current organization membership from PostgreSQL on every request. Configure a private random secret of at least 32 characters as `APP_AUTH_SECRET`; keep the default issuer and audience unless the web authentication service is configured with different values.

```env
APP_AUTH_SECRET=
AUTH_ISSUER=partpulse-api
AUTH_AUDIENCE=partpulse-web
```

`GET /api/session` is the first protected route. Its token must contain `sub` (user ID) and `organizationId`; a valid signature alone is insufficient because the API also verifies the corresponding `OrganizationMembership`. The existing competitor-pricing endpoints remain available during the schema transition and will move behind tenant authentication when their data becomes organization-owned.

## eBay production notifications

eBay requires production applications that persist eBay data to receive marketplace account-deletion notifications. Deploy the API at a public HTTPS URL, then configure the exact callback URL and a private 32-80 character token:

```env
EBAY_NOTIFICATION_ENDPOINT=https://your-api.example.com/api/ebay/account-deletion
EBAY_NOTIFICATION_VERIFICATION_TOKEN=replace-with-a-private-random-token
```

Enter those same values in the eBay developer portal. The callback supports eBay's `GET` verification challenge and signed `POST` deletion notifications. If a notice contains a seller username, stored listings for that seller are deleted. If eBay omits the username, all stored listings are deleted so that unidentified account data cannot be retained.

## Applications

- `apps/web`: Next.js search dashboard.
- `apps/api`: Express API, matching engine, analytics, eBay provider boundary, and Prisma schema.

## Product roadmap

See [Automotive Catalog and eBay Publishing SaaS Implementation Plan](docs/SAAS_IMPLEMENTATION_PLAN.md) for the complete multi-tenant catalog, image mapping, pricing, fitment, editing, publishing, administration, testing, and delivery plan.

## API

- `POST /api/search` — body: `{ "oem": "8K0615301M", "marketplace": "EBAY_US", "condition": "NEW" }` (`condition`: `ANY`, `NEW`, or `USED`)
- `GET /api/listings/:id`
- `GET /api/analytics/:oem`
- `GET /api/history/:oem`
- `GET /api/session` â€” authenticated user, organization, and role context
- `GET /health`
