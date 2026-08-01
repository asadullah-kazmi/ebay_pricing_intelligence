-- Store matched eBay competitors for each bulk pricing row so operators can review comps per product.
ALTER TABLE "BulkPricingJobItem"
ADD COLUMN "competitors" JSONB;
