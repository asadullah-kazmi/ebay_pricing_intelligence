-- CreateTable
CREATE TABLE "EbayOrderCacheItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ebaySellerConnectionId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "legacyOrderId" TEXT,
    "buyerUsername" TEXT,
    "buyerEmail" TEXT,
    "buyerName" TEXT,
    "orderStatus" TEXT,
    "checkoutStatus" TEXT,
    "paymentStatus" TEXT,
    "fulfillmentStatus" TEXT,
    "paidTime" TIMESTAMP(3),
    "createdTime" TIMESTAMP(3),
    "shippedTime" TIMESTAMP(3),
    "totalValue" DECIMAL(12,2),
    "totalCurrency" TEXT,
    "quantity" INTEGER,
    "itemCount" INTEGER,
    "firstSku" TEXT,
    "firstTitle" TEXT,
    "shippingService" TEXT,
    "shippingValue" DECIMAL(12,2),
    "shippingCurrency" TEXT,
    "shippingAddress" JSONB,
    "transactions" JSONB,
    "payload" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EbayOrderCacheItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EbayOrderCacheItem_ebaySellerConnectionId_marketplace_sourceKey_key" ON "EbayOrderCacheItem"("ebaySellerConnectionId", "marketplace", "sourceKey");

-- CreateIndex
CREATE INDEX "EbayOrderCacheItem_organizationId_ebaySellerConnectionId_syncedAt_idx" ON "EbayOrderCacheItem"("organizationId", "ebaySellerConnectionId", "syncedAt");

-- CreateIndex
CREATE INDEX "EbayOrderCacheItem_organizationId_orderStatus_idx" ON "EbayOrderCacheItem"("organizationId", "orderStatus");

-- CreateIndex
CREATE INDEX "EbayOrderCacheItem_organizationId_paymentStatus_idx" ON "EbayOrderCacheItem"("organizationId", "paymentStatus");

-- CreateIndex
CREATE INDEX "EbayOrderCacheItem_organizationId_createdTime_idx" ON "EbayOrderCacheItem"("organizationId", "createdTime");

-- CreateIndex
CREATE INDEX "EbayOrderCacheItem_organizationId_orderId_idx" ON "EbayOrderCacheItem"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "EbayOrderCacheItem_organizationId_firstSku_idx" ON "EbayOrderCacheItem"("organizationId", "firstSku");

-- AddForeignKey
ALTER TABLE "EbayOrderCacheItem" ADD CONSTRAINT "EbayOrderCacheItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EbayOrderCacheItem" ADD CONSTRAINT "EbayOrderCacheItem_ebaySellerConnectionId_fkey" FOREIGN KEY ("ebaySellerConnectionId") REFERENCES "EbaySellerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
