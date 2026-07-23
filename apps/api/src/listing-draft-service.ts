import { Prisma, type ListingDraft, type PartCondition } from "@prisma/client";
import { prisma } from "./db.js";
import { enqueueOutboxEvent } from "./outbox-service.js";
import { getCachedReadinessMetadata, refreshCategoryMetadata, syncSellerResources } from "./ebay-resource-service.js";
import type { EbayAspectRequirement, EbayConditionOption } from "./providers/ebay-selling.js";
import type { Marketplace } from "./types.js";

export class ListingDraftError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "ListingDraftError";
  }
}

export interface ReadinessIssue {
  code: string;
  severity: "BLOCKER" | "WARNING";
  field: string;
  message: string;
}

export interface DraftValues {
  title: string;
  description: string | null;
  categoryId: string | null;
  condition: PartCondition;
  ebayCondition: string | null;
  price: number | null;
  currency: string;
  quantity: number;
  aspects: Record<string, string[]>;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
  shippingPolicyId: string | null;
  merchantLocationKey: string | null;
}

export interface DraftReadinessContext {
  sellerConnected: boolean;
  approvedImageCount: number;
  fitmentApplicationCount: number;
  sellerResources?: {
    paymentPolicyIds: Set<string>;
    returnPolicyIds: Set<string>;
    fulfillmentPolicyIds: Set<string>;
    inventoryLocationKeys: Set<string>;
  } | null;
  categoryRequirements?: EbayAspectRequirement[] | null;
  categoryConditions?: EbayConditionOption[] | null;
}

export function evaluateListingReadiness(values: DraftValues, context: DraftReadinessContext): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const blocker = (code: string, field: string, message: string) => issues.push({ code, severity: "BLOCKER", field, message });
  const warning = (code: string, field: string, message: string) => issues.push({ code, severity: "WARNING", field, message });
  if (!context.sellerConnected) blocker("SELLER_NOT_CONNECTED", "sellerConnection", "Connect an active eBay seller account.");
  if (!values.title.trim()) blocker("TITLE_REQUIRED", "title", "Listing title is required.");
  else if (values.title.length > 80) blocker("TITLE_TOO_LONG", "title", "eBay titles cannot exceed 80 characters.");
  if (!values.description?.trim()) blocker("DESCRIPTION_REQUIRED", "description", "Description is required.");
  if (!values.categoryId?.trim()) blocker("CATEGORY_REQUIRED", "categoryId", "Select an eBay leaf category.");
  if (context.categoryConditions) {
    if (!values.ebayCondition) blocker("EBAY_CONDITION_REQUIRED", "ebayCondition", "Select an eBay condition supported by this category.");
    else if (!context.categoryConditions.some(({ enumValue }) => enumValue === values.ebayCondition)) {
      blocker("EBAY_CONDITION_INVALID", "ebayCondition", "The selected eBay condition is not supported by this category.");
    }
  }
  if (values.price === null || !Number.isFinite(values.price) || values.price <= 0) blocker("PRICE_REQUIRED", "price", "Set a price greater than zero.");
  if (!/^[A-Z]{3}$/.test(values.currency)) blocker("CURRENCY_INVALID", "currency", "Currency must be a three-letter code.");
  if (!Number.isInteger(values.quantity) || values.quantity < 1) blocker("QUANTITY_REQUIRED", "quantity", "At least one unit must be available.");
  if (context.approvedImageCount < 1) blocker("APPROVED_IMAGE_REQUIRED", "images", "Approve at least one actual-item image.");
  if (!values.paymentPolicyId?.trim()) blocker("PAYMENT_POLICY_REQUIRED", "paymentPolicyId", "Assign an eBay payment policy.");
  if (!values.returnPolicyId?.trim()) blocker("RETURN_POLICY_REQUIRED", "returnPolicyId", "Assign an eBay return policy.");
  if (!values.shippingPolicyId?.trim()) blocker("SHIPPING_POLICY_REQUIRED", "shippingPolicyId", "Assign an eBay shipping policy.");
  if (!values.merchantLocationKey?.trim()) blocker("LOCATION_REQUIRED", "merchantLocationKey", "Assign an eBay merchant location.");
  if (context.sellerResources) {
    if (values.paymentPolicyId && !context.sellerResources.paymentPolicyIds.has(values.paymentPolicyId)) blocker("PAYMENT_POLICY_INVALID", "paymentPolicyId", "The payment policy is not available for this seller and marketplace.");
    if (values.returnPolicyId && !context.sellerResources.returnPolicyIds.has(values.returnPolicyId)) blocker("RETURN_POLICY_INVALID", "returnPolicyId", "The return policy is not available for this seller and marketplace.");
    if (values.shippingPolicyId && !context.sellerResources.fulfillmentPolicyIds.has(values.shippingPolicyId)) blocker("SHIPPING_POLICY_INVALID", "shippingPolicyId", "The fulfillment policy is not available for this seller and marketplace.");
    if (values.merchantLocationKey && !context.sellerResources.inventoryLocationKeys.has(values.merchantLocationKey)) blocker("LOCATION_INVALID", "merchantLocationKey", "The inventory location is unavailable or disabled.");
  }
  const mpn = values.aspects["Manufacturer Part Number"] ?? values.aspects.MPN ?? [];
  if (!mpn.some((value) => value.trim())) blocker("MPN_REQUIRED", "aspects", "Manufacturer Part Number item specific is required.");
  if (!context.fitmentApplicationCount) warning("FITMENT_NOT_APPROVED", "fitment", "No approved vehicle compatibility is attached.");
  if (context.categoryRequirements) {
    const valueFor = (name: string) => Object.entries(values.aspects).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? [];
    for (const requirement of context.categoryRequirements) {
      const entered = valueFor(requirement.name).map((value) => value.trim()).filter(Boolean);
      if (requirement.required && !entered.length) {
        blocker("REQUIRED_ASPECT_MISSING", `aspects.${requirement.name}`, `Required eBay item specific "${requirement.name}" is missing.`);
      } else if (requirement.recommended && !entered.length) {
        warning("RECOMMENDED_ASPECT_MISSING", `aspects.${requirement.name}`, `Recommended eBay item specific "${requirement.name}" is missing.`);
      }
      if (entered.length && requirement.mode === "SELECTION_ONLY" && requirement.values.length) {
        const allowed = new Set(requirement.values.map((value) => value.toLowerCase()));
        if (entered.some((value) => !allowed.has(value.toLowerCase()))) {
          blocker("ASPECT_VALUE_INVALID", `aspects.${requirement.name}`, `"${requirement.name}" must use a value allowed by eBay.`);
        }
      }
      if (entered.length > 1 && requirement.cardinality === "SINGLE") {
        blocker("ASPECT_CARDINALITY_INVALID", `aspects.${requirement.name}`, `"${requirement.name}" accepts only one value.`);
      }
    }
  } else {
    warning("CATEGORY_METADATA_PENDING", "categoryId", "Required eBay category aspects have not been confirmed against live metadata.");
  }
  return issues;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function aspectRecord(value: Prisma.JsonValue): Record<string, string[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([name, values]) =>
    Array.isArray(values) ? [[name, values.filter((entry): entry is string => typeof entry === "string")]] : [],
  ));
}

function numberOrNull(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value.toString());
}

function serializeDraft<T extends ListingDraft>(draft: T) {
  return { ...draft, price: numberOrNull(draft.price), aspects: aspectRecord(draft.aspects) };
}

function snapshot(values: DraftValues, status: "BLOCKED" | "READY", issues: ReadinessIssue[]) {
  return asJson({ ...values, status, validationIssues: issues });
}

function generatedTitle(part: { brand: string | null; partName: string | null; primaryPartNumber: string; condition: PartCondition }): string {
  const title = [part.condition === "USED" ? "OEM" : "New", part.brand, part.partName, part.primaryPartNumber].filter(Boolean).join(" ");
  return title.slice(0, 80).trim();
}

const contextInclude = {
  part: {
    include: {
      media: { where: { approved: true, mediaAsset: { status: "READY" as const } }, select: { id: true } },
      fitmentApplications: { select: { id: true } },
    },
  },
  organization: { select: { ebaySellerConnection: { select: { status: true } } } },
} satisfies Prisma.ListingDraftInclude;

function contextFromDraft(draft: Prisma.ListingDraftGetPayload<{ include: typeof contextInclude }>): DraftReadinessContext {
  return {
    sellerConnected: draft.organization.ebaySellerConnection?.status === "ACTIVE",
    approvedImageCount: draft.part.media.length,
    fitmentApplicationCount: draft.part.fitmentApplications.length,
  };
}

function valuesFromDraft(draft: ListingDraft): DraftValues {
  return {
    title: draft.title,
    description: draft.description,
    categoryId: draft.categoryId,
    condition: draft.condition,
    ebayCondition: draft.ebayCondition,
    price: numberOrNull(draft.price),
    currency: draft.currency,
    quantity: draft.quantity,
    aspects: aspectRecord(draft.aspects),
    paymentPolicyId: draft.paymentPolicyId,
    returnPolicyId: draft.returnPolicyId,
    shippingPolicyId: draft.shippingPolicyId,
    merchantLocationKey: draft.merchantLocationKey,
  };
}

export async function createListingDrafts(input: {
  organizationId: string;
  userId: string;
  partIds: string[];
  marketplace: string;
}) {
  const partIds = [...new Set(input.partIds)];
  const [parts, connection] = await Promise.all([
    prisma.part.findMany({
      where: { organizationId: input.organizationId, id: { in: partIds }, status: { not: "ARCHIVED" } },
      include: {
        inventoryItem: true,
        media: { where: { approved: true, mediaAsset: { status: "READY" } }, select: { id: true } },
        fitmentApplications: { select: { id: true } },
        pricingJobItems: {
          where: { status: "COMPLETED", pricingJob: { marketplace: input.marketplace } },
          orderBy: { completedAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.ebaySellerConnection.findUnique({ where: { organizationId: input.organizationId }, select: { status: true } }),
  ]);
  if (parts.length !== partIds.length) throw new ListingDraftError("One or more selected parts are unavailable or archived", 404);

  await prisma.$transaction(async (tx) => {
    for (const part of parts) {
      const latestPrice = part.pricingJobItems[0];
      const values: DraftValues = {
        title: generatedTitle(part),
        description: part.description?.trim() || `${part.condition === "USED" ? "Used OEM" : "New"} ${part.partName ?? "automotive part"}. Part number ${part.primaryPartNumber}. Review all actual-item images before purchase.`,
        categoryId: null,
        condition: part.condition,
        ebayCondition: part.condition === "NEW" ? "NEW" : null,
        price: latestPrice?.recommendedPrice ? Number(latestPrice.recommendedPrice.toString()) : null,
        currency: latestPrice?.currency ?? part.inventoryItem?.currency ?? (input.marketplace === "EBAY_GB" ? "GBP" : input.marketplace === "EBAY_DE" ? "EUR" : "USD"),
        quantity: part.inventoryItem?.quantity ?? 0,
        aspects: {
          "Manufacturer Part Number": [part.primaryPartNumber],
          ...(part.brand ? { Brand: [part.brand] } : {}),
          ...(part.placement ? { Placement: [part.placement] } : {}),
        },
        paymentPolicyId: null,
        returnPolicyId: null,
        shippingPolicyId: null,
        merchantLocationKey: null,
      };
      const issues = evaluateListingReadiness(values, {
        sellerConnected: connection?.status === "ACTIVE",
        approvedImageCount: part.media.length,
        fitmentApplicationCount: part.fitmentApplications.length,
      });
      const status = issues.some(({ severity }) => severity === "BLOCKER") ? "BLOCKED" as const : "READY" as const;
      const draft = await tx.listingDraft.upsert({
        where: { partId_marketplace: { partId: part.id, marketplace: input.marketplace } },
        update: {},
        create: {
          organizationId: input.organizationId,
          partId: part.id,
          marketplace: input.marketplace,
          ...values,
          aspects: asJson(values.aspects),
          status,
          validationIssues: asJson(issues),
          validatedAt: new Date(),
          createdById: input.userId,
          updatedById: input.userId,
        },
      });
      const hasVersion = await tx.listingDraftVersion.count({ where: { listingDraftId: draft.id } });
      if (!hasVersion) {
        await tx.listingDraftVersion.create({
          data: {
            organizationId: input.organizationId,
            listingDraftId: draft.id,
            version: 1,
            snapshot: snapshot(values, status, issues),
            reason: "Draft created from catalog",
            createdById: input.userId,
          },
        });
        await enqueueOutboxEvent(tx, {
          organizationId: input.organizationId,
          topic: "listing.draft.created",
          aggregateType: "ListingDraft",
          aggregateId: draft.id,
          payload: { draftId: draft.id, partId: part.id, marketplace: input.marketplace },
        });
      }
    }
  }, { maxWait: 10_000, timeout: 60_000 });
  return listListingDrafts(input.organizationId, { partIds, marketplace: input.marketplace, limit: 25 });
}

export interface ListingDraftPatch {
  expectedVersion: number;
  reason?: string;
  title?: string;
  description?: string | null;
  categoryId?: string | null;
  condition?: PartCondition;
  ebayCondition?: string | null;
  price?: number | null;
  currency?: string;
  quantity?: number;
  aspects?: Record<string, string[]>;
  paymentPolicyId?: string | null;
  returnPolicyId?: string | null;
  shippingPolicyId?: string | null;
  merchantLocationKey?: string | null;
}

export async function updateListingDraft(organizationId: string, userId: string, draftId: string, input: ListingDraftPatch) {
  const current = await prisma.listingDraft.findFirst({ where: { id: draftId, organizationId }, include: contextInclude });
  if (!current) throw new ListingDraftError("Listing draft not found", 404);
  if (current.version !== input.expectedVersion) throw new ListingDraftError("Listing draft changed; reload it before saving", 409);
  const { expectedVersion: _expectedVersion, reason, ...changes } = input;
  const values = { ...valuesFromDraft(current), ...changes };
  const cached = await getCachedReadinessMetadata(organizationId, current.marketplace as Marketplace, values.categoryId);
  const issues = evaluateListingReadiness(values, {
    ...contextFromDraft(current),
    ...cached,
    ...(current.liveValidatedAt && !cached.sellerResources ? {
      sellerResources: { paymentPolicyIds: new Set(), returnPolicyIds: new Set(), fulfillmentPolicyIds: new Set(), inventoryLocationKeys: new Set() },
    } : {}),
  });
  const status = issues.some(({ severity }) => severity === "BLOCKER") ? "BLOCKED" as const : "READY" as const;
  const nextVersion = current.version + 1;
  await prisma.$transaction(async (tx) => {
    const updated = await tx.listingDraft.updateMany({
      where: { id: draftId, organizationId, version: current.version },
      data: {
        ...changes,
        ...(changes.aspects ? { aspects: asJson(changes.aspects) } : {}),
        status,
        validationIssues: asJson(issues),
        validatedAt: new Date(),
        liveValidatedAt: null,
        updatedById: userId,
        version: nextVersion,
      },
    });
    if (!updated.count) throw new ListingDraftError("Listing draft changed; reload it before saving", 409);
    await tx.listingDraftVersion.create({
      data: {
        organizationId,
        listingDraftId: draftId,
        version: nextVersion,
        snapshot: snapshot(values, status, issues),
        reason: reason?.trim() || "Draft edited",
        createdById: userId,
      },
    });
    await enqueueOutboxEvent(tx, {
      organizationId,
      topic: "listing.draft.updated",
      aggregateType: "ListingDraft",
      aggregateId: draftId,
      payload: { draftId, version: nextVersion, status },
    });
  });
  return getListingDraft(organizationId, draftId);
}

function sellerResourceContext(resources: Awaited<ReturnType<typeof syncSellerResources>>) {
  return {
    paymentPolicyIds: new Set(resources.paymentPolicies.filter(({ enabled }) => enabled).map(({ remoteId }) => remoteId)),
    returnPolicyIds: new Set(resources.returnPolicies.filter(({ enabled }) => enabled).map(({ remoteId }) => remoteId)),
    fulfillmentPolicyIds: new Set(resources.fulfillmentPolicies.filter(({ enabled }) => enabled).map(({ remoteId }) => remoteId)),
    inventoryLocationKeys: new Set(resources.inventoryLocations.filter(({ enabled }) => enabled).map(({ remoteId }) => remoteId)),
  };
}

export async function validateListingDraftLive(organizationId: string, userId: string, draftId: string, expectedVersion: number) {
  const current = await prisma.listingDraft.findFirst({ where: { id: draftId, organizationId }, include: contextInclude });
  if (!current) throw new ListingDraftError("Listing draft not found", 404);
  if (current.version !== expectedVersion) throw new ListingDraftError("Listing draft changed; reload it before validating", 409);
  if (!current.categoryId) throw new ListingDraftError("Set an eBay category ID before live validation");
  const marketplace = current.marketplace as Marketplace;
  const [resources, categoryMetadata] = await Promise.all([
    syncSellerResources(organizationId, marketplace),
    refreshCategoryMetadata(marketplace, current.categoryId),
  ]);
  const values = valuesFromDraft(current);
  const issues = evaluateListingReadiness(values, {
    ...contextFromDraft(current),
    sellerResources: sellerResourceContext(resources),
    categoryRequirements: categoryMetadata.aspects,
    categoryConditions: categoryMetadata.conditions,
  });
  const status = issues.some(({ severity }) => severity === "BLOCKER") ? "BLOCKED" as const : "READY" as const;
  const nextVersion = current.version + 1;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.listingDraft.updateMany({
      where: { id: draftId, organizationId, version: current.version },
      data: {
        status,
        validationIssues: asJson(issues),
        validatedAt: now,
        liveValidatedAt: now,
        updatedById: userId,
        version: nextVersion,
      },
    });
    if (!updated.count) throw new ListingDraftError("Listing draft changed; reload it before validating", 409);
    await tx.listingDraftVersion.create({
      data: {
        organizationId,
        listingDraftId: draftId,
        version: nextVersion,
        snapshot: snapshot(values, status, issues),
        reason: "Validated against live eBay seller resources and category metadata",
        createdById: userId,
      },
    });
    await enqueueOutboxEvent(tx, {
      organizationId,
      topic: "listing.draft.live_validated",
      aggregateType: "ListingDraft",
      aggregateId: draftId,
      payload: { draftId, version: nextVersion, status, marketplace, categoryId: current.categoryId },
    });
  });
  return {
    draft: await getListingDraft(organizationId, draftId),
    resources,
    categoryMetadata,
  };
}

export async function listListingDrafts(
  organizationId: string,
  input: { partIds?: string[]; marketplace?: string; status?: "DRAFT" | "BLOCKED" | "READY"; limit: number },
) {
  const drafts = await prisma.listingDraft.findMany({
    where: {
      organizationId,
      ...(input.partIds?.length ? { partId: { in: input.partIds } } : {}),
      ...(input.marketplace ? { marketplace: input.marketplace } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: input.limit,
    include: { part: { select: { sku: true, primaryPartNumber: true, partName: true } } },
  });
  return drafts.map(serializeDraft);
}

export async function getListingDraft(organizationId: string, draftId: string) {
  const draft = await prisma.listingDraft.findFirst({
    where: { id: draftId, organizationId },
    include: {
      part: { select: { sku: true, primaryPartNumber: true, partName: true } },
      versions: { orderBy: { version: "desc" }, take: 20, select: { id: true, version: true, reason: true, createdAt: true, createdBy: { select: { id: true, email: true, name: true } } } },
    },
  });
  if (!draft) throw new ListingDraftError("Listing draft not found", 404);
  return serializeDraft(draft);
}
