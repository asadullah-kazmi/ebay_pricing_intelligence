import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  AuthorizationError,
  createAccessToken,
  createRefreshToken,
  type JwtConfiguration,
  verifyAccessToken,
  verifyRefreshToken,
} from "./auth.js";
import { issueTokenPair, rotateTokenPair, type RefreshSessionStore } from "./auth-sessions.js";
import { resolveTenantContext } from "./tenant-context.js";

const jwt: JwtConfiguration = {
  accessSecret: "test-access-secret-with-at-least-32-characters",
  refreshSecret: "test-refresh-secret-with-at-least-32-characters",
  issuer: "partpulse-api",
  audience: "partpulse-web",
  accessTtlSeconds: 900,
  refreshTtlSeconds: 2_592_000,
};
const now = new Date("2026-07-19T12:00:00.000Z");

function createMemoryStore(hasMembership = true): RefreshSessionStore & { sessions: Map<string, { tokenHash: string; revoked: boolean }> } {
  const sessions = new Map<string, { tokenHash: string; revoked: boolean }>();
  return {
    sessions,
    async membershipExists() { return hasMembership; },
    async create(session) { sessions.set(session.id, { tokenHash: session.tokenHash, revoked: false }); },
    async rotate(oldSessionId, oldTokenHash, replacement) {
      const current = sessions.get(oldSessionId);
      if (!current || current.revoked || current.tokenHash !== oldTokenHash) return false;
      current.revoked = true;
      sessions.set(replacement.id, { tokenHash: replacement.tokenHash, revoked: false });
      return true;
    },
    async revoke(sessionId, tokenHash) {
      const current = sessions.get(sessionId);
      if (current?.tokenHash === tokenHash) current.revoked = true;
    },
  };
}

describe("JWT authentication", () => {
  it("verifies signed access and refresh tokens with distinct token types", async () => {
    const accessToken = await createAccessToken({ userId: "user-1", organizationId: "org-1" }, jwt, now);
    const refreshToken = await createRefreshToken({ userId: "user-1", organizationId: "org-1" }, jwt, now);

    await expect(verifyAccessToken(accessToken, jwt, now)).resolves.toMatchObject({
      sub: "user-1",
      organizationId: "org-1",
      tokenType: "access",
    });
    await expect(verifyRefreshToken(refreshToken.token, jwt, now)).resolves.toMatchObject({
      jti: refreshToken.sessionId,
      tokenType: "refresh",
    });
    await expect(verifyAccessToken(refreshToken.token, jwt, now)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects tampered and expired access tokens", async () => {
    const token = await createAccessToken({ userId: "user-1", organizationId: "org-1" }, jwt, now);
    await expect(verifyAccessToken(`${token.slice(0, -1)}x`, jwt, now)).rejects.toBeInstanceOf(AuthenticationError);
    await expect(verifyAccessToken(token, jwt, new Date(now.getTime() + jwt.accessTtlSeconds * 1_000))).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("derives tenant identity and role from the database membership", async () => {
    const token = await createAccessToken({ userId: "user-1", organizationId: "org-1" }, jwt, now);
    const membershipLookup = vi.fn().mockResolvedValue({
      user: { id: "user-1", email: "owner@example.com", name: "Owner" },
      organization: { id: "org-1", name: "Acme Auto", slug: "acme-auto" },
      role: "OWNER",
    });

    const context = await resolveTenantContext({ authorization: `Bearer ${token}`, jwt, now, membershipLookup });

    expect(membershipLookup).toHaveBeenCalledWith("user-1", "org-1");
    expect(context.role).toBe("OWNER");
  });

  it("rejects a valid access token when its user has no membership", async () => {
    const token = await createAccessToken({ userId: "user-1", organizationId: "org-2" }, jwt, now);
    await expect(resolveTenantContext({
      authorization: `Bearer ${token}`,
      jwt,
      now,
      membershipLookup: async () => null,
    })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("stores a refresh session, rotates it once, and rejects replay", async () => {
    const store = createMemoryStore();
    const original = await issueTokenPair({ userId: "user-1", organizationId: "org-1" }, jwt, store, now);
    expect(store.sessions.size).toBe(1);
    expect([...store.sessions.values()][0]?.tokenHash).not.toBe(original.refreshToken);

    const replacement = await rotateTokenPair(original.refreshToken, jwt, store, new Date(now.getTime() + 1_000));
    await expect(verifyAccessToken(replacement.accessToken, jwt, new Date(now.getTime() + 1_000))).resolves.toMatchObject({
      sub: "user-1",
      organizationId: "org-1",
    });
    await expect(rotateTokenPair(original.refreshToken, jwt, store, new Date(now.getTime() + 2_000)))
      .rejects.toThrow("already been used or revoked");
  });

  it("does not issue a token pair without an active membership", async () => {
    await expect(issueTokenPair(
      { userId: "user-1", organizationId: "org-1" },
      jwt,
      createMemoryStore(false),
      now,
    )).rejects.toBeInstanceOf(AuthorizationError);
  });
});
