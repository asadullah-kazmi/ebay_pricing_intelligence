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
import { getWorkerHealth } from "./worker-operations.js";
import { executeIdempotent, IdempotencyError } from "./idempotency-service.js";
import { DeadLetterError, listDeadLetters, requeueDeadLetter } from "./dead-letter-service.js";
import { createListingDrafts, getListingDraft, ListingDraftError, listListingDrafts, updateListingDraft, validateListingDraftLive } from "./listing-draft-service.js";
import { listCachedSellerResources, refreshCategoryMetadata, syncSellerResources } from "./ebay-resource-service.js";
import { createInventoryPreparationJob, getInventoryPreparationJob, getLatestInventoryPreparation, InventoryPreparationError, startInventoryPreparationJob } from "./inventory-preparation-service.js";
import { createEbayInventorySyncJob, EbayInventorySyncError, getEbayInventorySyncJob, getLatestEbayInventorySyncJob, startEbayInventorySyncJob } from "./ebay-inventory-sync-service.js";
import { createOfferPreparationJob, createOfferPublishJob, EbayOfferError, getOffer, getOfferByDraft, getOfferJob, startOfferJob } from "./ebay-offer-service.js";
import { createReconciliationJob, createRevisionJob, createWithdrawalJob, EbayListingOperationError, getListingOperationJob, startListingOperationJob } from "./ebay-listing-operation-service.js";
import { listAuditEvents } from "./audit-service.js";
import { AdminOperationsError, getAdminOverview, listFailedJobs, listPublishingOperations, retryAdminJob } from "./admin-operations-service.js";
import { acceptOrganizationInvitation, changeOrganizationMemberRole, createOrganizationInvitation, listOrganizationTeam, OrganizationTeamError, previewOrganizationInvitation, removeOrganizationMember, revokeOrganizationInvitation } from "./organization-team-service.js";
import { AccountAuthError, beginMfaSetup, changeAccountPassword, completeMfaLogin, confirmMfaSetup, disableMfa, getAccountSecurity, loginAccount, passwordMeetsPolicy, recoverAccount, regenerateMfaRecoveryCodes, registerAccount, requestAccountRecovery, requestEmailVerification, requestPasswordReset, resetAccountPassword, verifyAccountEmail } from "./account-auth-service.js";
import { EmailDeliveryError, verifyEmailTransport } from "./email-service.js";
import { decidePricingProposal, getOrganizationPricingRule, listPricingProposals, PricingGovernanceError, updateOrganizationPricingRule } from "./pricing-governance-service.js";
import { createManualFitment, decideManualFitment, listPartFitment, ManualFitmentError, reviseManualFitment } from "./manual-fitment-service.js";

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
const pricingRuleRoles = requireOrganizationRoles("OWNER", "ADMIN");
const pricingRuleSchema = z.object({
  marketAdjustmentPercent: z.number().min(-50).max(100),
  minimumMarginPercent: z.number().min(0).max(95),
  minimumProfitAmount: z.number().min(0).max(1_000_000),
  requireApproval: z.boolean(),
}).strict();
const pricingProposalQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "OVERRIDDEN", "SUPERSEDED"]).optional(),
  partId: z.string().min(1).optional(),
  marketplace: z.enum(["EBAY_US", "EBAY_GB", "EBAY_DE"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const pricingProposalDecisionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "OVERRIDE"]),
  overridePrice: z.number().positive().max(100_000_000).optional(),
  reason: z.string().trim().min(3).max(500).optional(),
}).strict();
const createFitmentJobSchema = z.object({
  partIds: z.array(z.string().min(1)).min(1).max(10).transform((ids) => [...new Set(ids)]),
  marketplace: z.enum(["EBAY_US", "EBAY_GB", "EBAY_DE"]).default("EBAY_US"),
}).strict();
const approveFitmentSchema = z.object({ candidateId: z.string().min(1) }).strict();
const fitmentRoles = requireOrganizationRoles("OWNER", "ADMIN", "MANAGER", "CATALOG_OPERATOR");
const fitmentPropertiesSchema = z.record(
  z.string().trim().min(1).max(100),
  z.string().trim().max(200),
).refine((properties) => Object.keys(properties).length <= 50, "At most 50 compatibility properties are allowed");
const manualFitmentQuerySchema = z.object({
  marketplace: z.enum(["EBAY_US", "EBAY_GB", "EBAY_DE"]).default("EBAY_US"),
});
const createManualFitmentSchema = z.object({
  marketplace: z.enum(["EBAY_US", "EBAY_GB", "EBAY_DE"]).default("EBAY_US"),
  source: z.enum(["MANUAL", "DONOR_VEHICLE"]),
  properties: fitmentPropertiesSchema,
  notes: z.string().trim().max(1000).optional(),
}).strict();
const reviseManualFitmentSchema = z.object({
  properties: fitmentPropertiesSchema,
  notes: z.string().trim().max(1000).nullable().optional(),
  reason: z.string().trim().min(3).max(500),
}).strict();
const manualFitmentDecisionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "SUPERSEDE"]),
  reason: z.string().trim().min(3).max(500),
  replaceExisting: z.boolean().optional(),
}).strict();
const deadLetterRoles = requireOrganizationRoles("OWNER", "ADMIN", "MANAGER");
const adminOperationsRoles = requireOrganizationRoles("OWNER", "ADMIN");
const teamManagementRoles = requireOrganizationRoles("OWNER", "ADMIN");
const idempotencyKeySchema = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/).optional();
const deadLetterQuerySchema = z.object({
  status: z.enum(["OPEN", "REQUEUED", "RESOLVED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const adminListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });
const adminPublishingQuerySchema = adminListQuerySchema.extend({
  status: z.enum(["PUBLISHED", "WITHDRAWN", "DRIFTED", "FAILED"]).optional(),
});
const adminAuditQuerySchema = adminListQuerySchema.extend({
  action: z.string().trim().max(100).optional(),
  resourceType: z.string().trim().max(100).optional(),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
});
const adminJobTypeSchema = z.enum(["PRICING", "FITMENT", "INVENTORY_PREPARATION", "INVENTORY_SYNC", "OFFER", "LISTING_OPERATION"]);
const organizationRoleSchema = z.enum(["OWNER", "ADMIN", "MANAGER", "CATALOG_OPERATOR", "PRICING_OPERATOR", "PUBLISHER", "VIEWER"]);
const invitationTokenSchema = z.string().trim().min(32).max(200);
const invitationPreviewSchema = z.object({ token: invitationTokenSchema }).strict();
const invitationAcceptSchema = z.object({
  token: invitationTokenSchema,
  name: z.string().trim().min(1).max(100).optional(),
}).strict();
const createInvitationSchema = z.object({
  email: z.string().trim().email().max(320),
  role: organizationRoleSchema,
}).strict();
const changeMemberRoleSchema = z.object({ role: organizationRoleSchema }).strict();
const emailSchema = z.string().trim().email().max(320);
const securePasswordSchema = z.string().min(12).max(128).refine(passwordMeetsPolicy, "Password must include uppercase, lowercase, number, and symbol");
const registerAccountSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(100),
  password: securePasswordSchema,
  organizationName: z.string().trim().min(2).max(120),
}).strict();
const loginAccountSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  organizationSlug: z.string().trim().min(1).max(100).optional(),
}).strict();
const mfaLoginSchema = z.object({
  challengeToken: z.string().trim().min(32).max(200),
  code: z.string().trim().min(6).max(40),
}).strict();
const emailActionSchema = z.object({ email: emailSchema }).strict();
const tokenActionSchema = z.object({ token: z.string().trim().min(32).max(200) }).strict();
const passwordResetSchema = tokenActionSchema.extend({ password: securePasswordSchema });
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128).optional(),
  password: securePasswordSchema,
}).strict();
const mfaSetupSchema = z.object({ password: z.string().min(1).max(128) }).strict();
const mfaCodeSchema = z.object({ code: z.string().trim().min(6).max(40) }).strict();
const mfaSensitiveActionSchema = z.object({
  password: z.string().min(1).max(128),
  code: z.string().trim().min(6).max(40),
}).strict();
const listingDraftRoles = requireOrganizationRoles("OWNER", "ADMIN", "MANAGER", "PUBLISHER");
const createListingDraftsSchema = z.object({
  partIds: z.array(z.string().min(1)).min(1).max(25).transform((ids) => [...new Set(ids)]),
  marketplace: z.enum(["EBAY_US", "EBAY_GB", "EBAY_DE"]).default("EBAY_US"),
}).strict();
const listingDraftListSchema = z.object({
  marketplace: z.enum(["EBAY_US", "EBAY_GB", "EBAY_DE"]).optional(),
  status: z.enum(["DRAFT", "BLOCKED", "READY"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const ebayMarketplaceSchema = z.enum(["EBAY_US", "EBAY_GB", "EBAY_DE"]);
const sellerResourceQuerySchema = z.object({ marketplace: ebayMarketplaceSchema.default("EBAY_US") });
const sellerResourceSyncSchema = z.object({ marketplace: ebayMarketplaceSchema.default("EBAY_US") }).strict();
const listingDraftPatchSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().max(200).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(100_000).nullable().optional(),
  categoryId: z.string().trim().max(50).nullable().optional(),
  condition: z.enum(["NEW", "USED"]).optional(),
  ebayCondition: z.string().trim().min(1).max(50).nullable().optional(),
  price: z.number().positive().max(10_000_000).nullable().optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  quantity: z.number().int().min(0).max(1_000_000).optional(),
  aspects: z.record(z.string().trim().min(1).max(100), z.array(z.string().trim().min(1).max(500)).max(50)).optional(),
  paymentPolicyId: z.string().trim().max(100).nullable().optional(),
  returnPolicyId: z.string().trim().max(100).nullable().optional(),
  shippingPolicyId: z.string().trim().max(100).nullable().optional(),
  merchantLocationKey: z.string().trim().max(100).nullable().optional(),
}).strict();
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
app.get("/health/worker", async (_req, res, next) => {
  try {
    const health = await getWorkerHealth(getConfig().jobs.workerHealthMaxAgeMs);
    res.status(health.status === "ok" ? 200 : 503).json(health);
  } catch (error) { next(error); }
});
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

app.post("/api/auth/register", authRateLimit, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    const input = registerAccountSchema.parse(req.body);
    res.status(201).json(await registerAccount({ ...input, requestId: res.locals.requestId }));
  } catch (error) { next(error); }
});

app.post("/api/auth/login", authRateLimit, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    const jwt = getJwtConfiguration();
    if (!jwt) return res.status(503).json({ error: "JWT authentication is not configured" });
    const result = await loginAccount({ ...loginAccountSchema.parse(req.body), jwt, requestId: res.locals.requestId });
    if ("authenticated" in result) {
      setRefreshCookie(res, result.pair);
      return res.json({
        authenticated: true,
        accessToken: result.pair.accessToken,
        accessTokenExpiresIn: result.pair.accessTokenExpiresIn,
        organization: result.organization,
        role: result.role,
      });
    }
    res.json(result);
  } catch (error) { next(error); }
});

app.post("/api/auth/login/mfa", authRateLimit, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    const jwt = getJwtConfiguration();
    if (!jwt) return res.status(503).json({ error: "JWT authentication is not configured" });
    const result = await completeMfaLogin({ ...mfaLoginSchema.parse(req.body), jwt, requestId: res.locals.requestId });
    setRefreshCookie(res, result.pair);
    res.json({
      authenticated: true,
      accessToken: result.pair.accessToken,
      accessTokenExpiresIn: result.pair.accessTokenExpiresIn,
      organization: result.organization,
    });
  } catch (error) { next(error); }
});

app.post("/api/auth/email-verification/request", authRateLimit, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    res.status(202).json(await requestEmailVerification(emailActionSchema.parse(req.body).email));
  } catch (error) { next(error); }
});

app.post("/api/auth/email-verification/confirm", authRateLimit, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    res.json(await verifyAccountEmail(tokenActionSchema.parse(req.body).token));
  } catch (error) { next(error); }
});

app.post("/api/auth/password-reset/request", authRateLimit, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    res.status(202).json(await requestPasswordReset(emailActionSchema.parse(req.body).email));
  } catch (error) { next(error); }
});

app.post("/api/auth/password-reset/confirm", authRateLimit, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    const input = passwordResetSchema.parse(req.body);
    res.json(await resetAccountPassword(input.token, input.password));
  } catch (error) { next(error); }
});

app.post("/api/auth/account-recovery/request", authRateLimit, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    res.status(202).json(await requestAccountRecovery(emailActionSchema.parse(req.body).email));
  } catch (error) { next(error); }
});

app.post("/api/auth/account-recovery/confirm", authRateLimit, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    const input = passwordResetSchema.parse(req.body);
    res.json(await recoverAccount(input.token, input.password));
  } catch (error) { next(error); }
});

app.post("/api/invitations/preview", authRateLimit, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    const { token } = invitationPreviewSchema.parse(req.body);
    res.json(await previewOrganizationInvitation(token));
  } catch (error) { next(error); }
});

app.post("/api/invitations/accept", authRateLimit, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    const jwt = getJwtConfiguration();
    if (!jwt) return res.status(503).json({ error: "JWT authentication is not configured" });
    const input = invitationAcceptSchema.parse(req.body);
    const accepted = await acceptOrganizationInvitation({ ...input, jwt, requestId: res.locals.requestId });
    setRefreshCookie(res, accepted.pair);
    res.status(201).json({
      accessToken: accepted.pair.accessToken,
      accessTokenExpiresIn: accepted.pair.accessTokenExpiresIn,
      organization: accepted.organization,
      user: accepted.user,
      role: accepted.role,
    });
  } catch (error) { next(error); }
});

app.get("/api/session", requireTenantContext, (_req, res) => {
  const tenant = getTenantContext(res);
  res.json(tenant);
});

app.get("/api/auth/security", requireTenantContext, async (_req, res, next) => {
  try {
    res.json(await getAccountSecurity(getTenantContext(res).user.id));
  } catch (error) { next(error); }
});

app.post("/api/auth/password", authRateLimit, requireTenantContext, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    const tenant = getTenantContext(res);
    const input = passwordChangeSchema.parse(req.body);
    const result = await changeAccountPassword({
      userId: tenant.user.id,
      organizationId: tenant.organization.id,
      ...input,
      requestId: res.locals.requestId,
    });
    clearRefreshCookie(res);
    res.json(result);
  } catch (error) { next(error); }
});

app.post("/api/auth/mfa/setup", authRateLimit, requireTenantContext, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    const tenant = getTenantContext(res);
    const { password } = mfaSetupSchema.parse(req.body);
    res.json(await beginMfaSetup({ userId: tenant.user.id, email: tenant.user.email, password }));
  } catch (error) { next(error); }
});

app.post("/api/auth/mfa/confirm", authRateLimit, requireTenantContext, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    const tenant = getTenantContext(res);
    const { code } = mfaCodeSchema.parse(req.body);
    res.json(await confirmMfaSetup({
      userId: tenant.user.id,
      organizationId: tenant.organization.id,
      code,
      requestId: res.locals.requestId,
    }));
  } catch (error) { next(error); }
});

app.delete("/api/auth/mfa", authRateLimit, requireTenantContext, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    const tenant = getTenantContext(res);
    const input = mfaSensitiveActionSchema.parse(req.body);
    const result = await disableMfa({
      userId: tenant.user.id,
      organizationId: tenant.organization.id,
      ...input,
      requestId: res.locals.requestId,
    });
    clearRefreshCookie(res);
    res.json(result);
  } catch (error) { next(error); }
});

app.post("/api/auth/mfa/recovery-codes", authRateLimit, requireTenantContext, async (req, res, next) => {
  try {
    assertTrustedAuthOrigin(req);
    const tenant = getTenantContext(res);
    const input = mfaSensitiveActionSchema.parse(req.body);
    res.json(await regenerateMfaRecoveryCodes({
      userId: tenant.user.id,
      organizationId: tenant.organization.id,
      ...input,
      requestId: res.locals.requestId,
    }));
  } catch (error) { next(error); }
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

app.get("/api/ebay/resources", requireTenantContext, async (req, res, next) => {
  try {
    const { marketplace } = sellerResourceQuerySchema.parse(req.query);
    res.json(await listCachedSellerResources(getTenantContext(res).organization.id, marketplace));
  } catch (error) { next(error); }
});

app.post("/api/ebay/resources/sync", writeRateLimit, requireTenantContext, listingDraftRoles, async (req, res, next) => {
  try {
    const { marketplace } = sellerResourceSyncSchema.parse(req.body);
    res.json(await syncSellerResources(getTenantContext(res).organization.id, marketplace));
  } catch (error) { next(error); }
});

app.post("/api/ebay/categories/:categoryId/aspects/refresh", writeRateLimit, requireTenantContext, listingDraftRoles, async (req, res, next) => {
  try {
    const categoryId = req.params.categoryId;
    if (typeof categoryId !== "string" || !/^[A-Za-z0-9_-]{1,50}$/.test(categoryId)) return res.status(400).json({ error: "Invalid category ID" });
    const { marketplace } = sellerResourceSyncSchema.parse(req.body);
    res.json(await refreshCategoryMetadata(marketplace, categoryId));
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
    const input = createPricingJobSchema.parse(req.body);
    const result = await executeIdempotent({
      organizationId: tenant.organization.id,
      operation: "pricing.jobs.create",
      key: idempotencyKeySchema.parse(req.get("idempotency-key")),
      request: input,
      responseStatus: 202,
      execute: () => createPricingJob(tenant.organization.id, tenant.user.id, input),
    });
    res.set("Idempotency-Replayed", String(result.replayed)).status(202).json(result.value);
    if (!result.replayed && getConfig().jobs.executionMode === "inline") startPricingJob(result.value.id);
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

app.get("/api/pricing/rule", requireTenantContext, async (_req, res, next) => {
  try {
    res.json(await getOrganizationPricingRule(getTenantContext(res).organization.id));
  } catch (error) { next(error); }
});

app.put("/api/pricing/rule", writeRateLimit, requireTenantContext, pricingRuleRoles, async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    res.json(await updateOrganizationPricingRule({
      organizationId: tenant.organization.id,
      userId: tenant.user.id,
      values: pricingRuleSchema.parse(req.body),
      requestId: res.locals.requestId,
    }));
  } catch (error) { next(error); }
});

app.get("/api/pricing/proposals", requireTenantContext, async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    res.json(await listPricingProposals({
      organizationId: tenant.organization.id,
      ...pricingProposalQuerySchema.parse(req.query),
    }));
  } catch (error) { next(error); }
});

app.post("/api/pricing/proposals/:id/decision", writeRateLimit, requireTenantContext, pricingRoles, async (req, res, next) => {
  try {
    const proposalId = req.params.id;
    if (typeof proposalId !== "string") return res.status(400).json({ error: "Invalid pricing proposal ID" });
    const tenant = getTenantContext(res);
    res.json(await decidePricingProposal({
      organizationId: tenant.organization.id,
      userId: tenant.user.id,
      role: tenant.role,
      proposalId,
      ...pricingProposalDecisionSchema.parse(req.body),
      requestId: res.locals.requestId,
    }));
  } catch (error) { next(error); }
});

app.post("/api/fitment/jobs", searchRateLimit, requireTenantContext, fitmentRoles, async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const input = createFitmentJobSchema.parse(req.body);
    const result = await executeIdempotent({
      organizationId: tenant.organization.id,
      operation: "fitment.jobs.create",
      key: idempotencyKeySchema.parse(req.get("idempotency-key")),
      request: input,
      responseStatus: 202,
      execute: () => createFitmentJob(tenant.organization.id, tenant.user.id, input),
    });
    res.set("Idempotency-Replayed", String(result.replayed)).status(202).json(result.value);
    if (!result.replayed && getConfig().jobs.executionMode === "inline") startFitmentJob(result.value.id);
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

app.get("/api/parts/:id/fitment", requireTenantContext, async (req, res, next) => {
  try {
    const partId = req.params.id;
    if (typeof partId !== "string") return res.status(400).json({ error: "Invalid catalog part ID" });
    const { marketplace } = manualFitmentQuerySchema.parse(req.query);
    res.json(await listPartFitment(getTenantContext(res).organization.id, partId, marketplace));
  } catch (error) { next(error); }
});

app.post("/api/parts/:id/fitment", writeRateLimit, requireTenantContext, fitmentRoles, async (req, res, next) => {
  try {
    const partId = req.params.id;
    if (typeof partId !== "string") return res.status(400).json({ error: "Invalid catalog part ID" });
    const tenant = getTenantContext(res);
    res.status(201).json(await createManualFitment({
      organizationId: tenant.organization.id,
      userId: tenant.user.id,
      partId,
      ...createManualFitmentSchema.parse(req.body),
      requestId: res.locals.requestId,
    }));
  } catch (error) { next(error); }
});

app.patch("/api/fitment/applications/:id", writeRateLimit, requireTenantContext, fitmentRoles, async (req, res, next) => {
  try {
    const applicationId = req.params.id;
    if (typeof applicationId !== "string") return res.status(400).json({ error: "Invalid fitment application ID" });
    const tenant = getTenantContext(res);
    res.json(await reviseManualFitment({
      organizationId: tenant.organization.id,
      userId: tenant.user.id,
      applicationId,
      ...reviseManualFitmentSchema.parse(req.body),
      requestId: res.locals.requestId,
    }));
  } catch (error) { next(error); }
});

app.post("/api/fitment/applications/:id/decision", writeRateLimit, requireTenantContext, fitmentRoles, async (req, res, next) => {
  try {
    const applicationId = req.params.id;
    if (typeof applicationId !== "string") return res.status(400).json({ error: "Invalid fitment application ID" });
    const tenant = getTenantContext(res);
    res.json(await decideManualFitment({
      organizationId: tenant.organization.id,
      userId: tenant.user.id,
      role: tenant.role,
      applicationId,
      ...manualFitmentDecisionSchema.parse(req.body),
      requestId: res.locals.requestId,
    }));
  } catch (error) { next(error); }
});

app.post("/api/fitment/items/:id/approve", searchRateLimit, requireTenantContext, fitmentRoles, async (req, res, next) => {
  try {
    const itemId = req.params.id;
    if (typeof itemId !== "string") return res.status(400).json({ error: "Invalid fitment item ID" });
    const { candidateId } = approveFitmentSchema.parse(req.body);
    const tenant = getTenantContext(res);
    res.json(await approveFitmentCandidate(tenant.organization.id, tenant.user.id, itemId, candidateId, res.locals.requestId));
  } catch (error) { next(error); }
});

app.post("/api/listing-drafts", writeRateLimit, requireTenantContext, listingDraftRoles, async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const input = createListingDraftsSchema.parse(req.body);
    const result = await executeIdempotent({
      organizationId: tenant.organization.id,
      operation: "listing-drafts.create",
      key: idempotencyKeySchema.parse(req.get("idempotency-key")),
      request: input,
      responseStatus: 201,
      execute: () => createListingDrafts({
        organizationId: tenant.organization.id,
        userId: tenant.user.id,
        partIds: input.partIds,
        marketplace: input.marketplace,
      }),
    });
    res.set("Idempotency-Replayed", String(result.replayed)).status(result.replayed ? 200 : 201).json(result.value);
  } catch (error) { next(error); }
});

app.get("/api/listing-drafts", requireTenantContext, async (req, res, next) => {
  try {
    res.json(await listListingDrafts(getTenantContext(res).organization.id, listingDraftListSchema.parse(req.query)));
  } catch (error) { next(error); }
});

app.get("/api/listing-drafts/:id", requireTenantContext, async (req, res, next) => {
  try {
    const draftId = req.params.id;
    if (typeof draftId !== "string") return res.status(400).json({ error: "Invalid listing draft ID" });
    res.json(await getListingDraft(getTenantContext(res).organization.id, draftId));
  } catch (error) { next(error); }
});

app.patch("/api/listing-drafts/:id", writeRateLimit, requireTenantContext, listingDraftRoles, async (req, res, next) => {
  try {
    const draftId = req.params.id;
    if (typeof draftId !== "string") return res.status(400).json({ error: "Invalid listing draft ID" });
    const tenant = getTenantContext(res);
    res.json(await updateListingDraft(tenant.organization.id, tenant.user.id, draftId, listingDraftPatchSchema.parse(req.body)));
  } catch (error) { next(error); }
});

app.post("/api/listing-drafts/:id/validate", writeRateLimit, requireTenantContext, listingDraftRoles, async (req, res, next) => {
  try {
    const draftId = req.params.id;
    if (typeof draftId !== "string") return res.status(400).json({ error: "Invalid listing draft ID" });
    const tenant = getTenantContext(res);
    const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(req.body);
    res.json(await updateListingDraft(tenant.organization.id, tenant.user.id, draftId, { expectedVersion, reason: "Readiness revalidated" }));
  } catch (error) { next(error); }
});

app.post("/api/listing-drafts/:id/validate-live", writeRateLimit, requireTenantContext, listingDraftRoles, async (req, res, next) => {
  try {
    const draftId = req.params.id;
    if (typeof draftId !== "string") return res.status(400).json({ error: "Invalid listing draft ID" });
    const tenant = getTenantContext(res);
    const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(req.body);
    res.json(await validateListingDraftLive(tenant.organization.id, tenant.user.id, draftId, expectedVersion));
  } catch (error) { next(error); }
});

app.post("/api/listing-drafts/:id/prepare-inventory", writeRateLimit, requireTenantContext, listingDraftRoles, async (req, res, next) => {
  try {
    const draftId = req.params.id;
    if (typeof draftId !== "string") return res.status(400).json({ error: "Invalid listing draft ID" });
    const tenant = getTenantContext(res);
    const body = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(req.body);
    const idempotencyKey = idempotencyKeySchema.parse(req.get("Idempotency-Key"));
    const result = await executeIdempotent({
      organizationId: tenant.organization.id,
      operation: "listing-drafts.prepare-inventory",
      key: idempotencyKey,
      request: { draftId, ...body },
      responseStatus: 202,
      execute: () => createInventoryPreparationJob({
        organizationId: tenant.organization.id,
        userId: tenant.user.id,
        draftId,
        expectedVersion: body.expectedVersion,
      }),
    });
    res.set("Idempotency-Replayed", String(result.replayed)).status(202).json(result.value);
    if (!result.replayed && getConfig().jobs.executionMode === "inline") startInventoryPreparationJob(result.value.id);
  } catch (error) { next(error); }
});

app.get("/api/inventory-preparation-jobs/:id", requireTenantContext, async (req, res, next) => {
  try {
    const jobId = req.params.id;
    if (typeof jobId !== "string") return res.status(400).json({ error: "Invalid inventory preparation job ID" });
    res.json(await getInventoryPreparationJob(getTenantContext(res).organization.id, jobId));
  } catch (error) { next(error); }
});

app.get("/api/listing-drafts/:id/inventory-preparation", requireTenantContext, async (req, res, next) => {
  try {
    const draftId = req.params.id;
    if (typeof draftId !== "string") return res.status(400).json({ error: "Invalid listing draft ID" });
    res.json(await getLatestInventoryPreparation(getTenantContext(res).organization.id, draftId));
  } catch (error) { next(error); }
});

app.post("/api/inventory-preparations/:id/apply", writeRateLimit, requireTenantContext, listingDraftRoles, async (req, res, next) => {
  try {
    const preparationId = req.params.id;
    if (typeof preparationId !== "string") return res.status(400).json({ error: "Invalid inventory preparation ID" });
    const tenant = getTenantContext(res);
    const body = z.object({ confirmInventoryWrite: z.literal(true) }).strict().parse(req.body);
    const idempotencyKey = idempotencyKeySchema.parse(req.get("Idempotency-Key"));
    if (!idempotencyKey) return res.status(400).json({ error: "Idempotency-Key is required for eBay inventory writes" });
    const result = await executeIdempotent({
      organizationId: tenant.organization.id,
      operation: "ebay.inventory.apply",
      key: idempotencyKey,
      request: { preparationId, ...body },
      responseStatus: 202,
      execute: () => createEbayInventorySyncJob({
        organizationId: tenant.organization.id,
        userId: tenant.user.id,
        preparationId,
        confirmInventoryWrite: true,
      }),
    });
    res.set("Idempotency-Replayed", String(result.replayed)).status(202).json(result.value);
    if (!result.replayed && getConfig().jobs.executionMode === "inline") startEbayInventorySyncJob(result.value.id);
  } catch (error) { next(error); }
});

app.get("/api/ebay/inventory-sync-jobs/:id", requireTenantContext, async (req, res, next) => {
  try {
    const jobId = req.params.id;
    if (typeof jobId !== "string") return res.status(400).json({ error: "Invalid eBay inventory sync job ID" });
    res.json(await getEbayInventorySyncJob(getTenantContext(res).organization.id, jobId));
  } catch (error) { next(error); }
});

app.get("/api/listing-drafts/:id/inventory-sync", requireTenantContext, async (req, res, next) => {
  try {
    const listingDraftId = req.params.id;
    if (typeof listingDraftId !== "string") return res.status(400).json({ error: "Invalid listing draft ID" });
    res.json(await getLatestEbayInventorySyncJob(getTenantContext(res).organization.id, listingDraftId));
  } catch (error) { next(error); }
});

app.post("/api/ebay/inventory-sync-jobs/:id/offer", writeRateLimit, requireTenantContext, listingDraftRoles, async (req, res, next) => {
  try {
    const inventorySyncJobId = req.params.id;
    if (typeof inventorySyncJobId !== "string") return res.status(400).json({ error: "Invalid eBay inventory sync job ID" });
    z.object({}).strict().parse(req.body);
    const tenant = getTenantContext(res);
    const idempotencyKey = idempotencyKeySchema.parse(req.get("Idempotency-Key"));
    if (!idempotencyKey) return res.status(400).json({ error: "Idempotency-Key is required for offer preparation" });
    const result = await executeIdempotent({
      organizationId: tenant.organization.id,
      operation: "ebay.offer.prepare",
      key: idempotencyKey,
      request: { inventorySyncJobId },
      responseStatus: 202,
      execute: () => createOfferPreparationJob({
        organizationId: tenant.organization.id,
        userId: tenant.user.id,
        inventorySyncJobId,
      }),
    });
    res.set("Idempotency-Replayed", String(result.replayed)).status(202).json(result.value);
    if (!result.replayed && getConfig().jobs.executionMode === "inline") startOfferJob(result.value.id);
  } catch (error) { next(error); }
});

app.post("/api/ebay/offers/:id/publish", writeRateLimit, requireTenantContext, listingDraftRoles, async (req, res, next) => {
  try {
    const offerId = req.params.id;
    if (typeof offerId !== "string") return res.status(400).json({ error: "Invalid eBay offer ID" });
    const body = z.object({ confirmPublish: z.literal(true), confirmation: z.literal("PUBLISH") }).strict().parse(req.body);
    const tenant = getTenantContext(res);
    const idempotencyKey = idempotencyKeySchema.parse(req.get("Idempotency-Key"));
    if (!idempotencyKey) return res.status(400).json({ error: "Idempotency-Key is required for publication" });
    const result = await executeIdempotent({
      organizationId: tenant.organization.id,
      operation: "ebay.offer.publish",
      key: idempotencyKey,
      request: { offerId, ...body },
      responseStatus: 202,
      execute: () => createOfferPublishJob({
        organizationId: tenant.organization.id,
        userId: tenant.user.id,
        offerId,
        confirmPublish: true,
      }),
    });
    res.set("Idempotency-Replayed", String(result.replayed)).status(202).json(result.value);
    if (!result.replayed && getConfig().jobs.executionMode === "inline") startOfferJob(result.value.id);
  } catch (error) { next(error); }
});

app.get("/api/ebay/offers/:id", requireTenantContext, async (req, res, next) => {
  try {
    const offerId = req.params.id;
    if (typeof offerId !== "string") return res.status(400).json({ error: "Invalid eBay offer ID" });
    res.json(await getOffer(getTenantContext(res).organization.id, offerId));
  } catch (error) { next(error); }
});

app.get("/api/listing-drafts/:id/ebay-offer", requireTenantContext, async (req, res, next) => {
  try {
    const listingDraftId = req.params.id;
    if (typeof listingDraftId !== "string") return res.status(400).json({ error: "Invalid listing draft ID" });
    res.json(await getOfferByDraft(getTenantContext(res).organization.id, listingDraftId));
  } catch (error) { next(error); }
});

app.get("/api/ebay/offer-jobs/:id", requireTenantContext, async (req, res, next) => {
  try {
    const jobId = req.params.id;
    if (typeof jobId !== "string") return res.status(400).json({ error: "Invalid eBay offer job ID" });
    res.json(await getOfferJob(getTenantContext(res).organization.id, jobId));
  } catch (error) { next(error); }
});

app.post("/api/ebay/offers/:id/revise", writeRateLimit, requireTenantContext, listingDraftRoles, async (req, res, next) => {
  try {
    const offerId = req.params.id;
    if (typeof offerId !== "string") return res.status(400).json({ error: "Invalid eBay offer ID" });
    const body = z.object({
      inventorySyncJobId: z.string().min(1),
      confirmRevision: z.literal(true),
      confirmation: z.literal("REVISE"),
    }).strict().parse(req.body);
    const tenant = getTenantContext(res);
    const idempotencyKey = idempotencyKeySchema.parse(req.get("Idempotency-Key"));
    if (!idempotencyKey) return res.status(400).json({ error: "Idempotency-Key is required for listing revision" });
    const result = await executeIdempotent({
      organizationId: tenant.organization.id,
      operation: "ebay.listing.revise",
      key: idempotencyKey,
      request: { offerId, ...body },
      responseStatus: 202,
      execute: () => createRevisionJob({
        organizationId: tenant.organization.id,
        userId: tenant.user.id,
        offerId,
        inventorySyncJobId: body.inventorySyncJobId,
        confirmRevision: true,
      }),
    });
    res.set("Idempotency-Replayed", String(result.replayed)).status(202).json(result.value);
    if (!result.replayed && getConfig().jobs.executionMode === "inline") startListingOperationJob(result.value.id);
  } catch (error) { next(error); }
});

app.post("/api/ebay/offers/:id/withdraw", writeRateLimit, requireTenantContext, listingDraftRoles, async (req, res, next) => {
  try {
    const offerId = req.params.id;
    if (typeof offerId !== "string") return res.status(400).json({ error: "Invalid eBay offer ID" });
    const body = z.object({ confirmWithdraw: z.literal(true), confirmation: z.literal("WITHDRAW") }).strict().parse(req.body);
    const tenant = getTenantContext(res);
    const idempotencyKey = idempotencyKeySchema.parse(req.get("Idempotency-Key"));
    if (!idempotencyKey) return res.status(400).json({ error: "Idempotency-Key is required for listing withdrawal" });
    const result = await executeIdempotent({
      organizationId: tenant.organization.id,
      operation: "ebay.listing.withdraw",
      key: idempotencyKey,
      request: { offerId, ...body },
      responseStatus: 202,
      execute: () => createWithdrawalJob({
        organizationId: tenant.organization.id,
        userId: tenant.user.id,
        offerId,
        confirmWithdraw: true,
      }),
    });
    res.set("Idempotency-Replayed", String(result.replayed)).status(202).json(result.value);
    if (!result.replayed && getConfig().jobs.executionMode === "inline") startListingOperationJob(result.value.id);
  } catch (error) { next(error); }
});

app.post("/api/ebay/offers/:id/reconcile", writeRateLimit, requireTenantContext, listingDraftRoles, async (req, res, next) => {
  try {
    const offerId = req.params.id;
    if (typeof offerId !== "string") return res.status(400).json({ error: "Invalid eBay offer ID" });
    z.object({}).strict().parse(req.body);
    const tenant = getTenantContext(res);
    const idempotencyKey = idempotencyKeySchema.parse(req.get("Idempotency-Key"));
    if (!idempotencyKey) return res.status(400).json({ error: "Idempotency-Key is required for reconciliation" });
    const result = await executeIdempotent({
      organizationId: tenant.organization.id,
      operation: "ebay.listing.reconcile",
      key: idempotencyKey,
      request: { offerId },
      responseStatus: 202,
      execute: () => createReconciliationJob({ organizationId: tenant.organization.id, userId: tenant.user.id, offerId }),
    });
    res.set("Idempotency-Replayed", String(result.replayed)).status(202).json(result.value);
    if (!result.replayed && getConfig().jobs.executionMode === "inline") startListingOperationJob(result.value.id);
  } catch (error) { next(error); }
});

app.get("/api/ebay/listing-operation-jobs/:id", requireTenantContext, async (req, res, next) => {
  try {
    const jobId = req.params.id;
    if (typeof jobId !== "string") return res.status(400).json({ error: "Invalid eBay listing operation job ID" });
    res.json(await getListingOperationJob(getTenantContext(res).organization.id, jobId));
  } catch (error) { next(error); }
});

app.get("/api/admin/dead-letters", requireTenantContext, deadLetterRoles, async (req, res, next) => {
  try {
    const query = deadLetterQuerySchema.parse(req.query);
    res.json(await listDeadLetters(getTenantContext(res).organization.id, query));
  } catch (error) { next(error); }
});

app.get("/api/admin/overview", requireTenantContext, adminOperationsRoles, async (_req, res, next) => {
  try {
    res.json(await getAdminOverview(getTenantContext(res).organization.id));
  } catch (error) { next(error); }
});

app.post("/api/admin/email/verify", authRateLimit, requireTenantContext, adminOperationsRoles, async (_req, res, next) => {
  try {
    res.json(await verifyEmailTransport());
  } catch (error) { next(error); }
});

app.get("/api/team", requireTenantContext, teamManagementRoles, async (_req, res, next) => {
  try {
    res.json(await listOrganizationTeam(getTenantContext(res).organization.id));
  } catch (error) { next(error); }
});

app.post("/api/team/invitations", writeRateLimit, requireTenantContext, teamManagementRoles, async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const input = createInvitationSchema.parse(req.body);
    res.status(201).json(await createOrganizationInvitation({
      organizationId: tenant.organization.id,
      actorUserId: tenant.user.id,
      actorRole: tenant.role,
      ...input,
      requestId: res.locals.requestId,
    }));
  } catch (error) { next(error); }
});

app.delete("/api/team/invitations/:id", writeRateLimit, requireTenantContext, teamManagementRoles, async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const invitationId = z.string().min(1).parse(req.params.id);
    res.json(await revokeOrganizationInvitation({
      organizationId: tenant.organization.id,
      actorUserId: tenant.user.id,
      actorRole: tenant.role,
      invitationId,
      requestId: res.locals.requestId,
    }));
  } catch (error) { next(error); }
});

app.patch("/api/team/members/:id", writeRateLimit, requireTenantContext, teamManagementRoles, async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const membershipId = z.string().min(1).parse(req.params.id);
    const { role } = changeMemberRoleSchema.parse(req.body);
    res.json(await changeOrganizationMemberRole({
      organizationId: tenant.organization.id,
      actorUserId: tenant.user.id,
      actorRole: tenant.role,
      membershipId,
      role,
      requestId: res.locals.requestId,
    }));
  } catch (error) { next(error); }
});

app.delete("/api/team/members/:id", writeRateLimit, requireTenantContext, teamManagementRoles, async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const membershipId = z.string().min(1).parse(req.params.id);
    res.json(await removeOrganizationMember({
      organizationId: tenant.organization.id,
      actorUserId: tenant.user.id,
      actorRole: tenant.role,
      membershipId,
      requestId: res.locals.requestId,
    }));
  } catch (error) { next(error); }
});

app.get("/api/admin/audit-events", requireTenantContext, adminOperationsRoles, async (req, res, next) => {
  try {
    const query = adminAuditQuerySchema.parse(req.query);
    res.json(await listAuditEvents(getTenantContext(res).organization.id, query));
  } catch (error) { next(error); }
});

app.get("/api/admin/publishing", requireTenantContext, adminOperationsRoles, async (req, res, next) => {
  try {
    const query = adminPublishingQuerySchema.parse(req.query);
    res.json(await listPublishingOperations(getTenantContext(res).organization.id, query));
  } catch (error) { next(error); }
});

app.get("/api/admin/failed-jobs", requireTenantContext, adminOperationsRoles, async (req, res, next) => {
  try {
    const query = adminListQuerySchema.parse(req.query);
    res.json(await listFailedJobs(getTenantContext(res).organization.id, query.limit));
  } catch (error) { next(error); }
});

app.post("/api/admin/jobs/:type/:id/retry", writeRateLimit, requireTenantContext, adminOperationsRoles, async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const jobType = adminJobTypeSchema.parse(req.params.type);
    const jobId = z.string().min(1).parse(req.params.id);
    res.status(202).json(await retryAdminJob({
      organizationId: tenant.organization.id,
      userId: tenant.user.id,
      jobType,
      jobId,
      requestId: res.locals.requestId,
    }));
  } catch (error) { next(error); }
});

app.post("/api/admin/dead-letters/:id/requeue", writeRateLimit, requireTenantContext, deadLetterRoles, async (req, res, next) => {
  try {
    const entryId = req.params.id;
    if (typeof entryId !== "string") return res.status(400).json({ error: "Invalid dead-letter entry ID" });
    const tenant = getTenantContext(res);
    res.json(await requeueDeadLetter(tenant.organization.id, entryId, { userId: tenant.user.id, requestId: res.locals.requestId }));
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
  if (error instanceof PricingGovernanceError) return response(error.statusCode, { error: error.message });
  if (error instanceof FitmentJobError) return response(error.statusCode, { error: error.message });
  if (error instanceof ManualFitmentError) return response(error.statusCode, { error: error.message });
  if (error instanceof IdempotencyError) return response(error.statusCode, { error: error.message });
  if (error instanceof DeadLetterError) return response(error.statusCode, { error: error.message });
  if (error instanceof ListingDraftError) return response(error.statusCode, { error: error.message });
  if (error instanceof InventoryPreparationError) return response(error.statusCode, { error: error.message });
  if (error instanceof EbayInventorySyncError) return response(error.statusCode, { error: error.message });
  if (error instanceof EbayOfferError) return response(error.statusCode, { error: error.message });
  if (error instanceof EbayListingOperationError) return response(error.statusCode, { error: error.message });
  if (error instanceof AdminOperationsError) return response(error.statusCode, { error: error.message });
  if (error instanceof OrganizationTeamError) return response(error.statusCode, { error: error.message });
  if (error instanceof AccountAuthError) return response(error.statusCode, { error: error.message, ...(error.details ? { details: error.details } : {}) });
  if (error instanceof EmailDeliveryError) return response(503, { error: error.message });
  if (error instanceof EbaySellerOAuthError) return response(error.statusCode, { error: error.message });
  if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
    return response(413, { error: "Request body exceeds the configured upload limit" });
  }
  if (error instanceof z.ZodError) return response(400, { error: "Invalid request", issues: error.issues });
  if (error instanceof EbayApiError) return response(502, { error: error.message, provider: "ebay" });
  console.error(JSON.stringify({ type: "unhandled_request_error", requestId: res.locals.requestId, method: req.method, path: req.path, error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { name: "UnknownError" } }));
  response(500, { error: "Unable to complete the request. Check the API logs for details." });
});
