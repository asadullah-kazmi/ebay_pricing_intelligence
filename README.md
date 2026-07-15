# eBay Automotive Competitor Price Intelligence

MVP implementation of the supplied system design. Search an OEM/MPN, verify exact part-number matches, exclude owned sellers, and calculate landed-price analytics.

## Run locally

1. Copy `.env.example` to `.env` and set credentials when available.
2. Install packages with `npm install`.
3. Run both applications with `npm run dev`.
4. Open http://localhost:3000. The API runs on http://localhost:4000.

Without eBay credentials, the API intentionally uses realistic demo listings. This makes the complete search and analytics workflow testable locally. PostgreSQL persistence is represented by the Prisma schema and can be enabled after configuring `DATABASE_URL`.

## Applications

- `apps/web`: Next.js search dashboard.
- `apps/api`: Express API, matching engine, analytics, eBay provider boundary, and Prisma schema.

## API

- `POST /api/search` — body: `{ "oem": "8K0615301M", "marketplace": "EBAY_US" }`
- `GET /api/listings/:id`
- `GET /api/analytics/:oem`
- `GET /api/history/:oem`
- `GET /health`

