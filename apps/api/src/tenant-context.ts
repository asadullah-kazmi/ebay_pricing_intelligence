import type { RequestHandler, Response } from "express";
import { AuthenticationError, AuthorizationError, type OrganizationRole, verifyApplicationToken } from "./auth.js";
import { getConfig } from "./config.js";
import { prisma } from "./db.js";

export interface TenantContext {
  user: { id: string; email: string; name: string | null };
  organization: { id: string; name: string; slug: string };
  role: OrganizationRole;
}

interface MembershipRecord extends TenantContext {}

export type MembershipLookup = (userId: string, organizationId: string) => Promise<MembershipRecord | null>;

async function findMembership(userId: string, organizationId: string): Promise<MembershipRecord | null> {
  const membership = await prisma.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: {
      role: true,
      user: { select: { id: true, email: true, name: true } },
      organization: { select: { id: true, name: true, slug: true } },
    },
  });
  return membership ? { ...membership, role: membership.role as OrganizationRole } : null;
}

function readBearerToken(authorization: string | undefined): string {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match?.[1]) throw new AuthenticationError("Authentication required");
  return match[1];
}

export async function resolveTenantContext(input: {
  authorization?: string;
  secret: string;
  issuer: string;
  audience: string;
  membershipLookup?: MembershipLookup;
  now?: Date;
}): Promise<TenantContext> {
  const claims = verifyApplicationToken(readBearerToken(input.authorization), {
    secret: input.secret,
    issuer: input.issuer,
    audience: input.audience,
    now: input.now,
  });
  const membership = await (input.membershipLookup ?? findMembership)(claims.sub, claims.organizationId);
  if (!membership) throw new AuthorizationError("You do not belong to this organization");
  return membership;
}

export const requireTenantContext: RequestHandler = async (req, res, next) => {
  const auth = getConfig().auth;
  if (!auth.secret) return res.status(503).json({ error: "Application authentication is not configured" });
  try {
    res.locals.tenant = await resolveTenantContext({
      authorization: req.get("authorization"),
      secret: auth.secret,
      issuer: auth.issuer,
      audience: auth.audience,
    });
    next();
  } catch (error) {
    if (error instanceof AuthenticationError) return res.status(401).json({ error: error.message });
    if (error instanceof AuthorizationError) return res.status(403).json({ error: error.message });
    next(error);
  }
};

export function requireOrganizationRoles(...allowedRoles: OrganizationRole[]): RequestHandler {
  const allowed = new Set(allowedRoles);
  return (_req, res, next) => {
    const tenant = res.locals.tenant as TenantContext | undefined;
    if (!tenant) return res.status(401).json({ error: "Authentication required" });
    if (!allowed.has(tenant.role)) return res.status(403).json({ error: "Insufficient organization permission" });
    next();
  };
}

export function getTenantContext(res: Response): TenantContext {
  const tenant = res.locals.tenant as TenantContext | undefined;
  if (!tenant) throw new Error("Tenant context is unavailable; requireTenantContext must run first");
  return tenant;
}
