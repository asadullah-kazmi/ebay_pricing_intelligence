import { createHash, randomBytes } from "node:crypto";
import { Prisma, type OrganizationRole } from "@prisma/client";
import { issueTokenPair, type RefreshSessionStore, type TokenPair } from "./auth-sessions.js";
import { type JwtConfiguration } from "./auth.js";
import { recordAuditEvent } from "./audit-service.js";
import { getConfig } from "./config.js";
import { prisma } from "./db.js";
import { emailIsConfigured, sendOrganizationInvitationEmail } from "./email-service.js";

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1_000;
const privilegedRoles = new Set<OrganizationRole>(["OWNER", "ADMIN"]);

export class OrganizationTeamError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "OrganizationTeamError";
  }
}

export function normalizeInvitationEmail(email: string) {
  return email.trim().toLowerCase();
}

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function maskInvitationEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

export function canManageMemberRole(actorRole: OrganizationRole, targetRole: OrganizationRole, nextRole?: OrganizationRole) {
  if (actorRole === "OWNER") return true;
  if (actorRole !== "ADMIN") return false;
  if (privilegedRoles.has(targetRole)) return false;
  return !nextRole || !privilegedRoles.has(nextRole);
}

function assertInvitationRole(actorRole: OrganizationRole, role: OrganizationRole) {
  if (role === "OWNER") throw new OrganizationTeamError("Owner access must be granted by changing an existing member role", 409);
  if (actorRole === "ADMIN" && role === "ADMIN") throw new OrganizationTeamError("Only an owner can invite another administrator", 409);
}

function invitationUrl(token: string) {
  const origin = getConfig().webOrigin ?? "http://localhost:3000";
  return `${origin}/invitations/accept#token=${encodeURIComponent(token)}`;
}

async function lockOrganization(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
}

export async function listOrganizationTeam(organizationId: string) {
  const [members, invitations] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: { organizationId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, role: true, createdAt: true, updatedAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    }),
    prisma.organizationInvitation.findMany({
      where: { organizationId, status: { in: ["PENDING", "EXPIRED"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, email: true, role: true, status: true, expiresAt: true, createdAt: true,
        invitedBy: { select: { id: true, email: true, name: true } },
      },
    }),
  ]);
  const now = new Date();
  return {
    members,
    invitations: invitations.map((invitation) => ({
      ...invitation,
      status: invitation.status === "PENDING" && invitation.expiresAt <= now ? "EXPIRED" as const : invitation.status,
    })),
  };
}

export async function createOrganizationInvitation(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: OrganizationRole;
  email: string;
  role: OrganizationRole;
  requestId?: string;
}) {
  assertInvitationRole(input.actorRole, input.role);
  const email = normalizeInvitationEmail(input.email);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashInvitationToken(token);
  const expiresAt = new Date(Date.now() + invitationLifetimeMs);
  const invitation = await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, input.organizationId);
    const member = await tx.organizationMembership.findFirst({
      where: { organizationId: input.organizationId, user: { email: { equals: email, mode: "insensitive" } } },
      select: { id: true },
    });
    if (member) throw new OrganizationTeamError("This user is already a member of the organization", 409);
    const saved = await tx.organizationInvitation.upsert({
      where: { organizationId_email: { organizationId: input.organizationId, email } },
      create: {
        organizationId: input.organizationId,
        email,
        role: input.role,
        tokenHash,
        invitedById: input.actorUserId,
        expiresAt,
      },
      update: {
        role: input.role,
        tokenHash,
        invitedById: input.actorUserId,
        status: "PENDING",
        expiresAt,
        acceptedById: null,
        acceptedAt: null,
        revokedAt: null,
      },
      select: {
        id: true, email: true, role: true, status: true, expiresAt: true, createdAt: true,
        organization: { select: { name: true } },
      },
    });
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "organization.invitation.created",
      resourceType: "OrganizationInvitation",
      resourceId: saved.id,
      summary: `Invited ${email} as ${input.role.toLowerCase().replaceAll("_", " ")}`,
      metadata: { email, role: input.role, expiresAt: expiresAt.toISOString() },
      requestId: input.requestId,
    });
    return saved;
  });
  const url = invitationUrl(token);
  let emailDelivery: "sent" | "failed" | "not_configured" = "not_configured";
  if (emailIsConfigured()) {
    try {
      await sendOrganizationInvitationEmail(invitation.email, invitation.organization.name, invitation.role, url);
      emailDelivery = "sent";
    } catch (error) {
      emailDelivery = "failed";
      console.error(JSON.stringify({
        type: "organization_invitation_email_failed",
        invitationId: invitation.id,
        error: error instanceof Error ? error.message : "Unknown email error",
      }));
    }
  }
  return { ...invitation, invitationUrl: url, emailDelivery };
}

export async function revokeOrganizationInvitation(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: OrganizationRole;
  invitationId: string;
  requestId?: string;
}) {
  const invitation = await prisma.organizationInvitation.findFirst({
    where: { id: input.invitationId, organizationId: input.organizationId },
  });
  if (!invitation) throw new OrganizationTeamError("Invitation not found", 404);
  if (invitation.status !== "PENDING") throw new OrganizationTeamError("Only a pending invitation can be revoked", 409);
  if (input.actorRole === "ADMIN" && privilegedRoles.has(invitation.role)) {
    throw new OrganizationTeamError("Only an owner can revoke this invitation", 409);
  }
  return prisma.$transaction(async (tx) => {
    await lockOrganization(tx, input.organizationId);
    const current = await tx.organizationInvitation.findUnique({ where: { id: invitation.id } });
    if (!current || current.status !== "PENDING") throw new OrganizationTeamError("Only a pending invitation can be revoked", 409);
    if (input.actorRole === "ADMIN" && privilegedRoles.has(current.role)) {
      throw new OrganizationTeamError("Only an owner can revoke this invitation", 409);
    }
    const updated = await tx.organizationInvitation.update({
      where: { id: invitation.id },
      data: { status: "REVOKED", revokedAt: new Date() },
      select: { id: true, email: true, role: true, status: true, revokedAt: true },
    });
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "organization.invitation.revoked",
      resourceType: "OrganizationInvitation",
      resourceId: invitation.id,
      severity: "WARNING",
      summary: `Revoked invitation for ${invitation.email}`,
      metadata: { email: invitation.email, role: invitation.role },
      requestId: input.requestId,
    });
    return updated;
  });
}

export async function previewOrganizationInvitation(token: string) {
  const invitation = await prisma.organizationInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: { status: true, email: true, role: true, expiresAt: true, organization: { select: { name: true, slug: true } } },
  });
  if (!invitation || invitation.status !== "PENDING") throw new OrganizationTeamError("Invitation is invalid or no longer available", 404);
  if (invitation.expiresAt <= new Date()) {
    await prisma.organizationInvitation.updateMany({
      where: { tokenHash: hashInvitationToken(token), status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    throw new OrganizationTeamError("Invitation has expired", 409);
  }
  return {
    organization: invitation.organization,
    email: maskInvitationEmail(invitation.email),
    role: invitation.role,
    expiresAt: invitation.expiresAt,
  };
}

export async function acceptOrganizationInvitation(input: {
  token: string;
  name?: string;
  jwt: JwtConfiguration;
  requestId?: string;
}): Promise<{ pair: TokenPair; organization: { id: string; name: string; slug: string }; user: { id: string; email: string; name: string | null }; role: OrganizationRole }> {
  const tokenHash = hashInvitationToken(input.token);
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      let invitation = await tx.organizationInvitation.findUnique({
        where: { tokenHash },
        include: { organization: { select: { id: true, name: true, slug: true } } },
      });
      if (!invitation || invitation.status !== "PENDING") throw new OrganizationTeamError("Invitation is invalid or no longer available", 404);
      await lockOrganization(tx, invitation.organizationId);
      invitation = await tx.organizationInvitation.findUnique({
        where: { tokenHash },
        include: { organization: { select: { id: true, name: true, slug: true } } },
      });
      if (!invitation || invitation.status !== "PENDING") throw new OrganizationTeamError("Invitation is invalid or no longer available", 404);
      if (invitation.expiresAt <= now) {
        await tx.organizationInvitation.update({ where: { id: invitation.id }, data: { status: "EXPIRED" } });
        throw new OrganizationTeamError("Invitation has expired", 409);
      }
      const existingUser = await tx.user.findFirst({
        where: { email: { equals: invitation.email, mode: "insensitive" } },
        select: { id: true },
      });
      const user = existingUser
        ? await tx.user.update({
          where: { id: existingUser.id },
          data: { ...(input.name?.trim() ? { name: input.name.trim() } : {}), emailVerifiedAt: now },
          select: { id: true, email: true, name: true },
        })
        : await tx.user.create({
          data: { email: invitation.email, name: input.name?.trim() || null, emailVerifiedAt: now },
          select: { id: true, email: true, name: true },
        });
      await tx.organizationMembership.create({
        data: { organizationId: invitation.organizationId, userId: user.id, role: invitation.role },
      });
      await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: { status: "ACCEPTED", acceptedById: user.id, acceptedAt: now },
      });
      await recordAuditEvent(tx, {
        organizationId: invitation.organizationId,
        actorUserId: user.id,
        action: "organization.invitation.accepted",
        resourceType: "OrganizationInvitation",
        resourceId: invitation.id,
        summary: `${invitation.email} joined the organization`,
        metadata: { role: invitation.role },
        requestId: input.requestId,
      });
      const store: RefreshSessionStore = {
        membershipExists: async (userId, organizationId) => Boolean(await tx.organizationMembership.findUnique({
          where: { organizationId_userId: { organizationId, userId } },
          select: { id: true },
        })),
        create: async (session) => { await tx.refreshSession.create({ data: session }); },
        rotate: async () => false,
        revoke: async () => undefined,
      };
      const pair = await issueTokenPair({ userId: user.id, organizationId: invitation.organizationId }, input.jwt, store, now);
      return { pair, organization: invitation.organization, user, role: invitation.role };
    });
  } catch (error) {
    if (error instanceof OrganizationTeamError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new OrganizationTeamError("This user already belongs to the organization", 409);
    }
    throw error;
  }
}

async function assertLastOwnerSafe(tx: Prisma.TransactionClient, organizationId: string, membershipId: string, currentRole: OrganizationRole, nextRole?: OrganizationRole) {
  if (currentRole !== "OWNER" || nextRole === "OWNER") return;
  const otherOwners = await tx.organizationMembership.count({
    where: { organizationId, role: "OWNER", id: { not: membershipId } },
  });
  if (!otherOwners) throw new OrganizationTeamError("The last owner cannot be removed or demoted", 409);
}

export async function changeOrganizationMemberRole(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: OrganizationRole;
  membershipId: string;
  role: OrganizationRole;
  requestId?: string;
}) {
  const membership = await prisma.organizationMembership.findFirst({
    where: { id: input.membershipId, organizationId: input.organizationId },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!membership) throw new OrganizationTeamError("Member not found", 404);
  if (!canManageMemberRole(input.actorRole, membership.role, input.role)) {
    throw new OrganizationTeamError("You cannot assign or modify this role", 409);
  }
  if (membership.role === input.role) return membership;
  return prisma.$transaction(async (tx) => {
    await lockOrganization(tx, input.organizationId);
    await assertLastOwnerSafe(tx, input.organizationId, membership.id, membership.role, input.role);
    const updated = await tx.organizationMembership.update({
      where: { id: membership.id },
      data: { role: input.role },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "organization.member.role_changed",
      resourceType: "OrganizationMembership",
      resourceId: membership.id,
      severity: privilegedRoles.has(input.role) || privilegedRoles.has(membership.role) ? "WARNING" : "INFO",
      summary: `Changed ${membership.user.email} from ${membership.role} to ${input.role}`,
      metadata: { userId: membership.userId, previousRole: membership.role, role: input.role },
      requestId: input.requestId,
    });
    return updated;
  });
}

export async function removeOrganizationMember(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: OrganizationRole;
  membershipId: string;
  requestId?: string;
}) {
  const membership = await prisma.organizationMembership.findFirst({
    where: { id: input.membershipId, organizationId: input.organizationId },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!membership) throw new OrganizationTeamError("Member not found", 404);
  if (!canManageMemberRole(input.actorRole, membership.role)) {
    throw new OrganizationTeamError("You cannot remove this member", 409);
  }
  return prisma.$transaction(async (tx) => {
    await lockOrganization(tx, input.organizationId);
    await assertLastOwnerSafe(tx, input.organizationId, membership.id, membership.role);
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "organization.member.removed",
      resourceType: "OrganizationMembership",
      resourceId: membership.id,
      severity: "WARNING",
      summary: `Removed ${membership.user.email} from the organization`,
      metadata: { userId: membership.userId, role: membership.role },
      requestId: input.requestId,
    });
    await tx.refreshSession.updateMany({
      where: { organizationId: input.organizationId, userId: membership.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.organizationMembership.delete({ where: { id: membership.id } });
    return { id: membership.id, user: membership.user, role: membership.role, removed: true };
  });
}
