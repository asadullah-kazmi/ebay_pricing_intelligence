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

New tenant-owned API routes use short-lived HS256 JWT access tokens and resolve the user's current organization membership from PostgreSQL on every request. Refresh JWTs use a separate signing secret, are stored only as SHA-256 hashes, and rotate after every successful refresh. Configure two different private random secrets of at least 32 characters:

```env
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ISSUER=partpulse-api
JWT_AUDIENCE=partpulse-web
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=2592000
WEB_ORIGIN=http://localhost:3000
```

`GET /api/session` accepts an access token in `Authorization: Bearer <token>`. Its token must contain `sub` (user ID) and `organizationId`; a valid signature alone is insufficient because the API also verifies the corresponding `OrganizationMembership`. `POST /api/auth/refresh` rotates the secure, HTTP-only `partpulse_refresh` cookie and returns a new access token. `POST /api/auth/logout` revokes and clears that refresh token. Initial token issuance is exposed as a server-side service for the login/onboarding flow; refresh tokens are never returned to browser JavaScript by these endpoints.

Set `WEB_ORIGIN` to the exact web application origin in Railway. Authentication cookie endpoints reject other origins. Use different access and refresh secrets in every environment and never commit them.

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
- `POST /api/auth/refresh` â€” rotate refresh cookie and return a new access token
- `POST /api/auth/logout` â€” revoke the current refresh session
- `GET /health`
