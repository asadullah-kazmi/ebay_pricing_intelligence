import cors from "cors";
import { createHash } from "node:crypto";
import express from "express";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "./auth.js";
import { assertTrustedAuthOrigin, clearRefreshCookie, getJwtConfiguration, readRefreshCookie, revokeRefreshToken, rotateTokenPair, setRefreshCookie } from "./auth-sessions.js";
import { getConfig } from "./config.js";
import { bulkUpdateCatalogStatus, CatalogError, exportCatalogCsv, getCatalogPart, listCatalogParts, updateCatalogPart } from "./catalog-service.js";
import { databaseIsReachable } from "./db.js";
import { calculateAnalytics } from "./domain/analytics.js";
import { matchListing, normalizePartNumber } from "./domain/matching.js";
import { accountDeletionNotificationSchema, generateChallengeResponse, verifyEbayNotificationSignature } from "./ebay-notifications.js";
import { EbayApiError, searchEbay } from "./providers/ebay.js";
import { deleteListingsForClosedEbayAccount, findLatestAnalytics, findListing, findSearchHistory, saveSearchResult } from "./repository.js";
import { findMediaStorageKey, saveConfirmedMediaAsset } from "./media-repository.js";
import { catalogImportTemplate, catalogImportTemplateFilename, catalogImportTemplateVersion, createCatalogImportCsv } from "./import-template.js";
import { findExistingNormalizedSkus, findImportByChecksum, stageParsedImport } from "./import-repository.js";
import { applyExistingSkuConflicts, parseAndValidateImport } from "./import-parser.js";
import { ImageImportError, importImageArchive } from "./image-import-service.js";
import { confirmImportBatch, correctImportMediaMatch, discardImportMediaMatch, getImportPreview, ImportReviewError } from "./import-review-service.js";
import { getObjectStorage, ObjectStorageError } from "./object-storage.js";
import { createRateLimitMiddleware, requestLogMiddleware, requestSecurityMiddleware } from "./http-hardening.js";
import { createPricingJob, getPricingJob, listPricingJobs, PricingJobError, startPricingJob } from "./pricing-service.js";
import { approveFitmentCandidate, createFitmentJob, FitmentJobError, getFitmentJob, listFitmentJobs, startFitmentJob } from "./fitment-service.js";
import { completeEbayAuthorization, createEbayAuthorization, disconnectEbayConnection, EbaySellerOAuthError, getEbayConnection } from "./ebay-seller-oauth.js";
import { getTenantContext, requireOrganizationRoles, requireTenantContext } from "./tenant-context.js";

const searchSchema = z.object({
  oem: z.string().trim().min(2).max(80),
  marketplace: z.enum(["EBAY_US", "EBAY_GB", "EBAY_DE"]).default("EBAY_US"),
  condition: z.enum(["ANY", "NEW", "USED"]).default("ANY"),
});
const confirmMediaUploadSchema = z.object({ storageKey: z.string().min(1).max(1024) });
const mediaUploadRoles = requireOrganizationRoles("OWNER", "ADMIN", "MANAGER", "CATALOG_OPERATOR");
const importFilenameSchema = z.string().trim().min(1).max(255).regex(/\.(?:csv|xlsx)$/i, "Only .csv and .xlsx files are supported");
const importBody = express.raw({ type: () => true, limit: getConfig().storage?.maxImportBytes ?? 10_485_760 });
const imageArchiveBody = express.raw({ type: () => true, limit: getConfig().storage?.maxImageArchiveBytes ?? 104_857_600 });
const imageArchiveFilenameSchema = z.string().trim().min(1).max(255).regex(/\.zip$/i, "Only .zip image archives are supported");
const importPreviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
const imageMatchCorrectionSchema = z.object({
  importRowId: z.string().min(1).nullable(),
  displayOrder: z.number().int().min(0).optional(),
});
const catalogStatusSchema = z.enum(["IMPORTED", "NEEDS_IMAGES", "IMPORT_ERROR", "READY_FOR_ENRICHMENT", "ARCHIVED"]);
const catalogQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: catalogStatusSchema.optional(),
  condition: z.enum(["NEW", "USED"]).optional(),
  hasImages: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  warehouseId: z.string().min(1).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  sort: z.enum(["newest", "oldest", "updated", "sku"]).default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const optionalCatalogText = z.string().trim().max(5_000).nullable();
const catalogPartUpdateSchema = z.object({
  sku: z.string().trim().min(1).max(100).optional(),
  primaryPartNumber: z.string().trim().min(1).max(100).refine((value) => Boolean(normalizePartNumber(value)), "Part number must contain a letter or number").optional(),
  brand: z.string().trim().max(100).nullable().optional(),
  partName: z.string().trim().max(200).nullable().optional(),
  description: optionalCatalogText.optional(),
  condition: z.enum(["NEW", "USED"]).optional(),
  status: catalogStatusSchema.optional(),
  donorMileage: z.number().int().nonnegative().nullable().optional(),
  donorColor: z.string().trim().max(100).nullable().optional(),
  placement: z.string().trim().max(100).nullable().optional(),
  notes: optionalCatalogText.optional(),
  inventory: z.object({
    quantity: z.number().int().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
    warehouseCode: z.string().trim().max(50).nullable().optional(),
    binLocation: z.string().trim().max(100).nullable().optional(),
    weight: z.number().nonnegative().nullable().optional(),
    weightUnit: z.enum(["LB", "KG"]).nullable().optional(),
    length: z.number().nonnegative().nullable().optional(),
    width: z.number().nonnegative().nullable().optional(),
    height: z.number().nonnegative().nullable().optional(),
    dimensionUnit: z.enum(["IN", "CM"]).nullable().optional(),
  }).strict().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");
const catalogBulkStatusSchema = z.object({ partIds: z.array(z.string().min(1)).min(1).max(500).transform((ids) => [...new Set(ids)]), status: catalogStatusSchema });
const createPricingJobSchema = z.object({
  partIds: z.array(z.string().min(1)).min(1).max(25).transform((ids) => [...new Set(ids)]),
  marketplace: z.enum(["EBAY_US", "EBAY_GB", "EBAY_DE"]).default("EBAY_US"),
  conditionMode: z.enum(["MATCH_PART", "ANY", "NEW", "USED"]).default("MATCH_PART"),
}).strict();
const pricingJobListSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });
const pricingRoles = requireOrganizationRoles("OWNER", "ADMIN", "MANAGER", "PRICING_OPERATOR");
const createFitmentJobSchema = z.object({
  partIds: z.array(z.string().min(1)).min(1).max(10).transform((ids) => [...new Set(ids)]),
  marketplace: z.enum(["EBAY_US", "EBAY_GB", "EBAY_DE"]).default("EBAY_US"),
}).strict();
const approveFitmentSchema = z.object({ candidateId: z.string().min(1) }).strict();
const fitmentRoles = requireOrganizationRoles("OWNER", "ADMIN", "MANAGER", "CATALOG_OPERATOR");
const ebayConnectionRoles = requireOrganizationRoles("OWNER", "ADMIN");
const ebayOAuthCallbackSchema = z.object({
  state: z.string().min(1).max(200),
  code: z.string().min(1).max(2_000).optional(),
  error: z.string().max(200).optional(),
});
const generalRateLimit = createRateLimitMiddleware({ scope: "general", limit: 600, windowMs: 15 * 60_000 });
const authRateLimit = createRateLimitMiddleware({ scope: "auth", limit: 30, windowMs: 15 * 60_000 });
const searchRateLimit = createRateLimitMiddleware({ scope: "search", limit: 120, windowMs: 60_000 });
const importRateLimit = createRateLimitMiddleware({ scope: "import", limit: 30, windowMs: 60 * 60_000 });
const writeRateLimit = createRateLimitMiddleware({ scope: "write", limit: 240, windowMs: 15 * 60_000 });

export const app = express();
app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
const webOrigin = getConfig().webOrigin;
app.use(requestSecurityMiddleware);
app.use(cors(webOrigin ? { origin: webOrigin, credentials: true } : undefined));
app.use(requestLogMiddleware);
app.use(generalRateLimit);
app.use(express.json({ limit: "1mb" }));
app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
const readinessHandler: express.RequestHandler = async (_req, res) => {
  const config = getConfig();
  const databaseConnected = await databaseIsReachable();
  res.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? "ok" : "degraded",
    ebay: { mode: config.ebay.mode, environment: config.ebay.environment },
    persistence: { provider: "postgresql", connected: databaseConnected },
  });
};
app.get("/health", readinessHandler);
app.get("/health/ready", readinessHandler);

app.get("/api/ebay/oauth/callback", authRateLimit, async (req, res) => {
  const redirect = (result: "connected" | "declined" | "error") => {
    const target = getConfig().webOrigin;
    if (target) return res.redirect(303, `${target}/catalog?ebay=${result}`);
    return res.status(result === "connected" ? 200 : 400).json({ status: result });
  };
  try {
    const input = ebayOAuthCallbackSchema.parse(req.query);
    await completeEbayAuthorization({ state: input.state, code: input.code, providerError: input.error });
    return redirect("connected");
  } catch (error) {
    console.warn(JSON.stringify({ type: "ebay_oauth_callback_failed", error: error instanceof Error ? { name: error.name, message: error.message } : { name: "UnknownError" } }));
    return redirect(error instanceof EbaySellerOAuthError && error.message.includes("declined") ? "declined" : "error");
  }
});

app.get("/api/session", requireTenantContext, (_req, res) => {
  const tenant = getTenantContext(res);
  res.json(tenant);
});

app.get("/api/ebay/connection", requireTenantContext, async (_req, res, next) => {
  try { res.json(await getEbayConnection(getTenantContext(res).organization.id)); }
  catch (error) { next(error); }
});

app.post("/api/ebay/connection/authorize", authRateLimit, requireTenantContext, ebayConnectionRoles, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    const tenant = getTenantContext(res);
    res.status(201).json(await createEbayAuthorization(tenant.organization.id, tenant.user.id));
  } catch (error) { next(error); }
});

app.delete("/api/ebay/connection", writeRateLimit, requireTenantContext, ebayConnectionRoles, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    res.json(await disconnectEbayConnection(getTenantContext(res).organization.id));
  } catch (error) { next(error); }
});

app.post("/api/auth/refresh", authRateLimit, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    const jwt = getJwtConfiguration();
    if (!jwt) return res.status(503).json({ error: "JWT authentication is not configured" });
    const pair = await rotateTokenPair(readRefreshCookie(req), jwt);
    setRefreshCookie(res, pair);
    res.json({ accessToken: pair.accessToken, expiresIn: pair.accessTokenExpiresIn });
  } catch (error) { next(error); }
});

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    const jwt = getJwtConfiguration();
    if (jwt) await revokeRefreshToken(readRefreshCookie(req), jwt);
    clearRefreshCookie(res);
    res.status(204).send();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      clearRefreshCookie(res);
      return res.status(204).send();
    }
    next(error);
  }
});

app.post("/api/media/upload-url", requireTenantContext, mediaUploadRoles, async (req, res, next) => {
  try {
    const storage = getObjectStorage();
    if (!storage) return res.status(503).json({ error: "Object storage is not configured" });
    const tenant = getTenantContext(res);
    res.status(201).json(await storage.createImageUpload(tenant.organization.id, req.body));
  } catch (error) { next(error); }
});

app.get("/api/imports/template", requireTenantContext, (_req, res) => {
  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${catalogImportTemplateFilename}"`,
    "Cache-Control": "private, max-age=3600",
    "X-Template-Version": catalogImportTemplateVersion,
  });
  res.send(createCatalogImportCsv());
});

app.get("/api/imports/template/schema", requireTenantContext, (_req, res) => {
  res.set("Cache-Control", "private, max-age=3600");
  res.json(catalogImportTemplate);
});

app.post("/api/imports/validate", importRateLimit, requireTenantContext, mediaUploadRoles, importBody, async (req, res, next) => {
  try {
    const storage = getObjectStorage();
    if (!storage) return res.status(503).json({ error: "Object storage is not configured" });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Spreadsheet file body is required" });
    const filename = importFilenameSchema.parse(req.get("x-file-name"));
    const tenant = getTenantContext(res);
    const checksum = createHash("sha256").update(req.body).digest("hex");
    const existing = await findImportByChecksum(tenant.organization.id, checksum);
    if (existing) return res.json(existing);

    const parsed = await parseAndValidateImport(filename, req.body);
    const candidateSkus = parsed.rows.flatMap(({ normalizedData }) => normalizedData ? [normalizedData.normalizedSku] : []);
    applyExistingSkuConflicts(parsed, await findExistingNormalizedSkus(tenant.organization.id, candidateSkus));
    const sourceFileKey = await storage.storeImportFile({
      organizationId: tenant.organization.id,
      filename,
      mimeType: req.get("content-type")?.split(";")[0] ?? "application/octet-stream",
      bytes: req.body,
      checksum,
    });
    const batch = await stageParsedImport({
      organizationId: tenant.organization.id,
      createdById: tenant.user.id,
      originalFilename: filename,
      checksum,
      sourceFileKey,
      parsed,
    });
    res.status(201).json(batch);
  } catch (error) { next(error); }
});

app.post("/api/imports/:id/images", importRateLimit, requireTenantContext, mediaUploadRoles, imageArchiveBody, async (req, res, next) => {
  try {
    const storage = getObjectStorage();
    if (!storage) return res.status(503).json({ error: "Object storage is not configured" });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "ZIP archive body is required" });
    const importBatchId = req.params.id;
    if (typeof importBatchId !== "string") return res.status(400).json({ error: "Invalid import batch ID" });
    const filename = imageArchiveFilenameSchema.parse(req.get("x-file-name"));
    const tenant = getTenantContext(res);
    const storageConfig = getConfig().storage!;
    const result = await importImageArchive({
      organizationId: tenant.organization.id,
      importBatchId,
      filename,
      bytes: req.body,
      storage,
      maxImageBytes: storageConfig.maxImageBytes,
    });
    res.status(result.reused ? 200 : 201).json(result);
  } catch (error) { next(error); }
});

app.get("/api/imports/:id/preview", requireTenantContext, async (req, res, next) => {
  try {
    const importBatchId = req.params.id;
    if (typeof importBatchId !== "string") return res.status(400).json({ error: "Invalid import batch ID" });
    const tenant = getTenantContext(res);
    const query = importPreviewQuerySchema.parse(req.query);
    res.json(await getImportPreview({ organizationId: tenant.organization.id, importBatchId, ...query }));
  } catch (error) { next(error); }
});

app.patch("/api/imports/:id/media-matches/:matchId", writeRateLimit, requireTenantContext, mediaUploadRoles, async (req, res, next) => {
  try {
    const importBatchId = req.params.id;
    const mediaMatchId = req.params.matchId;
    if (typeof importBatchId !== "string" || typeof mediaMatchId !== "string") {
      return res.status(400).json({ error: "Invalid import or image match ID" });
    }
    const tenant = getTenantContext(res);
    const correction = imageMatchCorrectionSchema.parse(req.body);
    res.json(await correctImportMediaMatch({
      organizationId: tenant.organization.id,
      importBatchId,
      mediaMatchId,
      ...correction,
    }));
  } catch (error) { next(error); }
});

app.delete("/api/imports/:id/media-matches/:matchId", writeRateLimit, requireTenantContext, mediaUploadRoles, async (req, res, next) => {
  try {
    const importBatchId = req.params.id;
    const mediaMatchId = req.params.matchId;
    if (typeof importBatchId !== "string" || typeof mediaMatchId !== "string") {
      return res.status(400).json({ error: "Invalid import or image match ID" });
    }
    const tenant = getTenantContext(res);
    res.json(await discardImportMediaMatch({ organizationId: tenant.organization.id, importBatchId, mediaMatchId }));
  } catch (error) { next(error); }
});

app.post("/api/imports/:id/confirm", importRateLimit, requireTenantContext, mediaUploadRoles, async (req, res, next) => {
  try {
    const importBatchId = req.params.id;
    if (typeof importBatchId !== "string") return res.status(400).json({ error: "Invalid import batch ID" });
    const tenant = getTenantContext(res);
    const result = await confirmImportBatch({ organizationId: tenant.organization.id, importBatchId, userId: tenant.user.id });
    res.status(result.reused ? 200 : 201).json(result);
  } catch (error) { next(error); }
});

app.get("/api/parts", requireTenantContext, async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    res.json(await listCatalogParts(tenant.organization.id, catalogQuerySchema.parse(req.query)));
  } catch (error) { next(error); }
});

app.get("/api/parts/export", requireTenantContext, async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const { page: _page, pageSize: _pageSize, ...query } = catalogQuerySchema.parse(req.query);
    const csv = await exportCatalogCsv(tenant.organization.id, query);
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="partpulse-catalog-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" });
    res.send(csv);
  } catch (error) { next(error); }
});

app.patch("/api/parts/bulk-status", writeRateLimit, requireTenantContext, mediaUploadRoles, async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const input = catalogBulkStatusSchema.parse(req.body);
    res.json(await bulkUpdateCatalogStatus(tenant.organization.id, input.partIds, input.status));
  } catch (error) { next(error); }
});

app.get("/api/parts/:id", requireTenantContext, async (req, res, next) => {
  try {
    const partId = req.params.id;
    if (typeof partId !== "string") return res.status(400).json({ error: "Invalid catalog part ID" });
    res.json(await getCatalogPart(getTenantContext(res).organization.id, partId));
  } catch (error) { next(error); }
});

app.patch("/api/parts/:id", writeRateLimit, requireTenantContext, mediaUploadRoles, async (req, res, next) => {
  try {
    const partId = req.params.id;
    if (typeof partId !== "string") return res.status(400).json({ error: "Invalid catalog part ID" });
    res.json(await updateCatalogPart(getTenantContext(res).organization.id, partId, catalogPartUpdateSchema.parse(req.body)));
  } catch (error) { next(error); }
});

app.post("/api/pricing/jobs", searchRateLimit, requireTenantContext, pricingRoles, async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const job = await createPricingJob(tenant.organization.id, tenant.user.id, createPricingJobSchema.parse(req.body));
    res.status(202).json(job);
    if (getConfig().jobs.executionMode === "inline") startPricingJob(job.id);
  } catch (error) { next(error); }
});

app.get("/api/pricing/jobs", requireTenantContext, async (req, res, next) => {
  try {
    const { limit } = pricingJobListSchema.parse(req.query);
    res.json(await listPricingJobs(getTenantContext(res).organization.id, limit));
  } catch (error) { next(error); }
});

app.get("/api/pricing/jobs/:id", requireTenantContext, async (req, res, next) => {
  try {
    const jobId = req.params.id;
    if (typeof jobId !== "string") return res.status(400).json({ error: "Invalid pricing job ID" });
    res.json(await getPricingJob(getTenantContext(res).organization.id, jobId));
  } catch (error) { next(error); }
});

app.post("/api/fitment/jobs", searchRateLimit, requireTenantContext, fitmentRoles, async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const job = await createFitmentJob(tenant.organization.id, tenant.user.id, createFitmentJobSchema.parse(req.body));
    res.status(202).json(job);
    if (getConfig().jobs.executionMode === "inline") startFitmentJob(job.id);
  } catch (error) { next(error); }
});

app.get("/api/fitment/jobs", requireTenantContext, async (req, res, next) => {
  try {
    const { limit } = pricingJobListSchema.parse(req.query);
    res.json(await listFitmentJobs(getTenantContext(res).organization.id, limit));
  } catch (error) { next(error); }
});

app.get("/api/fitment/jobs/:id", requireTenantContext, async (req, res, next) => {
  try {
    const jobId = req.params.id;
    if (typeof jobId !== "string") return res.status(400).json({ error: "Invalid fitment job ID" });
    res.json(await getFitmentJob(getTenantContext(res).organization.id, jobId));
  } catch (error) { next(error); }
});

app.post("/api/fitment/items/:id/approve", searchRateLimit, requireTenantContext, fitmentRoles, async (req, res, next) => {
  try {
    const itemId = req.params.id;
    if (typeof itemId !== "string") return res.status(400).json({ error: "Invalid fitment item ID" });
    const { candidateId } = approveFitmentSchema.parse(req.body);
    res.json(await approveFitmentCandidate(getTenantContext(res).organization.id, itemId, candidateId));
  } catch (error) { next(error); }
});

app.post("/api/media/uploads/confirm", requireTenantContext, mediaUploadRoles, async (req, res, next) => {
  try {
    const storage = getObjectStorage();
    if (!storage) return res.status(503).json({ error: "Object storage is not configured" });
    const tenant = getTenantContext(res);
    const { storageKey } = confirmMediaUploadSchema.parse(req.body);
    const image = await storage.confirmImageUpload(tenant.organization.id, storageKey);
    const asset = await saveConfirmedMediaAsset(tenant.organization.id, image);
    res.status(201).json(asset);
  } catch (error) { next(error); }
});

app.get("/api/media/:id/download-url", requireTenantContext, async (req, res, next) => {
  try {
    const storage = getObjectStorage();
    if (!storage) return res.status(503).json({ error: "Object storage is not configured" });
    const tenant = getTenantContext(res);
    const mediaAssetId = req.params.id;
    if (typeof mediaAssetId !== "string") return res.status(400).json({ error: "Invalid media asset ID" });
    const storageKey = await findMediaStorageKey(tenant.organization.id, mediaAssetId);
    if (!storageKey) return res.status(404).json({ error: "Media asset not found" });
    res.json({ downloadUrl: await storage.createDownloadUrl(tenant.organization.id, storageKey), expiresIn: 300 });
  } catch (error) { next(error); }
});

app.get("/api/ebay/account-deletion", (req, res) => {
  const challengeCode = typeof req.query.challenge_code === "string" ? req.query.challenge_code : undefined;
  const { endpoint, verificationToken } = getConfig().ebay.notifications;
  if (!challengeCode) return res.status(400).json({ error: "Missing challenge_code" });
  if (!endpoint || !verificationToken) return res.status(503).json({ error: "eBay notifications are not configured" });
  res.json({ challengeResponse: generateChallengeResponse(challengeCode, verificationToken, endpoint) });
});

app.post("/api/ebay/account-deletion", async (req, res, next) => {
  try {
    const notification = accountDeletionNotificationSchema.parse(req.body);
    const signature = req.get("x-ebay-signature");
    if (!signature || !(await verifyEbayNotificationSignature(req.body, signature))) {
      return res.status(412).json({ error: "Invalid eBay notification signature" });
    }

    const username = notification.notification.data.username?.trim() || undefined;
    const deleted = await deleteListingsForClosedEbayAccount(username);
    console.info("Processed eBay account deletion notification", {
      notificationId: notification.notification.notificationId,
      strategy: username ? "seller" : "all-listings",
      deletedListings: deleted,
    });
    res.status(204).send();
  } catch (error) { next(error); }
});

app.post("/api/search", searchRateLimit, async (req, res, next) => {
  try {
    const input = searchSchema.parse(req.body);
    const oem = normalizePartNumber(input.oem);
    const ownSellers = getConfig().ownSellers;
    const candidates = await searchEbay(oem, input.marketplace, input.condition);
    const listings = candidates.flatMap((item) => {
      const matchedOn = matchListing(item, oem);
      if (!matchedOn.length || ownSellers.has(item.seller.toLowerCase())) return [];
      return [{ ...item, matchedOn, landedPrice: Math.round((item.price + item.shipping) * 100) / 100 }];
    });
    const result = { oem, marketplace: input.marketplace, conditionFilter: input.condition, searchedAt: new Date().toISOString(), listings, analytics: calculateAnalytics(listings) };
    await saveSearchResult(result);
    res.json(result);
  } catch (error) { next(error); }
});

app.get("/api/listings/:id", async (req, res, next) => {
  try {
  const listing = await findListing(req.params.id);
  listing ? res.json(listing) : res.status(404).json({ error: "Listing not found" });
  } catch (error) { next(error); }
});
app.get("/api/analytics/:oem", async (req, res, next) => {
  try {
  const analytics = await findLatestAnalytics(normalizePartNumber(req.params.oem));
  analytics !== undefined ? res.json(analytics) : res.status(404).json({ error: "Search this OEM first" });
  } catch (error) { next(error); }
});
app.get("/api/history/:oem", async (req, res, next) => {
  try {
  res.json(await findSearchHistory(normalizePartNumber(req.params.oem)));
  } catch (error) { next(error); }
});

app.use((_req, res) => res.status(404).json({ error: "Route not found", requestId: res.locals.requestId }));

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const response = (status: number, body: Record<string, unknown>) => res.status(status).json({ ...body, requestId: res.locals.requestId });
  if (error instanceof AuthenticationError) return response(401, { error: error.message });
  if (error instanceof AuthorizationError) return response(403, { error: error.message });
  if (error instanceof ObjectStorageError) return response(400, { error: error.message });
  if (error instanceof ImageImportError) return response(error.statusCode, { error: error.message });
  if (error instanceof ImportReviewError) return response(error.statusCode, { error: error.message, ...(error.details ? { details: error.details } : {}) });
  if (error instanceof CatalogError) return response(error.statusCode, { error: error.message });
  if (error instanceof PricingJobError) return response(error.statusCode, { error: error.message });
  if (error instanceof FitmentJobError) return response(error.statusCode, { error: error.message });
  if (error instanceof EbaySellerOAuthError) return response(error.statusCode, { error: error.message });
  if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
    return response(413, { error: "Request body exceeds the configured upload limit" });
  }
  if (error instanceof z.ZodError) return response(400, { error: "Invalid request", issues: error.issues });
  if (error instanceof EbayApiError) return response(502, { error: error.message, provider: "ebay" });
  console.error(JSON.stringify({ type: "unhandled_request_error", requestId: res.locals.requestId, method: req.method, path: req.path, error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { name: "UnknownError" } }));
  response(500, { error: "Unable to complete the request. Check the API logs for details." });
});
