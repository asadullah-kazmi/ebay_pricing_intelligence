import type { CookieOptions, Request, Response } from "express";
import {
  AuthenticationError,
  AuthorizationError,
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
  type JwtConfiguration,
  verifyRefreshToken,
} from "./auth.js";
import { getConfig } from "./config.js";
import { prisma } from "./db.js";

export const refreshCookieName = "partpulse_refresh";

interface StoredRefreshSession {
  id: string;
  userId: string;
  organizationId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface RefreshSessionStore {
  membershipExists(userId: string, organizationId: string): Promise<boolean>;
  create(session: StoredRefreshSession): Promise<void>;
  rotate(oldSessionId: string, oldTokenHash: string, replacement: StoredRefreshSession, now: Date): Promise<boolean>;
  revoke(sessionId: string, tokenHash: string, now: Date): Promise<void>;
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
}

export const databaseRefreshSessionStore: RefreshSessionStore = {
  async membershipExists(userId, organizationId) {
    return (await prisma.organizationMembership.count({ where: { userId, organizationId } })) === 1;
  },
  async create(session) {
    await prisma.refreshSession.create({ data: session });
  },
  async rotate(oldSessionId, oldTokenHash, replacement, now) {
    return prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshSession.updateMany({
        where: { id: oldSessionId, tokenHash: oldTokenHash, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      if (revoked.count !== 1) return false;
      await tx.refreshSession.create({ data: replacement });
      return true;
    });
  },
  async revoke(sessionId, tokenHash, now) {
    await prisma.refreshSession.updateMany({
      where: { id: sessionId, tokenHash, revokedAt: null },
      data: { revokedAt: now },
    });
  },
};

export function getJwtConfiguration(): JwtConfiguration | null {
  const jwt = getConfig().jwt;
  if (!jwt.accessSecret || !jwt.refreshSecret) return null;
  return { ...jwt, accessSecret: jwt.accessSecret, refreshSecret: jwt.refreshSecret };
}

async function buildTokenPair(
  input: { userId: string; organizationId: string },
  config: JwtConfiguration,
  now: Date,
): Promise<{ pair: TokenPair; session: StoredRefreshSession }> {
  const [accessToken, refresh] = await Promise.all([
    createAccessToken(input, config, now),
    createRefreshToken(input, config, now),
  ]);
  const pair = {
    accessToken,
    accessTokenExpiresIn: config.accessTtlSeconds,
    refreshToken: refresh.token,
    refreshTokenExpiresIn: config.refreshTtlSeconds,
  };
  return {
    pair,
    session: {
      id: refresh.sessionId,
      ...input,
      tokenHash: hashRefreshToken(refresh.token),
      expiresAt: new Date(now.getTime() + config.refreshTtlSeconds * 1_000),
    },
  };
}

export async function issueTokenPair(
  input: { userId: string; organizationId: string },
  config: JwtConfiguration,
  store: RefreshSessionStore = databaseRefreshSessionStore,
  now = new Date(),
): Promise<TokenPair> {
  if (!(await store.membershipExists(input.userId, input.organizationId))) {
    throw new AuthorizationError("You do not belong to this organization");
  }
  const created = await buildTokenPair(input, config, now);
  await store.create(created.session);
  return created.pair;
}

export async function rotateTokenPair(
  refreshToken: string,
  config: JwtConfiguration,
  store: RefreshSessionStore = databaseRefreshSessionStore,
  now = new Date(),
): Promise<TokenPair> {
  const claims = await verifyRefreshToken(refreshToken, config, now);
  if (!(await store.membershipExists(claims.sub, claims.organizationId))) {
    throw new AuthorizationError("You do not belong to this organization");
  }
  const replacement = await buildTokenPair({ userId: claims.sub, organizationId: claims.organizationId }, config, now);
  const rotated = await store.rotate(claims.jti, hashRefreshToken(refreshToken), replacement.session, now);
  if (!rotated) throw new AuthenticationError("Refresh token has already been used or revoked");
  return replacement.pair;
}

export async function revokeRefreshToken(
  refreshToken: string,
  config: JwtConfiguration,
  store: RefreshSessionStore = databaseRefreshSessionStore,
  now = new Date(),
): Promise<void> {
  const claims = await verifyRefreshToken(refreshToken, config, now);
  await store.revoke(claims.jti, hashRefreshToken(refreshToken), now);
}

function refreshCookieOptions(maxAge?: number): CookieOptions {
  const production = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? "none" : "lax",
    path: "/api/auth",
    maxAge,
  };
}

export function setRefreshCookie(res: Response, pair: TokenPair): void {
  res.cookie(refreshCookieName, pair.refreshToken, refreshCookieOptions(pair.refreshTokenExpiresIn * 1_000));
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(refreshCookieName, refreshCookieOptions());
}

export function readRefreshCookie(req: Request): string {
  const cookies = req.get("cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== refreshCookieName) continue;
    const value = cookie.slice(separator + 1).trim();
    if (value) return decodeURIComponent(value);
  }
  throw new AuthenticationError("Refresh token is required");
}

export function assertTrustedAuthOrigin(req: Request): void {
  const expectedOrigin = getConfig().webOrigin;
  if (expectedOrigin && req.get("origin") !== expectedOrigin) {
    throw new AuthorizationError("Untrusted authentication request origin");
  }
}
