import { Prisma } from "@prisma/client";
import { recordAuditEvent } from "./audit-service.js";
import { prisma } from "./db.js";
import { normalizePartNumber } from "./domain/matching.js";
import { normalizeFitmentApplications, scoreFitmentCandidate } from "./fitment-service.js";
import { discoverEbayFitment, getEbayProductCompatibilities } from "./providers/ebay-fitment.js";
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

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
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

export async function createQuickSku(
  organizationId: string,
  userId: string,
  input: QuickSkuInput,
  requestId?: string,
) {
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

  let discovery;
  try {
    discovery = await discoverEbayFitment(
      { partNumber, brand, partName: null },
      marketplace,
      { organizationId },
    );
  } catch (error) {
    // Identification is best-effort; still create the SKU from the submitted OEM/brand.
    console.warn(JSON.stringify({
      type: "quick_sku_identification_failed",
      organizationId,
      partNumber,
      marketplace,
      error: error instanceof Error ? error.message : "unknown",
    }));
    discovery = { categoryId: null, categoryName: null, candidates: [], source: "browse" as const };
  }

  const ranked = discovery.candidates
    .map((candidate) => scoreFitmentCandidate(candidate, { partNumber, brand }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  const best = ranked[0] ?? null;

  let applications: Array<{ fingerprint: string; properties: Record<string, string> }> = [];
  if (best) {
    try {
      const compatibility = await getEbayProductCompatibilities(best.epid, marketplace, { organizationId });
      applications = normalizeFitmentApplications(compatibility.applications);
    } catch {
      applications = [];
    }
  }

  const identifiedTitle = best?.title?.trim() || `${condition === "USED" ? "OEM" : "New"} ${brand} ${partNumber}`;
  const identifiedBrand = best?.brand?.trim() || brand;
  const partName = best ? derivePartName(best.title, identifiedBrand, partNumber) : `${brand} Automotive Part`;
  const description = best
    ? aspectsToDescription(best.aspects, discovery.categoryName)
    : `Quick SKU created for ${brand} ${partNumber}`;
  const preferredSku = buildSku(identifiedBrand, partNumber);
  const { sku, normalizedSku } = await allocateUniqueSku(organizationId, preferredSku);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const part = await tx.part.create({
        data: {
          organizationId,
          sku,
          normalizedSku,
          primaryPartNumber: partNumber,
          normalizedPartNumber: normalized,
          brand: identifiedBrand,
          partName,
          description,
          condition,
          status: "READY_FOR_ENRICHMENT",
          notes: best
            ? `Quick SKU identified via eBay ${discovery.source ?? "catalog"} (${best.epid})${discovery.categoryName ? ` · ${discovery.categoryName}` : ""}`
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

      if (applications.length) {
        await tx.fitmentApplication.createMany({
          data: applications.map(({ fingerprint, properties }) => ({
            organizationId,
            partId: part.id,
            marketplace,
            source: "EBAY_CATALOG",
            status: "APPROVED",
            fingerprint,
            properties: asJson(properties),
            notes: best ? `Auto-applied from Quick SKU identification (${best.epid})` : null,
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
          brand: identifiedBrand,
          marketplace,
          identified: Boolean(best),
          candidateEpid: best?.epid ?? null,
          fitmentCount: applications.length,
          requestId: requestId ?? null,
        },
        requestId,
      });

      return part;
    }, { maxWait: 10_000, timeout: 60_000 });

    return {
      part: {
        ...created,
        inventoryItem: created.inventoryItem
          ? {
              ...created.inventoryItem,
              cost: Number(created.inventoryItem.cost),
            }
          : null,
      },
      identification: {
        matched: Boolean(best),
        title: identifiedTitle,
        brand: identifiedBrand,
        partName,
        categoryId: discovery.categoryId,
        categoryName: discovery.categoryName,
        epid: best?.epid ?? null,
        score: best?.score ?? null,
        matchedOn: best?.matchedOn ?? [],
        aspects: best?.aspects ?? {},
        fitmentCount: applications.length,
        marketplace,
      },
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new QuickSkuError("A catalog part with this SKU or part number already exists", 409);
    }
    throw error;
  }
}
