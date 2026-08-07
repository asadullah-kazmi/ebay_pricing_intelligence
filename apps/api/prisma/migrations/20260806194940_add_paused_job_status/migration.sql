-- AlterEnum
ALTER TYPE "PricingJobStatus" ADD VALUE 'PAUSED';

-- DropIndex
DROP INDEX "FitmentApplication_organizationId_partId_idx";

-- AlterTable
ALTER TABLE "FitmentApplication" ALTER COLUMN "updatedAt" DROP DEFAULT;
