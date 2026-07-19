import { describe, expect, it, vi } from "vitest";
import { AuthenticationError, AuthorizationError, createApplicationToken, verifyApplicationToken } from "./auth.js";
import { resolveTenantContext } from "./tenant-context.js";

const auth = {
  secret: "test-only-secret-with-at-least-32-characters",
  issuer: "partpulse-api",
  audience: "partpulse-web",
};
const now = new Date("2026-07-19T12:00:00.000Z");

describe("application authentication", () => {
  it("verifies a signed, unexpired token", () => {
    const token = createApplicationToken(
      { userId: "user-1", organizationId: "org-1" },
      { ...auth, now, lifetimeSeconds: 900 },
    );
    expect(verifyApplicationToken(token, { ...auth, now })).toMatchObject({
      sub: "user-1",
      organizationId: "org-1",
    });
  });

  it("rejects tampered and expired tokens", () => {
    const token = createApplicationToken(
      { userId: "user-1", organizationId: "org-1" },
      { ...auth, now, lifetimeSeconds: 1 },
    );
    expect(() => verifyApplicationToken(`${token.slice(0, -1)}x`, { ...auth, now })).toThrow(AuthenticationError);
    expect(() => verifyApplicationToken(token, { ...auth, now: new Date(now.getTime() + 1_000) })).toThrow(AuthenticationError);
  });

  it("derives tenant identity and role from the database membership", async () => {
    const token = createApplicationToken(
      { userId: "user-1", organizationId: "org-1" },
      { ...auth, now },
    );
    const membershipLookup = vi.fn().mockResolvedValue({
      user: { id: "user-1", email: "owner@example.com", name: "Owner" },
      organization: { id: "org-1", name: "Acme Auto", slug: "acme-auto" },
      role: "OWNER",
    });

    const context = await resolveTenantContext({
      authorization: `Bearer ${token}`,
      ...auth,
      now,
      membershipLookup,
    });

    expect(membershipLookup).toHaveBeenCalledWith("user-1", "org-1");
    expect(context.role).toBe("OWNER");
  });

  it("rejects a valid token when its user has no membership", async () => {
    const token = createApplicationToken(
      { userId: "user-1", organizationId: "org-2" },
      { ...auth, now },
    );
    await expect(resolveTenantContext({
      authorization: `Bearer ${token}`,
      ...auth,
      now,
      membershipLookup: async () => null,
    })).rejects.toBeInstanceOf(AuthorizationError);
  });
});
