CREATE UNIQUE INDEX "PricingJob_one_active_per_organization_key"
ON "PricingJob"("organizationId")
WHERE "status" IN ('QUEUED', 'RUNNING');
