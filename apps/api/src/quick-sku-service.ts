import { Prisma } from "@prisma/client";
import { recordAuditEvent } from "./audit-service.js";
import { prisma } from "./db.js";
import { normalizePartNumber } from "./domain/matching.js";
import { buildEbayListingTitle } from "./domain/listing-title.js";
import { normalizeFitmentApplications, scoreFitmentCandidate } from "./fitment-service.js";
import { discoverEbayFitment, getEbayProductCompatibilities, isBrowseDerivedEpid, type EbayFitmentDiscovery } from "./providers/ebay-fitment.js";
import { queuePartMarketPricing } from "./pricing-service.js";
import type { Marketplace } from "./types.js";

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
  marketplace?: Marketplace;
  currency?: string;
};

export type QuickSkuPrepared = {
  identifiedBrand: string;
  partName: string;
  listingTitle: string;
  description: string | null;
  matched: boolean;
  candidateEpid: string | null;
  candidateScore: number | null;
  matchedOn: string[];
  aspects: Record<string, string[]>;
  categoryId: string | null;
  categoryName: string | null;
  discoverySource: string | null;
  fitmentCount: number;
  fitmentReason: string | null;
  applications: Array<{ fingerprint: string; properties: Record<string, string> }>;
};

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseQuickSkuBase(input: QuickSkuInput) {
  const partNumber = input.partNumber.trim();
  const brand = input.brand.trim();
  const marketplace = input.marketplace ?? "EBAY_US";
  const condition = input.condition ?? "USED";
  const currency = (input.currency ?? "USD").toUpperCase();
  const normalized = normalizePartNumber(partNumber);
  if (!normalized) throw new QuickSkuError("Part number is required");
  if (!brand) throw new QuickSkuError("Brand is required");
  if (!Number.isFinite(input.price) || input.price <= 0) throw new QuickSkuError("Price must be greater than zero");
  if (!Number.isInteger(input.quantity) || input.quantity < 0) throw new QuickSkuError("Quantity must be a non-negative integer");
  return { partNumber, brand, marketplace, condition, currency, normalized };
}

function buildSku(brand: string, partNumber: string) {
  const brandCode = brand.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8) || "OEM";
  const number = normalizePartNumber(partNumber);
  return `${brandCode}-${number}`.slice(0, 100);
}

function derivePartName(title: string, brand: string, partNumber: string) {
  let name = title;
  const patterns = [
    new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig"),
    new RegExp(partNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"),
    new RegExp(normalizePartNumber(partNumber), "ig"),
    /\bOEM\b/gi,
    /\bNew\b/gi,
    /\bUsed\b/gi,
  ];
  for (const pattern of patterns) name = name.replace(pattern, " ");
  name = name.replace(/[|/·•]+/g, " ").replace(/\s+/g, " ").trim();
  return name.slice(0, 120) || title.slice(0, 120);
}

function aspectsToDescription(aspects: Record<string, string[]>, categoryName: string | null) {
  const lines = Object.entries(aspects)
    .slice(0, 20)
    .map(([name, values]) => `${name}: ${values.join(", ")}`);
  if (categoryName) lines.unshift(`Category: ${categoryName}`);
  return lines.join("\n").slice(0, 4000) || null;
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

async function allocateUniqueSku(organizationId: string, preferred: string) {
  const base = preferred.slice(0, 90);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const sku = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const normalizedSku = sku.toUpperCase();
    const existing = await prisma.part.findFirst({
      where: { organizationId, normalizedSku },
      select: { id: true },
    });
    if (!existing) return { sku, normalizedSku };
  }
  throw new QuickSkuError("Unable to allocate a unique SKU for this part number", 409);
}

export async function identifyQuickSkuPart(
  organizationId: string,
  input: Pick<QuickSkuInput, "partNumber" | "brand" | "marketplace">,
) {
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
  const partName = best ? derivePartName(best.title, identifiedBrand, partNumber) : `${brand} Automotive Part`;

  return {
    partNumber,
    brand,
    marketplace,
    matched: Boolean(best),
    identifiedBrand,
    partName,
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
}) {
  const listingTitle = buildEbayListingTitle({
    brand: input.identifiedBrand,
    partName: input.partName,
    primaryPartNumber: input.partNumber,
    condition: input.condition,
    fitmentApplications: input.applications.map(({ properties }) => properties),
    aspects: input.aspects,
    sourceTitle: input.sourceTitle ?? null,
  });

  return { listingTitle };
}

export function assembleQuickSkuPrepared(input: {
  identify: Awaited<ReturnType<typeof identifyQuickSkuPart>>;
  fitment: Awaited<ReturnType<typeof fetchQuickSkuFitment>>;
  condition: "NEW" | "USED";
}): QuickSkuPrepared {
  const { identify, fitment, condition } = input;
  const description = identify.best
    ? aspectsToDescription(identify.best.aspects, identify.discovery.categoryName)
    : `Quick SKU created for ${identify.brand} ${identify.partNumber}`;
  const { listingTitle } = buildQuickSkuListingTitle({
    partNumber: identify.partNumber,
    brand: identify.brand,
    condition,
    identifiedBrand: identify.identifiedBrand,
    partName: identify.partName,
    applications: fitment.applications,
    aspects: identify.best?.aspects,
    sourceTitle: identify.best?.title ?? null,
  });

  return {
    identifiedBrand: identify.identifiedBrand,
    partName: identify.partName,
    listingTitle,
    description,
    matched: identify.matched,
    candidateEpid: identify.best?.epid ?? null,
    candidateScore: identify.best?.score ?? null,
    matchedOn: identify.best?.matchedOn ?? [],
    aspects: identify.best?.aspects ?? {},
    categoryId: identify.discovery.categoryId,
    categoryName: identify.discovery.categoryName,
    discoverySource: identify.discovery.source,
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
  const { partNumber, brand, marketplace, condition, currency, normalized } = parseQuickSkuBase(input);
  const preferredSku = buildSku(prepared.identifiedBrand, partNumber);
  const { sku, normalizedSku } = await allocateUniqueSku(organizationId, preferredSku);

  return prisma.$transaction(async (tx) => {
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
        status: "READY_FOR_ENRICHMENT",
        notes: prepared.matched
          ? `Quick SKU identified via eBay ${prepared.discoverySource ?? "catalog"} (${prepared.candidateEpid})${prepared.categoryName ? ` · ${prepared.categoryName}` : ""}`
          : "Quick SKU created without a confident eBay catalog match",
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
        candidateEpid: prepared.candidateEpid,
        fitmentCount: prepared.fitmentCount,
        requestId: requestId ?? null,
      },
      requestId,
    });

    return part;
  }, { maxWait: 10_000, timeout: 60_000 });
}

function toQuickSkuResponse(
  created: Awaited<ReturnType<typeof persistQuickSkuPart>>,
  prepared: QuickSkuPrepared,
  marketplace: Marketplace,
  pricing: Awaited<ReturnType<typeof queuePartMarketPricing>>,
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
      title: prepared.listingTitle,
      brand: prepared.identifiedBrand,
      partName: prepared.partName,
      categoryId: prepared.categoryId,
      categoryName: prepared.categoryName,
      epid: prepared.candidateEpid,
      score: prepared.candidateScore,
      matchedOn: prepared.matchedOn,
      aspects: prepared.aspects,
      fitmentCount: prepared.fitmentCount,
      fitmentReason: prepared.fitmentReason,
      marketplace,
    },
    pricing: "jobId" in pricing
      ? { jobId: pricing.jobId, status: "QUEUED" as const }
      : { status: "SKIPPED" as const, reason: pricing.reason },
  };
}

export async function finalizeQuickSku(
  organizationId: string,
  userId: string,
  input: QuickSkuInput,
  prepared: QuickSkuPrepared,
  requestId?: string,
) {
  const { marketplace } = parseQuickSkuBase(input);
  try {
    const created = await persistQuickSkuPart(organizationId, userId, input, prepared, requestId);
    const pricing = await queuePartMarketPricing(organizationId, userId, {
      partIds: [created.id],
      marketplace,
      conditionMode: "MATCH_PART",
    });
    return toQuickSkuResponse(created, prepared, marketplace, pricing);
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
  const identify = await identifyQuickSkuPart(organizationId, input);
  const fitment = await fetchQuickSkuFitment(organizationId, {
    partNumber: input.partNumber,
    brand: input.brand,
    marketplace: input.marketplace,
    epid: identify.best?.epid ?? null,
  });
  const prepared = assembleQuickSkuPrepared({ identify, fitment, condition });
  return finalizeQuickSku(organizationId, userId, input, prepared, requestId);
}
