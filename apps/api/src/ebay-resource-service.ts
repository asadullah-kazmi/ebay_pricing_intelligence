import { Prisma, type EbaySellerResourceType } from "@prisma/client";
import { prisma } from "./db.js";
import { fetchCategoryAspects, fetchCategoryConditions, fetchSellerResources, type EbayAspectRequirement, type EbayConditionOption } from "./providers/ebay-selling.js";
import type { Marketplace } from "./types.js";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export interface PublicSellerResource {
  type: EbaySellerResourceType;
  remoteId: string;
  name: string | null;
  enabled: boolean;
  fetchedAt: Date;
}

function groupedResources(marketplace: string, resources: PublicSellerResource[]) {
  const ofType = (type: EbaySellerResourceType) => resources.filter((resource) => resource.type === type);
  return {
    marketplace,
    paymentPolicies: ofType("PAYMENT_POLICY"),
    returnPolicies: ofType("RETURN_POLICY"),
    fulfillmentPolicies: ofType("FULFILLMENT_POLICY"),
    inventoryLocations: ofType("INVENTORY_LOCATION"),
  };
}

export async function listCachedSellerResources(organizationId: string, marketplace: Marketplace) {
  const resources = await prisma.ebaySellerResource.findMany({
    where: { organizationId, marketplace },
    orderBy: [{ type: "asc" }, { name: "asc" }, { remoteId: "asc" }],
    select: { type: true, remoteId: true, name: true, enabled: true, fetchedAt: true },
  });
  return groupedResources(marketplace, resources);
}

export async function syncSellerResources(organizationId: string, marketplace: Marketplace) {
  const resources = await fetchSellerResources(organizationId, marketplace);
  const fetchedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.ebaySellerResource.deleteMany({ where: { organizationId, marketplace } });
    if (resources.length) {
      await tx.ebaySellerResource.createMany({
        data: resources.map((resource) => ({
          organizationId,
          marketplace,
          type: resource.type,
          remoteId: resource.remoteId,
          name: resource.name,
          enabled: resource.enabled,
          payload: asJson(resource.payload),
          fetchedAt,
        })),
      });
    }
  });
  return listCachedSellerResources(organizationId, marketplace);
}

export async function refreshCategoryMetadata(marketplace: Marketplace, categoryId: string) {
  const [aspects, conditions] = await Promise.all([fetchCategoryAspects(marketplace, categoryId), fetchCategoryConditions(marketplace, categoryId)]);
  const fetchedAt = new Date();
  const metadata = await prisma.ebayCategoryMetadata.upsert({
    where: { marketplace_categoryId: { marketplace, categoryId } },
    create: { marketplace, categoryId, aspects: asJson(aspects), conditions: asJson(conditions), fetchedAt },
    update: { aspects: asJson(aspects), conditions: asJson(conditions), fetchedAt },
  });
  return { marketplace, categoryId, aspects, conditions, fetchedAt: metadata.fetchedAt };
}

export function conditionOptions(value: Prisma.JsonValue | null | undefined): EbayConditionOption[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.conditionId !== "string" || typeof row.enumValue !== "string" || typeof row.name !== "string") return [];
    return [{ conditionId: row.conditionId, enumValue: row.enumValue, name: row.name, description: typeof row.description === "string" ? row.description : null }];
  });
}

export function aspectRequirements(value: Prisma.JsonValue | null | undefined): EbayAspectRequirement[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.name !== "string") return [];
    return [{
      name: row.name,
      required: row.required === true,
      recommended: row.recommended === true,
      mode: typeof row.mode === "string" ? row.mode : null,
      dataType: typeof row.dataType === "string" ? row.dataType : null,
      cardinality: typeof row.cardinality === "string" ? row.cardinality : null,
      values: Array.isArray(row.values) ? row.values.filter((item): item is string => typeof item === "string") : [],
    }];
  });
}

export async function getCachedReadinessMetadata(organizationId: string, marketplace: Marketplace, categoryId: string | null) {
  const [resources, metadata] = await Promise.all([
    prisma.ebaySellerResource.findMany({
      where: { organizationId, marketplace, enabled: true },
      select: { type: true, remoteId: true },
    }),
    categoryId
      ? prisma.ebayCategoryMetadata.findUnique({ where: { marketplace_categoryId: { marketplace, categoryId } } })
      : null,
  ]);
  const ids = (type: EbaySellerResourceType) => new Set(resources.filter((resource) => resource.type === type).map(({ remoteId }) => remoteId));
  return {
    sellerResources: resources.length ? {
      paymentPolicyIds: ids("PAYMENT_POLICY"),
      returnPolicyIds: ids("RETURN_POLICY"),
      fulfillmentPolicyIds: ids("FULFILLMENT_POLICY"),
      inventoryLocationKeys: ids("INVENTORY_LOCATION"),
    } : null,
    categoryRequirements: aspectRequirements(metadata?.aspects),
    categoryConditions: conditionOptions(metadata?.conditions),
  };
}
