import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "./db.js";
import { getConfig, type EbayEnvironment } from "./config.js";

export class EbaySellerOAuthError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 | 502 | 503 = 400) {
    super(message);
    this.name = "EbaySellerOAuthError";
  }
}

export interface EncryptedSecret {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  tag: Uint8Array<ArrayBuffer>;
}
interface EbayUserTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type?: string;
}

const stateTtlMs = 10 * 60_000;

function oauthConfig() {
  const { ebay } = getConfig();
  const missing = [
    !ebay.clientId && "EBAY_CLIENT_ID",
    !ebay.clientSecret && "EBAY_CLIENT_SECRET",
    !ebay.oauth.ruName && "EBAY_RUNAME",
    !ebay.oauth.encryptionKey && "EBAY_OAUTH_ENCRYPTION_KEY",
  ].filter(Boolean) as string[];
  if (missing.length) {
    throw new EbaySellerOAuthError(
      `eBay seller OAuth is not configured. Set ${missing.join(", ")} in the API .env, then restart the API.`,
      503,
    );
  }
  return {
    environment: ebay.environment,
    clientId: ebay.clientId!,
    clientSecret: ebay.clientSecret!,
    ruName: ebay.oauth.ruName!,
    encryptionKey: ebay.oauth.encryptionKey!,
    scopes: ebay.oauth.scopes,
  };
}

function authBase(environment: EbayEnvironment): string {
  return environment === "production" ? "https://auth.ebay.com" : "https://auth.sandbox.ebay.com";
}

function apiBase(environment: EbayEnvironment): string {
  return environment === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

function identityApiBase(environment: EbayEnvironment): string {
  return environment === "production" ? "https://apiz.ebay.com" : "https://apiz.sandbox.ebay.com";
}

export function encryptSellerToken(value: string, key: Buffer): EncryptedSecret {
  if (key.length !== 32) throw new Error("Seller token encryption requires a 32-byte key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext: Uint8Array.from(ciphertext), iv: Uint8Array.from(iv), tag: Uint8Array.from(cipher.getAuthTag()) };
}

export function decryptSellerToken(secret: { ciphertext: Uint8Array; iv: Uint8Array; tag: Uint8Array }, key: Buffer): string {
  if (key.length !== 32) throw new Error("Seller token encryption requires a 32-byte key");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv));
  decipher.setAuthTag(Buffer.from(secret.tag));
  return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext)), decipher.final()]).toString("utf8");
}

export function buildEbayConsentUrl(input: {
  environment: EbayEnvironment; clientId: string; ruName: string; scopes: string[]; state: string;
}): string {
  const query = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.ruName,
    response_type: "code",
    scope: input.scopes.join(" "),
    state: input.state,
  });
  return `${authBase(input.environment)}/oauth2/authorize?${query}`;
}

function stateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

async function tokenRequest(config: ReturnType<typeof oauthConfig>, body: URLSearchParams): Promise<EbayUserTokenResponse> {
  const response = await fetch(`${apiBase(config.environment)}/identity/v1/oauth2/token`, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) {
    let reason = "";
    try {
      const error = await response.json() as { error?: string; error_description?: string };
      reason = error.error_description ?? error.error ?? "";
    } catch { /* eBay may return a non-JSON gateway error. */ }
    throw new EbaySellerOAuthError(`eBay token request failed (${response.status})${reason ? `: ${reason}` : ""}`, 502);
  }
  const token = await response.json() as EbayUserTokenResponse;
  if (!token.access_token || !Number.isFinite(token.expires_in)) throw new EbaySellerOAuthError("eBay returned an invalid token response", 502);
  return token;
}

async function fetchEbayIdentity(environment: EbayEnvironment, accessToken: string) {
  const response = await fetch(`${identityApiBase(environment)}/commerce/identity/v1/user`, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new EbaySellerOAuthError(`eBay identity lookup failed (${response.status})`, 502);
  return response.json() as Promise<{
    userId?: string; username?: string; accountType?: string; registrationMarketplaceId?: string;
  }>;
}

export function ebayOAuthRedirectReason(error: unknown): "declined" | "state" | "token" | "identity" | "config" | "callback" | "unknown" {
  if (error instanceof EbaySellerOAuthError) {
    const message = error.message.toLowerCase();
    if (message.includes("declined") || message.includes("cancelled")) return "declined";
    if (message.includes("state")) return "state";
    if (message.includes("token")) return "token";
    if (message.includes("identity")) return "identity";
    if (message.includes("not configured")) return "config";
  }
  if (error && typeof error === "object" && "issues" in error) return "callback";
  return "unknown";
}

export function ebayOAuthRedirectMessage(error: unknown): string | undefined {
  if (!(error instanceof EbaySellerOAuthError)) return undefined;
  const message = error.message.trim();
  if (!message || message.length > 240) return message.slice(0, 240);
  return message;
}

export function getEbayOAuthSetupStatus() {
  const { ebay } = getConfig();
  const missing = [
    !ebay.clientId && "EBAY_CLIENT_ID",
    !ebay.clientSecret && "EBAY_CLIENT_SECRET",
    !ebay.oauth.ruName && "EBAY_RUNAME",
    !ebay.oauth.encryptionKey && "EBAY_OAUTH_ENCRYPTION_KEY",
  ].filter(Boolean) as string[];
  if (missing.length) {
    return {
      configured: false as const,
      missing,
      message: `Set ${missing.join(", ")} on the API service, then redeploy.`,
    };
  }
  const ruName = ebay.oauth.ruName!;
  return {
    configured: true as const,
    environment: ebay.environment,
    ruNamePreview: ruName.length > 10 ? `${ruName.slice(0, 6)}…${ruName.slice(-6)}` : ruName,
    ruNameLooksValid: !/^https?:\/\//i.test(ruName),
    scopes: ebay.oauth.scopes,
  };
}

export async function createEbayAuthorization(organizationId: string, userId: string) {
  const config = oauthConfig();
  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + stateTtlMs);
  await prisma.$transaction([
    prisma.ebayOAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    prisma.ebayOAuthState.create({ data: { stateHash: stateHash(state), organizationId, userId, expiresAt } }),
  ]);
  return { authorizationUrl: buildEbayConsentUrl({ ...config, state }), expiresAt };
}

async function consumeOAuthState(state: string) {
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(state)) throw new EbaySellerOAuthError("Invalid eBay authorization state");
  return prisma.$transaction(async (tx) => {
    const record = await tx.ebayOAuthState.findUnique({ where: { stateHash: stateHash(state) } });
    if (!record || record.consumedAt || record.expiresAt <= new Date()) throw new EbaySellerOAuthError("eBay authorization state is invalid or expired");
    const consumed = await tx.ebayOAuthState.updateMany({
      where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new EbaySellerOAuthError("eBay authorization state has already been used", 409);
    return record;
  });
}

export async function completeEbayAuthorization(input: { state: string; code?: string; providerError?: string }) {
  const state = await consumeOAuthState(input.state);
  if (input.providerError) throw new EbaySellerOAuthError("eBay authorization was declined or cancelled");
  if (!input.code) throw new EbaySellerOAuthError("eBay authorization code is missing");
  const config = oauthConfig();
  const token = await tokenRequest(config, new URLSearchParams({
    grant_type: "authorization_code", code: input.code, redirect_uri: config.ruName,
  }));
  if (!token.refresh_token) throw new EbaySellerOAuthError("eBay did not return a refresh token", 502);
  const refreshTokenExpiresIn = Number.isFinite(token.refresh_token_expires_in) && token.refresh_token_expires_in! > 0
    ? token.refresh_token_expires_in!
    : 47304000;
  const identity = await fetchEbayIdentity(config.environment, token.access_token);
  if (!identity.userId) throw new EbaySellerOAuthError("eBay identity response is missing the immutable user ID", 502);
  const access = encryptSellerToken(token.access_token, config.encryptionKey);
  const refresh = encryptSellerToken(token.refresh_token, config.encryptionKey);
  const now = new Date();
  const existingCount = await prisma.ebaySellerConnection.count({ where: { organizationId: state.organizationId } });
  await prisma.ebaySellerConnection.upsert({
    where: {
      organizationId_environment_ebayUserId: {
        organizationId: state.organizationId,
        environment: config.environment,
        ebayUserId: identity.userId,
      },
    },
    create: {
      organizationId: state.organizationId, connectedById: state.userId, environment: config.environment,
      isDefault: existingCount === 0,
      status: "ACTIVE", ebayUserId: identity.userId, username: identity.username, accountType: identity.accountType,
      registrationMarketplace: identity.registrationMarketplaceId, scopes: config.scopes,
      accessTokenCiphertext: access.ciphertext, accessTokenIv: access.iv, accessTokenTag: access.tag,
      refreshTokenCiphertext: refresh.ciphertext, refreshTokenIv: refresh.iv, refreshTokenTag: refresh.tag,
      accessTokenExpiresAt: new Date(now.getTime() + token.expires_in * 1_000),
      refreshTokenExpiresAt: new Date(now.getTime() + refreshTokenExpiresIn * 1_000), lastRefreshedAt: now,
    },
    update: {
      connectedById: state.userId, environment: config.environment, status: "ACTIVE", ebayUserId: identity.userId,
      username: identity.username, accountType: identity.accountType, registrationMarketplace: identity.registrationMarketplaceId,
      scopes: config.scopes, accessTokenCiphertext: access.ciphertext, accessTokenIv: access.iv, accessTokenTag: access.tag,
      refreshTokenCiphertext: refresh.ciphertext, refreshTokenIv: refresh.iv, refreshTokenTag: refresh.tag,
      accessTokenExpiresAt: new Date(now.getTime() + token.expires_in * 1_000),
      refreshTokenExpiresAt: new Date(now.getTime() + refreshTokenExpiresIn * 1_000),
      lastRefreshedAt: now, lastError: null, disconnectedAt: null,
    },
  });
  return { organizationId: state.organizationId };
}

function publicConnection(connection: {
  id: string; environment: string; status: string; ebayUserId: string | null; username: string | null;
  isDefault: boolean; defaultMarketplace: string; defaultPaymentPolicyId: string | null;
  defaultReturnPolicyId: string | null; defaultShippingPolicyId: string | null; defaultMerchantLocationKey: string | null;
  accountType: string | null; registrationMarketplace: string | null; scopes: string[];
  accessTokenExpiresAt: Date | null; refreshTokenExpiresAt: Date | null; lastRefreshedAt: Date | null;
  lastError: string | null; connectedBy: { id: string; email: string; name: string | null }; createdAt: Date; updatedAt: Date;
}) {
  return { ...connection, connected: connection.status === "ACTIVE" };
}

const publicConnectionSelect = {
  id: true, environment: true, status: true, ebayUserId: true, username: true, accountType: true,
  isDefault: true, defaultMarketplace: true, defaultPaymentPolicyId: true, defaultReturnPolicyId: true,
  defaultShippingPolicyId: true, defaultMerchantLocationKey: true,
  registrationMarketplace: true, scopes: true, accessTokenExpiresAt: true, refreshTokenExpiresAt: true,
  lastRefreshedAt: true, lastError: true, connectedBy: { select: { id: true, email: true, name: true } },
  createdAt: true, updatedAt: true,
};

export async function getEbayConnection(organizationId: string) {
  const connection = await prisma.ebaySellerConnection.findFirst({
    where: { organizationId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: publicConnectionSelect,
  });
  const setup = getEbayOAuthSetupStatus();
  if (connection) return { ...publicConnection(connection), setup };
  return { connected: false, status: "NOT_CONNECTED" as const, setup };
}

export async function listEbayConnections(organizationId: string) {
  const connections = await prisma.ebaySellerConnection.findMany({
    where: { organizationId },
    orderBy: [{ isDefault: "desc" }, { username: "asc" }, { createdAt: "asc" }],
    select: publicConnectionSelect,
  });
  return { connections: connections.map(publicConnection), setup: getEbayOAuthSetupStatus() };
}

export async function updateEbayConnectionDefaults(input: {
  organizationId: string;
  connectionId: string;
  isDefault?: boolean;
  defaultMarketplace: string;
  defaultPaymentPolicyId: string;
  defaultReturnPolicyId: string;
  defaultShippingPolicyId: string;
  defaultMerchantLocationKey: string;
}) {
  const connection = await prisma.ebaySellerConnection.findFirst({
    where: { id: input.connectionId, organizationId: input.organizationId },
    select: { id: true, status: true, isDefault: true },
  });
  if (!connection) throw new EbaySellerOAuthError("eBay seller account not found", 404);
  if (connection.status !== "ACTIVE") throw new EbaySellerOAuthError("Reconnect this eBay account before assigning defaults", 409);
  if (connection.isDefault && input.isDefault === false) {
    throw new EbaySellerOAuthError("Choose another account as default before removing this default", 409);
  }
  const resources = await prisma.ebaySellerResource.findMany({
    where: {
      organizationId: input.organizationId,
      ebaySellerConnectionId: input.connectionId,
      marketplace: input.defaultMarketplace,
      enabled: true,
    },
    select: { type: true, remoteId: true },
  });
  const owns = (type: "PAYMENT_POLICY" | "RETURN_POLICY" | "FULFILLMENT_POLICY" | "INVENTORY_LOCATION", id: string) =>
    resources.some((resource) => resource.type === type && resource.remoteId === id);
  if (!owns("PAYMENT_POLICY", input.defaultPaymentPolicyId)
    || !owns("RETURN_POLICY", input.defaultReturnPolicyId)
    || !owns("FULFILLMENT_POLICY", input.defaultShippingPolicyId)
    || !owns("INVENTORY_LOCATION", input.defaultMerchantLocationKey)) {
    throw new EbaySellerOAuthError("Sync this account and select policies and a location that belong to it", 409);
  }
  await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.ebaySellerConnection.updateMany({
        where: { organizationId: input.organizationId, id: { not: input.connectionId }, isDefault: true },
        data: { isDefault: false },
      });
    }
    await tx.ebaySellerConnection.update({
      where: { id: input.connectionId },
      data: {
        ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
        defaultMarketplace: input.defaultMarketplace,
        defaultPaymentPolicyId: input.defaultPaymentPolicyId,
        defaultReturnPolicyId: input.defaultReturnPolicyId,
        defaultShippingPolicyId: input.defaultShippingPolicyId,
        defaultMerchantLocationKey: input.defaultMerchantLocationKey,
      },
    });
  });
  return listEbayConnections(input.organizationId);
}

export async function disconnectEbayConnection(organizationId: string, connectionId?: string) {
  const connection = await prisma.ebaySellerConnection.findFirst({
    where: { organizationId, ...(connectionId ? { id: connectionId } : {}) },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, isDefault: true },
  });
  if (!connection) return { connected: false, status: "NOT_CONNECTED" as const };
  await prisma.$transaction(async (tx) => {
    await tx.ebaySellerConnection.update({ where: { id: connection.id }, data: {
      status: "DISCONNECTED", accessTokenCiphertext: null, accessTokenIv: null, accessTokenTag: null,
      refreshTokenCiphertext: null, refreshTokenIv: null, refreshTokenTag: null, accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null, disconnectedAt: new Date(), lastError: null,
    } });
    await tx.ebaySellerResource.deleteMany({ where: { ebaySellerConnectionId: connection.id } });
    if (connection.isDefault) {
      const replacement = await tx.ebaySellerConnection.findFirst({
        where: { organizationId, id: { not: connection.id }, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (replacement) await tx.ebaySellerConnection.update({ where: { id: replacement.id }, data: { isDefault: true } });
    }
  });
  return listEbayConnections(organizationId);
}

export async function getEbaySellerAccessToken(organizationId: string, connectionId?: string): Promise<string> {
  const config = oauthConfig();
  const connection = await prisma.ebaySellerConnection.findFirst({
    where: { organizationId, ...(connectionId ? { id: connectionId } : {}) },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  if (!connection || (connection.status !== "ACTIVE" && connection.status !== "ERROR")) {
    throw new EbaySellerOAuthError("An active eBay seller connection is required", 409);
  }
  const hasAccess = connection.accessTokenCiphertext && connection.accessTokenIv && connection.accessTokenTag;
  if (hasAccess && connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() > Date.now() + 5 * 60_000) {
    return decryptSellerToken({ ciphertext: connection.accessTokenCiphertext!, iv: connection.accessTokenIv!, tag: connection.accessTokenTag! }, config.encryptionKey);
  }
  const hasRefresh = connection.refreshTokenCiphertext && connection.refreshTokenIv && connection.refreshTokenTag;
  if (!hasRefresh || !connection.refreshTokenExpiresAt || connection.refreshTokenExpiresAt <= new Date()) {
    await prisma.ebaySellerConnection.update({ where: { id: connection.id }, data: { status: "EXPIRED", lastError: "Refresh token expired; reconnect the eBay account" } });
    throw new EbaySellerOAuthError("eBay seller authorization has expired; reconnect the account", 409);
  }
  try {
    const refreshToken = decryptSellerToken({ ciphertext: connection.refreshTokenCiphertext!, iv: connection.refreshTokenIv!, tag: connection.refreshTokenTag! }, config.encryptionKey);
    const token = await tokenRequest(config, new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, scope: connection.scopes.join(" ") }));
    const access = encryptSellerToken(token.access_token, config.encryptionKey);
    const now = new Date();
    await prisma.ebaySellerConnection.update({ where: { id: connection.id }, data: {
      status: "ACTIVE",
      accessTokenCiphertext: access.ciphertext, accessTokenIv: access.iv, accessTokenTag: access.tag,
      accessTokenExpiresAt: new Date(now.getTime() + token.expires_in * 1_000), lastRefreshedAt: now, lastError: null,
    } });
    return token.access_token;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "eBay token refresh failed";
    await prisma.ebaySellerConnection.update({ where: { id: connection.id }, data: { status: "ERROR", lastError: message } });
    throw error;
  }
}
