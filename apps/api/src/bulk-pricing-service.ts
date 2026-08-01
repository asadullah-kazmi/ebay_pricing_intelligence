import { parse as parseCsv } from "csv-parse/sync";
import { Prisma, type PricingJobItemStatus, type PricingJobStatus } from "@prisma/client";
import { getConfig } from "./config.js";
import { prisma } from "./db.js";
import { calculateAnalytics } from "./domain/analytics.js";
import { normalizePartNumber } from "./domain/matching.js";
import { inlineJobOptions, runWithRetry, type JobRunOptions } from "./job-runtime.js";
import { calculateGovernedPrice, getOrganizationPricingRule } from "./pricing-governance-service.js";
import { selectExactCompetitors } from "./pricing-service.js";
import { searchEbay } from "./providers/ebay.js";
import type { ListingCondition, Marketplace, MatchedListing } from "./types.js";

export const bulkPricingTemplateFilename = "partpulse-bulk-pricing-template.csv";

export class BulkPricingError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "BulkPricingError";
  }
}

export type BulkPricingRowInput = {
  rowNumber: number;
  sku: string;
  partNumber: string;
  brand: string;
  costPrice: number;
  currency: string;
  condition: ListingCondition;
  notes: string | null;
};

type BulkCompetitor = {
  listingId: string;
  title: string;
  seller: string;
  price: number;
  shipping: number;
  currency: string;
  condition: string;
  marketplace: Marketplace;
  url: string;
  matchedOn: string[];
};

const activeJobs = new Set<string>();

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function marketplaceCurrency(marketplace: Marketplace) {
  if (marketplace === "EBAY_GB") return "GBP";
  if (marketplace === "EBAY_DE") return "EUR";
  return "USD";
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

const headerAliases: Record<string, string> = {
  sku: "sku",
  partnumber: "partNumber",
  partno: "partNumber",
  partnum: "partNumber",
  oem: "partNumber",
  mpn: "partNumber",
  brand: "brand",
  costprice: "costPrice",
  cost: "costPrice",
  currency: "currency",
  condition: "condition",
  notes: "notes",
  note: "notes",
};

function parseCondition(value: string | undefined, fallback: ListingCondition): ListingCondition {
  const raw = (value ?? "").trim().toUpperCase();
  if (!raw) return fallback;
  if (raw === "NEW" || raw === "USED" || raw === "ANY") return raw;
  throw new BulkPricingError(`Invalid Condition "${value}". Use NEW, USED, or ANY.`);
}

function parseCost(value: string) {
  const raw = value.trim().replace(/[$,]/g, "");
  if (!/^(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? money(parsed) : null;
}

function generatedSku(brand: string, partNumber: string, rowNumber: number) {
  const base = [brand, partNumber]
    .join("-")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 88);
  return `${base || "PART"}-${rowNumber.toString().padStart(3, "0")}`;
}

export function createBulkPricingTemplateCsv() {
  return [
    "PartNumber,Brand,CostPrice,Notes",
    "8K0615301M,Audi,45.00,Example rear caliper",
    "34116791244,BMW,62.50,",
  ].join("\n");
}

export function parseBulkPricingCsv(
  content: string,
  defaults: { marketplace: Marketplace; condition: ListingCondition; currency?: string },
): BulkPricingRowInput[] {
  const records = parseCsv(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Array<Record<string, string>>;

  if (!records.length) throw new BulkPricingError("The sheet has no data rows.");
  const defaultCurrency = (defaults.currency || marketplaceCurrency(defaults.marketplace)).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(defaultCurrency)) throw new BulkPricingError("Currency must be a 3-letter code.");
  const rows: BulkPricingRowInput[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const mapped: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      const alias = headerAliases[normalizeHeader(key)];
      if (alias) mapped[alias] = String(value ?? "").trim();
    }

    const partNumber = mapped.partNumber ?? "";
    const brand = mapped.brand ?? "";
    const costRaw = mapped.costPrice ?? "";
    const rowLabel = index + 2;

    if (!partNumber || !normalizePartNumber(partNumber)) {
      throw new BulkPricingError(`Row ${rowLabel}: PartNumber is required and must include a letter or number.`);
    }
    if (!brand) throw new BulkPricingError(`Row ${rowLabel}: Brand is required.`);
    const costPrice = parseCost(costRaw);
    if (costPrice === null) throw new BulkPricingError(`Row ${rowLabel}: CostPrice must be a non-negative number.`);

    const sku = mapped.sku || generatedSku(brand, partNumber, index + 1);

    rows.push({
      rowNumber: index + 1,
      sku: sku.slice(0, 100),
      partNumber: partNumber.slice(0, 100),
      brand: brand.slice(0, 100),
      costPrice,
      currency: defaultCurrency,
      condition: parseCondition(undefined, defaults.condition),
      notes: mapped.notes?.slice(0, 500) || null,
    });
  }

  return rows;
}

function numberOrNull(value: Prisma.Decimal | null) {
  return value === null ? null : Number(value.toString());
}

function serializeItem<T extends {
  costPrice: Prisma.Decimal;
  lowest: Prisma.Decimal | null;
  average: Prisma.Decimal | null;
  median: Prisma.Decimal | null;
  highest: Prisma.Decimal | null;
  marketRecommended: Prisma.Decimal | null;
  sellingPrice: Prisma.Decimal | null;
  floorPrice: Prisma.Decimal | null;
  marginPercent: Prisma.Decimal | null;
  competitors?: Prisma.JsonValue | null;
}>(item: T) {
  return {
    ...item,
    costPrice: Number(item.costPrice.toString()),
    lowest: numberOrNull(item.lowest),
    average: numberOrNull(item.average),
    median: numberOrNull(item.median),
    highest: numberOrNull(item.highest),
    marketRecommended: numberOrNull(item.marketRecommended),
    sellingPrice: numberOrNull(item.sellingPrice),
    floorPrice: numberOrNull(item.floorPrice),
    marginPercent: numberOrNull(item.marginPercent),
    competitors: Array.isArray(item.competitors) ? item.competitors : [],
  };
}

function serializeJob<T extends {
  targetMarginPercent?: Prisma.Decimal | null;
  items?: Array<{
    costPrice: Prisma.Decimal;
    lowest: Prisma.Decimal | null;
    average: Prisma.Decimal | null;
    median: Prisma.Decimal | null;
    highest: Prisma.Decimal | null;
    marketRecommended: Prisma.Decimal | null;
    sellingPrice: Prisma.Decimal | null;
    floorPrice: Prisma.Decimal | null;
    marginPercent: Prisma.Decimal | null;
    competitors?: Prisma.JsonValue | null;
  }>;
}>(job: T) {
  return {
    ...job,
    targetMarginPercent: job.targetMarginPercent === undefined ? undefined : numberOrNull(job.targetMarginPercent),
    items: job.items?.map(serializeItem),
  };
}

function ebayListingId(id: string) {
  return id.startsWith("v1|") ? (id.split("|")[1] ?? id) : id;
}

function serializeCompetitors(listings: MatchedListing[]): BulkCompetitor[] {
  return listings.slice(0, 12).map((listing) => ({
    listingId: ebayListingId(listing.id),
    title: listing.title,
    seller: listing.seller,
    price: listing.price,
    shipping: listing.shipping,
    currency: listing.currency,
    condition: listing.condition,
    marketplace: listing.marketplace,
    url: listing.url,
    matchedOn: listing.matchedOn,
  }));
}

async function refreshJobProgress(jobId: string) {
  const items = await prisma.bulkPricingJobItem.findMany({
    where: { bulkPricingJobId: jobId },
    select: { status: true },
  });
  const statuses = items.map(({ status }) => status);
  const completedItems = statuses.filter((status) => status === "COMPLETED").length;
  const noMatchItems = statuses.filter((status) => status === "NO_MATCHES").length;
  const failedItems = statuses.filter((status) => status === "FAILED").length;
  const terminal = statuses.every((status) => status === "COMPLETED" || status === "NO_MATCHES" || status === "FAILED");
  let status: PricingJobStatus = "RUNNING";
  if (terminal) {
    if (failedItems === statuses.length) status = "FAILED";
    else if (failedItems > 0) status = "PARTIAL";
    else status = "COMPLETED";
  }
  await prisma.bulkPricingJob.update({
    where: { id: jobId },
    data: {
      status,
      completedItems,
      noMatchItems,
      failedItems,
      ...(terminal ? { completedAt: new Date() } : {}),
    },
  });
}

async function processBulkItem(
  item: {
    id: string;
    organizationId: string;
    partNumber: string;
    condition: string;
    costPrice: Prisma.Decimal;
    currency: string;
  },
  marketplace: Marketplace,
  rule: Awaited<ReturnType<typeof getOrganizationPricingRule>>,
  options: JobRunOptions,
) {
  await prisma.bulkPricingJobItem.update({
    where: { id: item.id },
    data: { status: "RUNNING", startedAt: new Date(), error: null },
  });
  try {
    const listings = await runWithRetry(async () => {
      const candidates = await searchEbay(item.partNumber, marketplace, item.condition as ListingCondition);
      return selectExactCompetitors(candidates, item.partNumber, getConfig().ownSellers);
    }, options);

    const analytics = calculateAnalytics(listings);
    const completedAt = new Date();
    if (!analytics) {
      await prisma.bulkPricingJobItem.update({
        where: { id: item.id },
        data: {
          status: "NO_MATCHES",
          competitorCount: 0,
          competitors: [],
          completedAt,
        },
      });
      return;
    }

    const governed = calculateGovernedPrice({
      marketRecommendedPrice: analytics.recommendedPrice,
      marketCurrency: analytics.currency,
      costAmount: Number(item.costPrice.toString()),
      costCurrency: item.currency,
      rule,
    });
    const cost = Number(item.costPrice.toString());
    const marginPercent = cost > 0
      ? money(((governed.proposedPrice - cost) / governed.proposedPrice) * 100)
      : null;

    await prisma.bulkPricingJobItem.update({
      where: { id: item.id },
      data: {
        status: "COMPLETED" satisfies PricingJobItemStatus,
        competitorCount: analytics.count,
        lowest: analytics.lowest,
        average: analytics.average,
        median: analytics.median,
        highest: analytics.highest,
        marketRecommended: analytics.recommendedPrice,
        sellingPrice: governed.proposedPrice,
        floorPrice: governed.floorPrice,
        marginPercent,
        competitors: serializeCompetitors(listings) as unknown as Prisma.InputJsonValue,
        error: null,
        completedAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown bulk pricing error";
    await prisma.bulkPricingJobItem.update({
      where: { id: item.id },
      data: { status: "FAILED", error: message, completedAt: new Date() },
    });
  }
}

async function runBulkPricingJob(jobId: string, options: JobRunOptions = inlineJobOptions) {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  try {
    const claimed = await prisma.bulkPricingJob.updateMany({
      where: { id: jobId, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: new Date(), completedAt: null, lastError: null },
    });
    if (!claimed.count) return;

    const job = await prisma.bulkPricingJob.findUnique({
      where: { id: jobId },
      select: {
        organizationId: true,
        marketplace: true,
        targetMarginPercent: true,
        items: {
          where: { status: "QUEUED" },
          orderBy: { rowNumber: "asc" },
          select: {
            id: true,
            organizationId: true,
            partNumber: true,
            condition: true,
            costPrice: true,
            currency: true,
          },
        },
      },
    });
    if (!job) return;

    const baseRule = await getOrganizationPricingRule(job.organizationId);
    const targetMarginPercent = job.targetMarginPercent === null ? baseRule.minimumMarginPercent : Number(job.targetMarginPercent.toString());
    const rule = { ...baseRule, minimumMarginPercent: targetMarginPercent };
    for (const item of job.items) {
      await processBulkItem(item, job.marketplace as Marketplace, rule, options);
      await refreshJobProgress(jobId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown bulk pricing job error";
    await prisma.bulkPricingJob.updateMany({
      where: { id: jobId, status: "RUNNING" },
      data: { status: "FAILED", completedAt: new Date(), lastError: message },
    }).catch(() => undefined);
  } finally {
    activeJobs.delete(jobId);
  }
}

export function startBulkPricingJob(jobId: string, options: JobRunOptions = inlineJobOptions) {
  setImmediate(() => void runBulkPricingJob(jobId, options));
}

export async function createBulkPricingJob(input: {
  organizationId: string;
  userId: string;
  marketplace: Marketplace;
  condition: ListingCondition;
  targetMarginPercent?: number | null;
  rows: BulkPricingRowInput[];
  sourceFilename?: string | null;
}) {
  if (!input.rows.length) throw new BulkPricingError("At least one row is required.");

  const active = await prisma.bulkPricingJob.findFirst({
    where: { organizationId: input.organizationId, status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true },
  });
  if (active) throw new BulkPricingError("Another bulk pricing job is already running for this organization", 409);

  const skus = [...new Set(input.rows.map((row) => row.sku.trim().toUpperCase()))];
  const catalogParts = await prisma.part.findMany({
    where: {
      organizationId: input.organizationId,
      normalizedSku: { in: skus },
      status: { not: "ARCHIVED" },
    },
    select: { id: true, normalizedSku: true },
  });
  const catalogBySku = new Map(catalogParts.map((part) => [part.normalizedSku, part.id]));

  const job = await prisma.bulkPricingJob.create({
    data: {
      organizationId: input.organizationId,
      createdById: input.userId,
      marketplace: input.marketplace,
      defaultCondition: input.condition,
      targetMarginPercent: input.targetMarginPercent ?? null,
      totalItems: input.rows.length,
      sourceFilename: input.sourceFilename?.slice(0, 255) || null,
      items: {
        create: input.rows.map((row) => {
          const catalogPartId = catalogBySku.get(row.sku.trim().toUpperCase()) ?? null;
          return {
            organizationId: input.organizationId,
            rowNumber: row.rowNumber,
            sku: row.sku,
            partNumber: row.partNumber,
            brand: row.brand,
            costPrice: row.costPrice,
            currency: row.currency,
            condition: row.condition,
            notes: row.notes,
            catalogMatch: Boolean(catalogPartId),
            catalogPartId,
          };
        }),
      },
    },
    include: {
      items: { orderBy: { rowNumber: "asc" } },
    },
  });

  if (getConfig().jobs.executionMode === "inline") startBulkPricingJob(job.id);
  return serializeJob(job);
}

export async function getBulkPricingJob(organizationId: string, jobId: string) {
  const job = await prisma.bulkPricingJob.findFirst({
    where: { id: jobId, organizationId },
    include: { items: { orderBy: { rowNumber: "asc" } } },
  });
  if (!job) throw new BulkPricingError("Bulk pricing job not found", 404);
  return serializeJob(job);
}

export async function listBulkPricingJobs(organizationId: string, limit = 20) {
  const jobs = await prisma.bulkPricingJob.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      marketplace: true,
      defaultCondition: true,
      targetMarginPercent: true,
      status: true,
      totalItems: true,
      completedItems: true,
      noMatchItems: true,
      failedItems: true,
      sourceFilename: true,
      lastError: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
    },
  });
  return jobs.map(serializeJob);
}

function csvEscape(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function exportBulkPricingCsv(organizationId: string, jobId: string) {
  const job = await getBulkPricingJob(organizationId, jobId);
  const header = [
    "PartNumber", "Brand", "CostPrice", "Currency", "Condition", "Marketplace",
    "MatchCount", "Lowest", "Median", "Highest", "MarketRecommended", "SellingPrice",
    "FloorPrice", "MarginPercent", "Status", "Error", "CatalogMatch", "Notes",
  ];
  const lines = [header.join(",")];
  for (const item of job.items ?? []) {
    lines.push([
      item.partNumber,
      item.brand,
      item.costPrice,
      item.currency,
      item.condition,
      job.marketplace,
      item.competitorCount,
      item.lowest,
      item.median,
      item.highest,
      item.marketRecommended,
      item.sellingPrice,
      item.floorPrice,
      item.marginPercent,
      item.status,
      item.error,
      item.catalogMatch ? "Yes" : "No",
      item.notes,
    ].map(csvEscape).join(","));
  }
  return lines.join("\n");
}
