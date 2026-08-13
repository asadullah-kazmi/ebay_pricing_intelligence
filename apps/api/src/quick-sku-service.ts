import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { recordAuditEvent } from "./audit-service.js";
import { prisma } from "./db.js";
import { buildListingDescriptionHtml } from "./domain/listing-description.js";
import { normalizePartNumber } from "./domain/matching.js";
import { buildEbayListingTitle, cleanPartNameForTitle, isWeakPartName, modelFromText, yearRangeFromText } from "./domain/listing-title.js";
import { normalizeFitmentApplications, scoreFitmentCandidate } from "./fitment-service.js";
import { discoverEbayFitment, getEbayProductCompatibilities, isBrowseDerivedEpid, type EbayFitmentDiscovery } from "./providers/ebay-fitment.js";
import { searchEbay } from "./providers/ebay.js";
import { identifyPartWithGemini, type AiPartIdentificationResult } from "./providers/gemini-part-identification.js";
import { queuePartMarketPricing } from "./pricing-service.js";
import { allocateOrganizationSku } from "./sku-policy-service.js";
import type { Marketplace, RawListing } from "./types.js";

export type QuickSkuIdentificationSource = "EBAY" | "AI" | "GENERIC";

export class QuickSkuError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 | 502 = 400) {
    super(message);
    this.name = "QuickSkuError";
  }
}

export type QuickSkuInput = {
  partNumber: string;
  brand: string;
  price: number;
  quantity: number;
  condition?: "NEW" | "USED";
  productSource?: "OEM" | "AFTERMARKET" | "PRIVATE_LABEL";
  marketplace?: Marketplace;
  currency?: string;
};

export type QuickSkuPrepared = {
  identifiedBrand: string;
  partName: string;
  listingTitle: string;
  description: string | null;
  matched: boolean;
  identificationSource: QuickSkuIdentificationSource;
  candidateEpid: string | null;
  candidateScore: number | null;
  matchedOn: string[];
  aspects: Record<string, string[]>;
  placement: string | null;
  categoryId: string | null;
  categoryName: string | null;
  discoverySource: string | null;
  aiModel: string | null;
  aiConfidence: string | null;
  fitmentCount: number;
  fitmentReason: string | null;
  applications: Array<{ fingerprint: string; properties: Record<string, string> }>;
};

export type QuickSkuImageResult = {
  status: "SKIPPED" | "ATTACHED" | "PARTIAL" | "FAILED";
  attachedCount: number;
  requestedCount: number;
  source: "EBAY_BROWSE_API" | null;
  message: string | null;
};

export type QuickSkuIdentifyResult = {
  partNumber: string;
  brand: string;
  marketplace: Marketplace;
  matched: boolean;
  identificationSource: QuickSkuIdentificationSource;
  identifiedBrand: string;
  partName: string;
  placement: string | null;
  best: {
    epid: string;
    title: string;
    score: number;
    matchedOn: string[];
    aspects: Record<string, string[]>;
  } | null;
  discovery: {
    categoryId: string | null;
    categoryName: string | null;
    source: string | null;
  };
  ai: {
    model: string;
    confidence: string;
    partName: string;
    placement: string | null;
    titleHint: string | null;
  } | null;
};

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseQuickSkuBase(input: QuickSkuInput) {
  const partNumber = input.partNumber.trim();
  const brand = input.brand.trim();
  const marketplace = input.marketplace ?? "EBAY_US";
  const condition = input.condition ?? "USED";
  const productSource = input.productSource ?? "OEM";
  const currency = (input.currency ?? "USD").toUpperCase();
  const normalized = normalizePartNumber(partNumber);
  if (!normalized) throw new QuickSkuError("Part number is required");
  if (!brand) throw new QuickSkuError("Brand is required");
  if (!Number.isFinite(input.price) || input.price <= 0) throw new QuickSkuError("Price must be greater than zero");
  if (!Number.isInteger(input.quantity) || input.quantity < 0) throw new QuickSkuError("Quantity must be a non-negative integer");
  return { partNumber, brand, marketplace, condition, productSource, currency, normalized };
}

function partNameFromAspects(aspects: Record<string, string[]>): string | null {
  const preferredKeys = [
    "Type",
    "Part Type",
    "Item Type",
    "Product Type",
    "Part Name",
    "Compatible Part",
  ];
  for (const key of preferredKeys) {
    const match = Object.entries(aspects).find(([name]) => name.toLowerCase() === key.toLowerCase());
    const value = match?.[1]?.[0]?.trim();
    if (value && !isWeakPartName(value)) return value.slice(0, 120);
  }
  return null;
}

function derivePartName(
  title: string,
  brand: string,
  partNumber: string,
  aspects: Record<string, string[]> = {},
) {
  const fromAspects = partNameFromAspects(aspects);
  if (fromAspects) return fromAspects;

  const yearRange = yearRangeFromText(title);
  const model = modelFromText(title);
  const cleaned = cleanPartNameForTitle({
    partName: title,
    brand,
    primaryPartNumber: partNumber,
    extraRemovals: [yearRange, model],
  }).slice(0, 120);
  if (!isWeakPartName(cleaned)) return cleaned;

  // Lighter cleanup when aggressive stripping wiped the useful part words.
  let light = title
    .replace(/\b((?:19|20)\d{2})\s*(?:[-–]|to)\s*((?:19|20)\d{2})\b/gi, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ");
  for (const token of [brand, partNumber, yearRange, model, "OEM", "New", "Used", "Genuine"]) {
    if (!token) continue;
    light = light.replace(new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig"), " ");
  }
  light = light.replace(/[|/·•,;:()[\]]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  if (light && !isWeakPartName(light)) return light;
  return cleaned;
}

function rankCandidates(discovery: EbayFitmentDiscovery, partNumber: string, brand: string) {
  return discovery.candidates
    .map((candidate) => scoreFitmentCandidate(candidate, { partNumber, brand }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      const leftBrowse = isBrowseDerivedEpid(left.epid) ? 1 : 0;
      const rightBrowse = isBrowseDerivedEpid(right.epid) ? 1 : 0;
      if (leftBrowse !== rightBrowse) return leftBrowse - rightBrowse;
      return right.score - left.score;
    });
}

function exactPartNumberMatch(listing: RawListing, normalized: string) {
  const titleMatches = normalizePartNumber(listing.title).includes(normalized);
  const aspectMatches = Object.entries(listing.aspects).some(([name, values]) => {
    const key = name.toLowerCase();
    if (!["manufacturer part number", "mpn", "oe/oem part number", "interchange part number"].includes(key)) return false;
    return values.some((value) => normalizePartNumber(value) === normalized);
  });
  return titleMatches || aspectMatches;
}

function brandMatches(listing: RawListing, brand: string) {
  const normalizedBrand = brand.trim().toLowerCase();
  if (!normalizedBrand) return true;
  if (listing.title.toLowerCase().includes(normalizedBrand)) return true;
  return Object.entries(listing.aspects).some(([name, values]) => {
    if (!["brand", "manufacturer"].includes(name.toLowerCase())) return false;
    return values.some((value) => value.trim().toLowerCase() === normalizedBrand);
  });
}

function scoreImageListing(listing: RawListing, input: { normalizedPartNumber: string; brand: string; condition: "NEW" | "USED" }) {
  if (!listing.imageUrls?.length) return 0;
  if (!exactPartNumberMatch(listing, input.normalizedPartNumber)) return 0;
  let score = 70;
  if (brandMatches(listing, input.brand)) score += 15;
  if (input.condition === "NEW" && /^new/i.test(listing.condition)) score += 5;
  if (input.condition === "USED" && /^used/i.test(listing.condition)) score += 5;
  score += Math.min(listing.imageUrls.length, 6);
  return score;
}

export async function attachAftermarketBrowseImages(input: {
  organizationId: string;
  partId: string;
  partNumber: string;
  brand: string;
  marketplace: Marketplace;
  condition: "NEW" | "USED";
  requestedCount?: number;
}): Promise<QuickSkuImageResult> {
  const requestedCount = input.requestedCount ?? 2;
  const normalized = normalizePartNumber(input.partNumber);
  if (!normalized) return { status: "SKIPPED", attachedCount: 0, requestedCount, source: "EBAY_BROWSE_API", message: "Part number was not usable for image discovery" };

  let listings: RawListing[];
  try {
    listings = await searchEbay(input.partNumber, input.marketplace, input.condition);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Unable to fetch eBay Browse images";
    return { status: "FAILED", attachedCount: 0, requestedCount, source: "EBAY_BROWSE_API", message };
  }

  const ranked = listings
    .map((listing) => ({ listing, score: scoreImageListing(listing, { normalizedPartNumber: normalized, brand: input.brand, condition: input.condition }) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  const selected: Array<{ listing: RawListing; imageUrl: string; score: number }> = [];
  const usedUrls = new Set<string>();
  for (const { listing, score } of ranked) {
    for (const imageUrl of listing.imageUrls ?? []) {
      if (usedUrls.has(imageUrl)) continue;
      usedUrls.add(imageUrl);
      selected.push({ listing, imageUrl, score });
      if (selected.length >= requestedCount) break;
    }
    if (selected.length >= requestedCount) break;
  }

  let displayOrder = await prisma.partMedia.count({ where: { partId: input.partId } });
  let attachedCount = 0;
  for (const [index, candidate] of selected.entries()) {
    const checksum = createHash("sha256").update(candidate.imageUrl).digest("hex");
    const storageKey = `external/ebay-browse/${input.marketplace}/${candidate.listing.id}/${checksum.slice(0, 16)}`;
    const mediaAsset = await prisma.mediaAsset.upsert({
      where: { organizationId_storageKey: { organizationId: input.organizationId, storageKey } },
      create: {
        organizationId: input.organizationId,
        storageKey,
        externalUrl: candidate.imageUrl,
        sourceType: "EBAY_BROWSE_API",
        sourceMetadata: asJson({
          sourceItemId: candidate.listing.id,
          sourceItemWebUrl: candidate.listing.url,
          sourceSellerUsername: candidate.listing.seller,
          sourceMarketplace: input.marketplace,
          matchedPartNumber: input.partNumber,
          matchScore: candidate.score,
        }),
        originalFilename: `${input.partNumber}-${candidate.listing.id}-${index + 1}.jpg`.slice(0, 255),
        mimeType: "image/jpeg",
        byteSize: 0,
        checksum,
        status: "READY",
      },
      update: {
        externalUrl: candidate.imageUrl,
        sourceType: "EBAY_BROWSE_API",
        sourceMetadata: asJson({
          sourceItemId: candidate.listing.id,
          sourceItemWebUrl: candidate.listing.url,
          sourceSellerUsername: candidate.listing.seller,
          sourceMarketplace: input.marketplace,
          matchedPartNumber: input.partNumber,
          matchScore: candidate.score,
        }),
        status: "READY",
      },
    });
    await prisma.partMedia.upsert({
      where: { partId_mediaAssetId: { partId: input.partId, mediaAssetId: mediaAsset.id } },
      create: {
        organizationId: input.organizationId,
        partId: input.partId,
        mediaAssetId: mediaAsset.id,
        displayOrder,
        approved: true,
        altText: `${input.brand} ${input.partNumber} eBay Browse image`,
      },
      update: { approved: true, displayOrder },
    });
    displayOrder += 1;
    attachedCount += 1;
  }

  return {
    status: attachedCount >= requestedCount ? "ATTACHED" : attachedCount > 0 ? "PARTIAL" : "FAILED",
    attachedCount,
    requestedCount,
    source: "EBAY_BROWSE_API",
    message: attachedCount >= requestedCount ? null : `Only ${attachedCount} matching eBay image${attachedCount === 1 ? "" : "s"} found`,
  };
}

const skippedImageResult: QuickSkuImageResult = {
  status: "SKIPPED",
  attachedCount: 0,
  requestedCount: 0,
  source: null,
  message: null,
};

function toAiPayload(result: AiPartIdentificationResult) {
  return {
    model: result.model,
    confidence: result.confidence,
    partName: result.partName,
    placement: result.placement,
    titleHint: result.titleHint,
  };
}

export async function identifyQuickSkuPart(
  organizationId: string,
  input: Pick<QuickSkuInput, "partNumber" | "brand" | "marketplace">,
): Promise<QuickSkuIdentifyResult> {
  const { partNumber, brand, marketplace } = parseQuickSkuBase({
    ...input,
    price: 1,
    quantity: 1,
  });

  let discovery: EbayFitmentDiscovery;
  try {
    discovery = await discoverEbayFitment(
      { partNumber, brand, partName: null },
      marketplace,
      { organizationId },
    );
  } catch (error) {
    console.warn(JSON.stringify({
      type: "quick_sku_identification_failed",
      organizationId,
      partNumber,
      marketplace,
      error: error instanceof Error ? error.message : "unknown",
    }));
    discovery = { categoryId: null, categoryName: null, candidates: [], source: "browse" };
  }

  const best = rankCandidates(discovery, partNumber, brand)[0] ?? null;
  const identifiedBrand = best?.brand?.trim() || brand;
  const partName = best
    ? derivePartName(best.title, identifiedBrand, partNumber, best.aspects)
    : `${brand} Automotive Part`;

  return {
    partNumber,
    brand,
    marketplace,
    matched: Boolean(best),
    identificationSource: best ? "EBAY" : "GENERIC",
    identifiedBrand,
    partName,
    placement: null,
    best: best
      ? {
          epid: best.epid,
          title: best.title,
          score: best.score,
          matchedOn: best.matchedOn,
          aspects: best.aspects,
        }
      : null,
    discovery: {
      categoryId: discovery.categoryId,
      categoryName: discovery.categoryName,
      source: discovery.source ?? null,
    },
    ai: null,
  };
}

export function needsAiPartNameEnhancement(identify: Pick<QuickSkuIdentifyResult, "identificationSource" | "partName" | "matched">): boolean {
  if (identify.identificationSource === "AI") return false;
  if (!identify.matched) return true;
  return isWeakPartName(identify.partName);
}

export async function enhanceQuickSkuWithAi(
  identify: QuickSkuIdentifyResult,
  input: Pick<QuickSkuInput, "condition"> = {},
): Promise<QuickSkuIdentifyResult> {
  if (!needsAiPartNameEnhancement(identify)) return identify;

  const ai = await identifyPartWithGemini({
    partNumber: identify.partNumber,
    brand: identify.identifiedBrand || identify.brand,
    condition: input.condition ?? "USED",
    marketplace: identify.marketplace,
    sourceTitle: identify.best?.title ?? null,
  });
  if (!ai || isWeakPartName(ai.partName)) return identify;

  return {
    ...identify,
    // Keep eBay epid/fitment when present; AI only fills the missing part name.
    identificationSource: identify.matched ? "EBAY" : "AI",
    partName: ai.partName,
    placement: identify.placement ?? ai.placement,
    ai: toAiPayload(ai),
  };
}

export async function fetchQuickSkuFitment(
  organizationId: string,
  input: Pick<QuickSkuInput, "partNumber" | "brand" | "marketplace"> & { epid: string | null },
) {
  const { partNumber, brand, marketplace } = parseQuickSkuBase({
    ...input,
    price: 1,
    quantity: 1,
  });

  let applications: Array<{ fingerprint: string; properties: Record<string, string> }> = [];
  let fitmentReason: string | null = null;

  if (!input.epid) {
    fitmentReason = "no_matching_catalog_product";
  } else if (isBrowseDerivedEpid(input.epid)) {
    fitmentReason = "identified_from_browse_listing";
  } else {
    try {
      const compatibility = await getEbayProductCompatibilities(input.epid, marketplace, { organizationId });
      applications = normalizeFitmentApplications(compatibility.applications);
      if (!applications.length) fitmentReason = "ebay_returned_no_vehicle_applications";
    } catch (error) {
      fitmentReason = error instanceof Error ? error.message : "compatibility_lookup_failed";
      console.warn(JSON.stringify({
        type: "quick_sku_fitment_failed",
        organizationId,
        partNumber,
        marketplace,
        epid: input.epid,
        error: fitmentReason,
      }));
    }
  }

  return {
    partNumber,
    brand,
    marketplace,
    applications,
    fitmentCount: applications.length,
    fitmentReason,
  };
}

export function buildQuickSkuListingTitle(input: {
  partNumber: string;
  brand: string;
  condition: "NEW" | "USED";
  identifiedBrand: string;
  partName: string;
  applications: Array<{ properties: Record<string, string> }>;
  aspects?: Record<string, string[]>;
  sourceTitle?: string | null;
  placement?: string | null;
}) {
  const listingTitle = buildEbayListingTitle({
    brand: input.identifiedBrand,
    partName: input.partName,
    primaryPartNumber: input.partNumber,
    condition: input.condition,
    fitmentApplications: input.applications.map(({ properties }) => properties),
    aspects: input.aspects,
    sourceTitle: input.sourceTitle ?? null,
    placement: input.placement ?? null,
  });

  return { listingTitle };
}

export function assembleQuickSkuPrepared(input: {
  identify: QuickSkuIdentifyResult;
  fitment: {
    applications: Array<{ fingerprint: string; properties: Record<string, string> }>;
    fitmentCount: number;
    fitmentReason: string | null;
  };
  condition: "NEW" | "USED";
}): QuickSkuPrepared {
  const { identify, fitment, condition } = input;
  const { listingTitle } = buildQuickSkuListingTitle({
    partNumber: identify.partNumber,
    brand: identify.brand,
    condition,
    identifiedBrand: identify.identifiedBrand,
    partName: identify.partName,
    applications: fitment.applications,
    aspects: identify.best?.aspects,
    sourceTitle: identify.best?.title ?? identify.ai?.titleHint ?? null,
    placement: identify.placement,
  });
  const description = buildListingDescriptionHtml({
    title: listingTitle,
    partName: identify.partName,
    primaryPartNumber: identify.partNumber,
    condition,
    brand: identify.identifiedBrand,
    fitmentApplications: fitment.applications.map(({ properties }) => properties),
  });

  return {
    identifiedBrand: identify.identifiedBrand,
    partName: identify.partName,
    listingTitle,
    description,
    matched: identify.matched,
    identificationSource: identify.identificationSource,
    candidateEpid: identify.best?.epid ?? null,
    candidateScore: identify.best?.score ?? null,
    matchedOn: identify.best?.matchedOn ?? [],
    aspects: identify.best?.aspects ?? {},
    placement: identify.placement,
    categoryId: identify.discovery.categoryId,
    categoryName: identify.discovery.categoryName,
    discoverySource: identify.discovery.source,
    aiModel: identify.ai?.model ?? null,
    aiConfidence: identify.ai?.confidence ?? null,
    fitmentCount: fitment.fitmentCount,
    fitmentReason: fitment.fitmentReason,
    applications: fitment.applications,
  };
}

async function persistQuickSkuPart(
  organizationId: string,
  userId: string,
  input: QuickSkuInput,
  prepared: QuickSkuPrepared,
  requestId?: string,
) {
  const { partNumber, brand, marketplace, condition, productSource, currency, normalized } = parseQuickSkuBase(input);
  return prisma.$transaction(async (tx) => {
    const { sku, normalizedSku } = await allocateOrganizationSku(tx, organizationId, partNumber);
    const part = await tx.part.create({
      data: {
        organizationId,
        sku,
        normalizedSku,
        primaryPartNumber: partNumber,
        normalizedPartNumber: normalized,
        brand: prepared.identifiedBrand,
        partName: prepared.partName,
        description: prepared.description,
        condition,
        productSource: productSource as "OEM" | "AFTERMARKET",
        status: "READY_FOR_ENRICHMENT",
        notes: prepared.identificationSource === "EBAY"
          ? `Quick SKU identified via eBay ${prepared.discoverySource ?? "catalog"} (${prepared.candidateEpid})${prepared.categoryName ? ` · ${prepared.categoryName}` : ""}${prepared.aiModel ? ` · part name filled by AI (${prepared.aiModel})` : ""}`
          : prepared.identificationSource === "AI"
            ? `Quick SKU AI-suggested via ${prepared.aiModel ?? "Gemini"}${prepared.aiConfidence ? ` · confidence ${prepared.aiConfidence}` : ""} — review recommended`
            : "Quick SKU created without a confident eBay catalog or AI match",
        createdById: userId,
        partNumbers: {
          create: [{
            organizationId,
            type: "PRIMARY",
            value: partNumber,
            normalizedValue: normalized,
          }],
        },
        inventoryItem: {
          create: {
            organizationId,
            quantity: input.quantity,
            cost: new Prisma.Decimal(input.price.toFixed(2)),
            currency,
          },
        },
      },
      select: {
        id: true,
        sku: true,
        primaryPartNumber: true,
        brand: true,
        partName: true,
        description: true,
        condition: true,
        status: true,
        createdAt: true,
        inventoryItem: { select: { quantity: true, cost: true, currency: true } },
      },
    });

    if (prepared.applications.length) {
      await tx.fitmentApplication.createMany({
        data: prepared.applications.map(({ fingerprint, properties }) => ({
          organizationId,
          partId: part.id,
          marketplace,
          source: "EBAY_CATALOG",
          status: "APPROVED",
          fingerprint,
          properties: asJson(properties),
          notes: prepared.candidateEpid ? `Auto-applied from Quick SKU identification (${prepared.candidateEpid})` : null,
          createdById: userId,
          approvedById: userId,
          approvedAt: new Date(),
          decisionReason: "Approved during Quick SKU upload",
        })),
      });
    }

    const aspects = {
      ...prepared.aspects,
      "Manufacturer Part Number": [partNumber],
      Brand: [prepared.identifiedBrand],
      ...(prepared.placement ? { Placement: [prepared.placement] } : {}),
    };
    const validationIssues = [
      { code: "IMAGES_REQUIRED", severity: "BLOCKER", field: "images", message: "Add approved listing images" },
      { code: "POLICIES_REQUIRED", severity: "BLOCKER", field: "policies", message: "Assign eBay business policies" },
    ];
    const draft = await tx.listingDraft.create({
      data: {
        organizationId,
        partId: part.id,
        marketplace,
        status: "BLOCKED",
        title: prepared.listingTitle,
        description: prepared.description,
        categoryId: prepared.categoryId,
        condition,
        ebayCondition: condition === "NEW" ? "NEW" : null,
        price: new Prisma.Decimal(input.price.toFixed(2)),
        currency,
        quantity: input.quantity,
        aspects: asJson(aspects),
        validationIssues: asJson(validationIssues),
        validatedAt: new Date(),
        createdById: userId,
        updatedById: userId,
      },
    });
    await tx.listingDraftVersion.create({
      data: {
        organizationId,
        listingDraftId: draft.id,
        version: 1,
        snapshot: asJson({
          title: prepared.listingTitle,
          description: prepared.description,
          categoryId: prepared.categoryId,
          condition,
          price: input.price,
          currency,
          quantity: input.quantity,
          aspects,
          status: "BLOCKED",
          validationIssues,
        }),
        reason: "Created by Quick SKU catalog intake",
        createdById: userId,
      },
    });

    await recordAuditEvent(tx, {
      organizationId,
      actorType: "USER",
      actorUserId: userId,
      action: "PART_QUICK_SKU_CREATED",
      resourceType: "Part",
      resourceId: part.id,
      severity: "INFO",
      summary: `Quick SKU ${part.sku} created for ${part.primaryPartNumber}`,
      metadata: {
        partId: part.id,
        sku: part.sku,
        partNumber,
        brand: prepared.identifiedBrand,
        marketplace,
        identified: prepared.matched,
        identificationSource: prepared.identificationSource,
        discoverySource: prepared.discoverySource,
        candidateEpid: prepared.candidateEpid,
        aiModel: prepared.aiModel,
        fitmentCount: prepared.fitmentCount,
        requestId: requestId ?? null,
      },
      requestId,
    });

    return part;
  }, { maxWait: 10_000, timeout: 60_000 });
}

type PersistedQuickSkuPart = Prisma.PromiseReturnType<typeof persistQuickSkuPart> & {
  inventoryItem: { quantity: number; cost: Prisma.Decimal; currency: string } | null;
};

function toQuickSkuResponse(
  created: PersistedQuickSkuPart,
  prepared: QuickSkuPrepared,
  marketplace: Marketplace,
  pricing: Awaited<ReturnType<typeof queuePartMarketPricing>>,
  images: QuickSkuImageResult = skippedImageResult,
) {
  return {
    part: {
      ...created,
      inventoryItem: created.inventoryItem
        ? { ...created.inventoryItem, cost: Number(created.inventoryItem.cost) }
        : null,
    },
    identification: {
      matched: prepared.matched,
      source: prepared.identificationSource,
      discoverySource: prepared.discoverySource,
      title: prepared.listingTitle,
      brand: prepared.identifiedBrand,
      partName: prepared.partName,
      placement: prepared.placement,
      categoryId: prepared.categoryId,
      categoryName: prepared.categoryName,
      epid: prepared.candidateEpid,
      score: prepared.candidateScore,
      matchedOn: prepared.matchedOn,
      aspects: prepared.aspects,
      aiModel: prepared.aiModel,
      aiConfidence: prepared.aiConfidence,
      fitmentCount: prepared.fitmentCount,
      fitmentReason: prepared.fitmentReason,
      marketplace,
    },
    pricing: "jobId" in pricing
      ? { jobId: pricing.jobId, status: "QUEUED" as const }
      : { status: "SKIPPED" as const, reason: pricing.reason },
    images,
  };
}

export async function finalizeQuickSku(
  organizationId: string,
  userId: string,
  input: QuickSkuInput,
  prepared: QuickSkuPrepared,
  requestId?: string,
) {
  const { marketplace, condition, productSource } = parseQuickSkuBase(input);
  try {
    const created = await persistQuickSkuPart(organizationId, userId, input, prepared, requestId);
    let images = skippedImageResult;
    if (productSource === "AFTERMARKET" || productSource === "PRIVATE_LABEL") {
      images = await attachAftermarketBrowseImages({
        organizationId,
        partId: created.id,
        partNumber: input.partNumber,
        brand: prepared.identifiedBrand || input.brand,
        marketplace,
        condition,
        requestedCount: 2,
      });
      if (images.attachedCount < 2) {
        await prisma.part.updateMany({
          where: { id: created.id, organizationId },
          data: { status: "NEEDS_IMAGES" },
        });
      }
    }
    let pricing: Awaited<ReturnType<typeof queuePartMarketPricing>>;
    try {
      pricing = await queuePartMarketPricing(organizationId, userId, {
        partIds: [created.id],
        marketplace,
        conditionMode: "MATCH_PART",
      });
    } catch (pricingError) {
      // Catalog write already committed — don't fail Quick SKU because pricing queue timed out.
      const reason = pricingError instanceof Error
        ? pricingError.message.slice(0, 300)
        : "Unable to queue market pricing";
      pricing = { skipped: true, reason };
    }
    return toQuickSkuResponse(created, prepared, marketplace, pricing, images);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new QuickSkuError("A catalog part with this SKU or part number already exists", 409);
    }
    throw error;
  }
}

export async function createQuickSku(
  organizationId: string,
  userId: string,
  input: QuickSkuInput,
  requestId?: string,
) {
  const { condition } = parseQuickSkuBase(input);
  const identified = await identifyQuickSkuPart(organizationId, input);
  const identify = await enhanceQuickSkuWithAi(identified, { condition });
  const fitment = await fetchQuickSkuFitment(organizationId, {
    partNumber: input.partNumber,
    brand: input.brand,
    marketplace: input.marketplace,
    epid: identify.best?.epid ?? null,
  });
  const prepared = assembleQuickSkuPrepared({ identify, fitment, condition });
  return finalizeQuickSku(organizationId, userId, input, prepared, requestId);
}
