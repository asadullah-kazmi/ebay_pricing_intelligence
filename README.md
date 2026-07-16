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

## Applications

- `apps/web`: Next.js search dashboard.
- `apps/api`: Express API, matching engine, analytics, eBay provider boundary, and Prisma schema.

## API

- `POST /api/search` — body: `{ "oem": "8K0615301M", "marketplace": "EBAY_US" }`
- `GET /api/listings/:id`
- `GET /api/analytics/:oem`
- `GET /api/history/:oem`
- `GET /health`
