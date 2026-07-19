import cors from "cors";
import { createHash } from "node:crypto";
import express from "express";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "./auth.js";
import { assertTrustedAuthOrigin, clearRefreshCookie, getJwtConfiguration, readRefreshCookie, revokeRefreshToken, rotateTokenPair, setRefreshCookie } from "./auth-sessions.js";
import { getConfig } from "./config.js";
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
import { getObjectStorage, ObjectStorageError } from "./object-storage.js";
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

export const app = express();
const webOrigin = getConfig().webOrigin;
app.use(cors(webOrigin ? { origin: webOrigin, credentials: true } : undefined));
app.use(express.json());
app.get("/health", async (_req, res) => {
  const config = getConfig();
  const databaseConnected = await databaseIsReachable();
  res.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? "ok" : "degraded",
    ebay: { mode: config.ebay.mode, environment: config.ebay.environment },
    persistence: { provider: "postgresql", connected: databaseConnected },
  });
});

app.get("/api/session", requireTenantContext, (_req, res) => {
  const tenant = getTenantContext(res);
  res.json(tenant);
});

app.post("/api/auth/refresh", async (req, res, next) => {
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

app.post("/api/imports/validate", requireTenantContext, mediaUploadRoles, importBody, async (req, res, next) => {
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

app.post("/api/imports/:id/images", requireTenantContext, mediaUploadRoles, imageArchiveBody, async (req, res, next) => {
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

app.post("/api/search", async (req, res, next) => {
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

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof AuthenticationError) return res.status(401).json({ error: error.message });
  if (error instanceof AuthorizationError) return res.status(403).json({ error: error.message });
  if (error instanceof ObjectStorageError) return res.status(400).json({ error: error.message });
  if (error instanceof ImageImportError) return res.status(error.statusCode).json({ error: error.message });
  if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
    return res.status(413).json({ error: "Spreadsheet exceeds the configured upload limit" });
  }
  if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid request", issues: error.issues });
  if (error instanceof EbayApiError) return res.status(502).json({ error: error.message, provider: "ebay" });
  console.error(error);
  res.status(500).json({ error: "Unable to complete the request. Check the API logs for details." });
});
