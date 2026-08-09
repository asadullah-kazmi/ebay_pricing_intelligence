import { parse as parseCsv } from "csv-parse/sync";
import { Prisma, type PricingJobItemStatus, type PricingJobStatus } from "@prisma/client";
import { getConfig } from "./config.js";
import { prisma } from "./db.js";
import { calculateAnalytics } from "./domain/analytics.js";
import { normalizePartNumber } from "./domain/matching.js";
import { inlineJobOptions, runWithRetry, type JobRunOptions } from "./job-runtime.js";
import {
  calculateFormulaMarginForSellingPrice,
  createDefaultBulkPricingFormula,
  evaluateBulkPricingFormula,
  normalizeBulkPricingFormula,
  type BulkPricingFormula,
} from "./bulk-pricing-formula.js";
import { selectExactCompetitors } from "./pricing-service.js";
import { searchEbay } from "./providers/ebay.js";
import type { ListingCondition, Marketplace, MatchedListing } from "./types.js";

export const bulkPricingTemplateFilename = "partpulse-bulk-pricing-template.csv";
export const bulkPricingRetentionDays = 30;

export function bulkPricingRetentionCutoff(now = new Date()): Date {
  return new Date(now.getTime() - bulkPricingRetentionDays * 86_400_000);
}

export async function cleanupExpiredBulkPricingJobs(now = new Date()): Promise<number> {
  const deleted = await prisma.bulkPricingJob.deleteMany({
    where: { createdAt: { lte: bulkPricingRetentionCutoff(now) } },
  });
  return deleted.count;
}

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
  quantity: number;
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

export type BulkPricingStrategy = "CUSTOM_FORMULA" | "MARKET_MEAN";

const activeJobs = new Set<string>();

export function getActiveBulkPricingJobCount(): number {
  return activeJobs.size;
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateBulkMarginPercent(costPrice: number, sellingPrice: number): number | null {
  if (costPrice < 0 || sellingPrice <= 0) return null;
  return calculateFormulaMarginForSellingPrice(
    costPrice,
    sellingPrice,
    createDefaultBulkPricingFormula({ profitMarginPercent: 0, bufferPercent: 1 }),
  );
}

export function calculateSimpleBulkSellingPrice(input: {
  costPrice: number;
  targetMarginPercent: number;
  bufferPercent?: number;
}) {
  const costPrice = money(Math.max(0, input.costPrice));
  const targetMarginPercent = Math.max(0, Math.min(95, input.targetMarginPercent));
  const bufferPercent = Math.max(0, input.bufferPercent ?? 0);
  const formula = createDefaultBulkPricingFormula({ profitMarginPercent: targetMarginPercent, bufferPercent });
  const calculated = evaluateBulkPricingFormula(costPrice, formula);
  const ebayFee = calculated.breakdown.find((item) => item.kind === "EBAY_FEE_PERCENT")?.amount ?? 0;
  const extraExpenses = money(calculated.expenseImpact - ebayFee);
  const actualProfit = calculated.netProfit;
  const actualProfitPercent = calculated.netMargin;
  const targetProfit = calculated.targetProfit;
  const sellingPrice = calculated.sellingPrice;

  return {
    sellingPrice,
    formulaFloorPrice: sellingPrice,
    targetProfit,
    ebayFee,
    extraExpenses,
    actualProfit,
    actualProfitPercent,
    totalMarginPercent: targetMarginPercent,
  };
}

export function calculateAutomaticMarketPrice(costPrice: number, marketAverage: number) {
  const sellingPrice = money(Math.max(0, marketAverage));
  const marginPercent = sellingPrice > 0
    ? money(((sellingPrice - Math.max(0, costPrice)) / sellingPrice) * 100)
    : null;
  return { sellingPrice, marginPercent };
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
  quantity: "quantity",
  qty: "quantity",
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

function parseQuantity(value: string | undefined) {
  const raw = (value ?? "1").trim().replace(/[,]/g, "");
  if (!raw) return 1;
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
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
    "PartNumber,Brand,CostPrice,Quantity,Notes",
    "8K0615301M,Audi,45.00,3,Example rear caliper",
    "34116791244,BMW,62.50,1,",
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
    const quantity = parseQuantity(mapped.quantity);
    if (quantity === null) throw new BulkPricingError(`Row ${rowLabel}: Quantity must be a whole number.`);

    const sku = mapped.sku || generatedSku(brand, partNumber, index + 1);

    rows.push({
      rowNumber: index + 1,
      sku: sku.slice(0, 100),
      partNumber: partNumber.slice(0, 100),
      brand: brand.slice(0, 100),
      costPrice,
      quantity,
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
  quantity: number;
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
    quantity: item.quantity,
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
  bufferPercent?: Prisma.Decimal | null;
  items?: Array<{
    costPrice: Prisma.Decimal;
    quantity: number;
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
    bufferPercent: job.bufferPercent === undefined ? undefined : numberOrNull(job.bufferPercent),
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
  targetMarginPercent: number,
  bufferPercent: number,
  pricingStrategy: BulkPricingStrategy,
  pricingFormula: BulkPricingFormula | null,
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
    const cost = Number(item.costPrice.toString());
    const formulaPrice = pricingStrategy === "CUSTOM_FORMULA"
      ? (pricingFormula
          ? evaluateBulkPricingFormula(cost, pricingFormula)
          : calculateSimpleBulkSellingPrice({ costPrice: cost, targetMarginPercent, bufferPercent }))
      : null;
    if (!analytics) {
      await prisma.bulkPricingJobItem.update({
        where: { id: item.id },
        data: {
          status: "NO_MATCHES",
          competitorCount: 0,
          sellingPrice: formulaPrice?.sellingPrice ?? null,
          floorPrice: formulaPrice?.formulaFloorPrice ?? null,
          marginPercent: formulaPrice?.actualProfitPercent ?? null,
          competitors: [],
          completedAt,
        },
      });
      return;
    }

    const automaticPrice = pricingStrategy === "MARKET_MEAN"
      ? calculateAutomaticMarketPrice(cost, analytics.average)
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
        marketRecommended: pricingStrategy === "MARKET_MEAN" ? analytics.average : analytics.recommendedPrice,
        sellingPrice: automaticPrice?.sellingPrice ?? formulaPrice?.sellingPrice ?? null,
        floorPrice: formulaPrice?.formulaFloorPrice ?? null,
        marginPercent: automaticPrice?.marginPercent ?? formulaPrice?.actualProfitPercent ?? null,
        competitors: serializeCompetitors(listings) as unknown as Prisma.InputJsonValue,
        error: null,
        completedAt,
      },
    });
  } catch (error) {
    if (isRateLimitError(error)) throw error;
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown bulk pricing error";
    await prisma.bulkPricingJobItem.update({
      where: { id: item.id },
      data: { status: "FAILED", error: message, completedAt: new Date() },
    });
  }
}

function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("429") || msg.includes("rate limit") || msg.includes("request limit");
}

export async function resumeBulkPricingJob(organizationId: string, jobId: string) {
  const job = await prisma.bulkPricingJob.findFirst({
    where: { id: jobId, organizationId, createdAt: { gt: bulkPricingRetentionCutoff() } },
  });
  if (!job) throw new BulkPricingError("Bulk pricing job not found", 404);

  // Reset 429 failed items back to QUEUED for retry
  await prisma.bulkPricingJobItem.updateMany({
    where: {
      bulkPricingJobId: jobId,
      status: "FAILED",
      error: { contains: "429" },
    },
    data: { status: "QUEUED", error: null },
  });

  await prisma.bulkPricingJob.update({
    where: { id: jobId },
    data: {
      status: "QUEUED",
      lastError: null,
      completedAt: null,
    },
  });

  if (getConfig().jobs.executionMode !== "inline") {
    startBulkPricingJob(jobId);
  } else {
    void runBulkPricingJob(jobId);
  }

  return getBulkPricingJob(organizationId, jobId);
}

async function runBulkPricingJob(jobId: string, options: JobRunOptions = inlineJobOptions) {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  try {
    // Guard the claim with a timeout so a hung database call cannot wedge the in-process
    // activeJobs guard forever; the next recovery poll will retry the claim.
    const claimed = await Promise.race([
      prisma.bulkPricingJob.updateMany({
        where: { id: jobId, status: { in: ["QUEUED", "PAUSED" as any] } },
        data: { status: "RUNNING", startedAt: new Date(), completedAt: null, lastError: null },
      }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Bulk pricing job claim timed out")), 30_000);
        timer.unref?.();
      }),
    ]);
    if (!claimed.count) return;

    const job = await prisma.bulkPricingJob.findUnique({
      where: { id: jobId },
      select: {
        organizationId: true,
        marketplace: true,
        targetMarginPercent: true,
        bufferPercent: true,
        pricingStrategy: true,
        pricingFormula: true,
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

    const targetMarginPercent = job.targetMarginPercent === null ? 20 : Number(job.targetMarginPercent.toString());
    const bufferPercent = job.bufferPercent === null ? 0 : Number(job.bufferPercent.toString());
    const pricingFormula = job.pricingFormula === null ? null : normalizeBulkPricingFormula(job.pricingFormula);
    for (const item of job.items) {
      try {
        await processBulkItem(item, job.marketplace as Marketplace, targetMarginPercent, bufferPercent, job.pricingStrategy as BulkPricingStrategy, pricingFormula, options);
        await refreshJobProgress(jobId);
      } catch (err) {
        if (isRateLimitError(err)) {
          await prisma.bulkPricingJobItem.update({
            where: { id: item.id },
            data: { status: "QUEUED", error: null },
          });
          const pauseMsg = "Paused: eBay API rate limit reached (HTTP 429). Please wait before resuming.";
          await prisma.bulkPricingJob.update({
            where: { id: jobId },
            data: {
              status: "PAUSED" as any,
              lastError: pauseMsg,
            },
          });
          await refreshJobProgress(jobId);
          return;
        }
      }
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

export async function startQueuedBulkPricingJobs(options: JobRunOptions = inlineJobOptions): Promise<number> {
  const queued = await prisma.bulkPricingJob.findMany({
    where: { status: "QUEUED" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  queued.forEach(({ id }) => startBulkPricingJob(id, options));
  return queued.length;
}

export async function resumeInterruptedBulkPricingJobs(options: JobRunOptions = inlineJobOptions): Promise<number> {
  const staleBefore = new Date(Date.now() - 30 * 60_000);
  const stale = await prisma.bulkPricingJob.findMany({
    where: {
      status: "RUNNING",
      updatedAt: { lt: staleBefore },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  for (const { id } of stale) {
    if (activeJobs.has(id)) continue;
    await prisma.$transaction(async (tx) => {
      const reclaimed = await tx.bulkPricingJob.updateMany({
        where: { id, status: "RUNNING", updatedAt: { lt: staleBefore } },
        data: {
          status: "QUEUED",
          startedAt: null,
          completedAt: null,
          lastError: "Worker interrupted; bulk pricing job requeued",
        },
      });
      if (reclaimed.count) {
        await tx.bulkPricingJobItem.updateMany({
          where: { bulkPricingJobId: id, status: "RUNNING" },
          data: { status: "QUEUED", startedAt: null, completedAt: null, error: null },
        });
      }
    });
  }

  return startQueuedBulkPricingJobs(options);
}

export async function cancelStuckBulkPricingJobs(organizationId: string) {
  return prisma.bulkPricingJob.updateMany({
    where: {
      organizationId,
      status: { in: ["QUEUED", "RUNNING"] },
    },
    data: {
      status: "FAILED",
      lastError: "Cancelled by user to start a new job",
      completedAt: new Date(),
    },
  });
}

export async function createBulkPricingJob(input: {
  organizationId: string;
  userId: string;
  marketplace: Marketplace;
  condition: ListingCondition;
  targetMarginPercent?: number | null;
  bufferPercent?: number | null;
  pricingStrategy?: BulkPricingStrategy;
  pricingFormula?: BulkPricingFormula | null;
  rows: BulkPricingRowInput[];
  sourceFilename?: string | null;
}) {
  if (!input.rows.length) throw new BulkPricingError("At least one row is required.");
  const pricingStrategy = input.pricingStrategy ?? "CUSTOM_FORMULA";
  const pricingFormula = pricingStrategy === "CUSTOM_FORMULA"
    ? (input.pricingFormula
        ? normalizeBulkPricingFormula(input.pricingFormula)
        : createDefaultBulkPricingFormula({
            profitMarginPercent: input.targetMarginPercent ?? 20,
            bufferPercent: input.bufferPercent ?? 1,
          }))
    : null;
  const configuredProfit = pricingFormula?.components.find((component) => component.enabled && component.kind === "PROFIT_MARGIN_PERCENT")?.value;
  const configuredBuffer = pricingFormula?.components.find((component) => component.enabled && component.kind === "BUFFER_PERCENT")?.value;
  if (pricingFormula) {
    const validationRow = input.rows.reduce((lowest, row) => row.costPrice < lowest.costPrice ? row : lowest);
    try {
      evaluateBulkPricingFormula(validationRow.costPrice, pricingFormula);
    } catch (error) {
      throw new BulkPricingError(`Row ${validationRow.rowNumber}: ${error instanceof Error ? error.message : "Invalid pricing formula"}`);
    }
  }

  // Expire orphaned jobs that were queued but never picked up so they cannot block new jobs.
  // Running jobs are intentionally left alone: they are long-lived (rate limits) and are
  // requeued by resumeInterruptedBulkPricingJobs after their lease goes stale.
  const neverStartedThreshold = new Date(Date.now() - 10 * 60 * 1000);
  await prisma.bulkPricingJob.updateMany({
    where: {
      organizationId: input.organizationId,
      status: "QUEUED",
      startedAt: null,
      createdAt: { lt: neverStartedThreshold },
    },
    data: {
      status: "FAILED",
      lastError: "Job never started and expired",
      completedAt: new Date(),
    },
  });

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
      pricingStrategy,
      targetMarginPercent: configuredProfit ?? input.targetMarginPercent ?? null,
      bufferPercent: configuredBuffer ?? input.bufferPercent ?? null,
      pricingFormula: pricingFormula === null ? Prisma.DbNull : pricingFormula as unknown as Prisma.InputJsonValue,
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
            quantity: row.quantity,
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
    where: { id: jobId, organizationId, createdAt: { gt: bulkPricingRetentionCutoff() } },
    include: { items: { orderBy: { rowNumber: "asc" } } },
  });
  if (!job) throw new BulkPricingError("Bulk pricing job not found", 404);
  return serializeJob(job);
}

export async function listBulkPricingJobs(organizationId: string, limit = 20) {
  const jobs = await prisma.bulkPricingJob.findMany({
    where: { organizationId, createdAt: { gt: bulkPricingRetentionCutoff() } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      marketplace: true,
      defaultCondition: true,
      targetMarginPercent: true,
      bufferPercent: true,
      pricingStrategy: true,
      pricingFormula: true,
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
    "PartNumber", "Brand", "CostPrice", "Quantity", "Currency", "Condition", "Marketplace",
    "MatchCount", "Lowest", "Median", "Highest", "MarketRecommended", "SellingPrice",
    "FormulaPrice", "ProfitPercent", "Status", "Error", "CatalogMatch", "Notes",
  ];
  const lines = [header.join(",")];
  for (const item of job.items ?? []) {
    lines.push([
      item.partNumber,
      item.brand,
      item.costPrice,
      item.quantity,
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

export async function updateBulkPricingItemSellingPrice(input: {
  organizationId: string;
  itemId: string;
  sellingPrice: number | null;
}) {
  const item = await prisma.bulkPricingJobItem.findFirst({
    where: { id: input.itemId, organizationId: input.organizationId },
    include: { bulkPricingJob: { select: { targetMarginPercent: true, bufferPercent: true, pricingStrategy: true, pricingFormula: true } } },
  });
  if (!item) throw new BulkPricingError("Bulk pricing item not found", 404);

  const cost = Number(item.costPrice.toString());
  let newSellingPrice: number | null = null;
  let newMarginPercent: number | null = null;

  if (input.sellingPrice === null) {
    if (item.bulkPricingJob.pricingStrategy === "MARKET_MEAN") {
      if (item.average !== null) {
        const automatic = calculateAutomaticMarketPrice(cost, Number(item.average.toString()));
        newSellingPrice = automatic.sellingPrice;
        newMarginPercent = automatic.marginPercent;
      }
    } else {
      const targetMargin = item.bulkPricingJob.targetMarginPercent === null ? 20 : Number(item.bulkPricingJob.targetMarginPercent.toString());
      const buffer = item.bulkPricingJob.bufferPercent === null ? 0 : Number(item.bulkPricingJob.bufferPercent.toString());
      const simple = item.bulkPricingJob.pricingFormula === null
        ? calculateSimpleBulkSellingPrice({ costPrice: cost, targetMarginPercent: targetMargin, bufferPercent: buffer })
        : evaluateBulkPricingFormula(cost, item.bulkPricingJob.pricingFormula);
      newSellingPrice = simple.sellingPrice;
      newMarginPercent = simple.actualProfitPercent;
    }
  } else {
    const rawPrice = money(Math.max(0, input.sellingPrice));
    newSellingPrice = rawPrice;
    newMarginPercent = item.bulkPricingJob.pricingStrategy === "MARKET_MEAN"
      ? calculateAutomaticMarketPrice(cost, rawPrice).marginPercent
      : item.bulkPricingJob.pricingFormula === null
        ? calculateBulkMarginPercent(cost, rawPrice)
        : calculateFormulaMarginForSellingPrice(cost, rawPrice, item.bulkPricingJob.pricingFormula);
  }

  const updated = await prisma.bulkPricingJobItem.update({
    where: { id: item.id },
    data: {
      sellingPrice: newSellingPrice,
      marginPercent: newMarginPercent,
    },
  });

  return serializeItem(updated);
}
