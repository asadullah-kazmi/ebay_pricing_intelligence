# Step 27 — Pricing governance and publication floors

Step 27 separates eBay market evidence from the business decision to publish a
price. Every successful pricing-job item now creates an immutable governed
proposal with its cost, currency, rule snapshot, calculated floor, suggested
price, status, approver, and decision reason.

## Organization rule

Owners and administrators configure:

- market adjustment percentage applied to the market recommendation;
- minimum gross-margin percentage;
- minimum absolute profit amount; and
- whether a person must approve every proposal.

The floor is the higher of:

```text
cost + minimum profit
cost / (1 - minimum margin percentage)
```

The governed proposal is the higher of the adjusted market recommendation and
the calculated floor. Rules apply only to future pricing runs because every
proposal preserves the exact rule snapshot used to calculate it.

If cost is missing or its currency differs from the eBay marketplace result,
the system preserves the market evidence but refuses approval until inventory
cost and currency are corrected. It never performs an implicit currency
conversion.

## Decisions

Pricing-capable roles may approve or reject an at/above-floor proposal. An
override requires a positive replacement price and a reason. Only an
organization owner or administrator can approve an override below the floor.
Below-floor decisions produce critical audit evidence.

Running pricing again supersedes the prior active proposal for that part and
marketplace. This prevents an older approval from silently authorizing a newer
market result.

## Publication enforcement

A listing draft is blocked until:

1. a current proposal is `APPROVED` or `OVERRIDDEN`;
2. the draft currency matches the proposal currency; and
3. the draft price exactly matches the approved price.

The same rule is checked again before eBay inventory preparation, offer
preparation, live publication, and listing revision. UI readiness is therefore
not the only security boundary.

## API

```http
GET /api/pricing/rule
PUT /api/pricing/rule
GET /api/pricing/proposals?status=PENDING&marketplace=EBAY_US&limit=50
POST /api/pricing/proposals/:id/decision
```

Rule update:

```json
{
  "marketAdjustmentPercent": 0,
  "minimumMarginPercent": 20,
  "minimumProfitAmount": 10,
  "requireApproval": true
}
```

Decision examples:

```json
{ "action": "APPROVE" }
```

```json
{ "action": "REJECT", "reason": "Competitors are not comparable" }
```

```json
{
  "action": "OVERRIDE",
  "overridePrice": 64.99,
  "reason": "Approved clearance price for aged inventory"
}
```

## Deployment

Apply `20260724100000_add_pricing_governance` before deploying API, worker, and
web from the same commit:

```powershell
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Existing drafts do not receive synthetic approval. Run pricing, decide the new
proposal, set the approved price on the draft, and perform live validation
before preparing or revising the listing.

