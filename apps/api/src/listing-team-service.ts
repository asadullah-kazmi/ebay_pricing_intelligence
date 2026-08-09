import { Prisma } from "@prisma/client";
import { recordAuditEvent } from "./audit-service.js";
import { prisma } from "./db.js";

export class ListingTeamError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "ListingTeamError";
  }
}

export function normalizeListingTeamName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function cleanName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function serializeTeam<T extends { _count: { listingDrafts: number } }>(team: T) {
  const { _count, ...result } = team;
  return { ...result, usageCount: _count.listingDrafts };
}

export async function listListingTeams(organizationId: string, includeArchived = false) {
  const teams = await prisma.listingTeam.findMany({
    where: { organizationId, isArchived: includeArchived ? undefined : false },
    orderBy: [{ isArchived: "asc" }, { name: "asc" }],
    include: { _count: { select: { listingDrafts: true } } },
  });
  return { teams: teams.map(serializeTeam) };
}

export async function createListingTeam(input: {
  organizationId: string;
  actorUserId: string;
  name: string;
  color: string;
  requestId?: string;
}) {
  const name = cleanName(input.name);
  const normalizedName = normalizeListingTeamName(name);
  try {
    const team = await prisma.$transaction(async (tx) => {
      const saved = await tx.listingTeam.create({
        data: { organizationId: input.organizationId, name, normalizedName, color: input.color.toUpperCase() },
        include: { _count: { select: { listingDrafts: true } } },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "listing_team.created",
        resourceType: "ListingTeam",
        resourceId: saved.id,
        summary: `Created listing team ${saved.name}`,
        metadata: { name: saved.name, color: saved.color },
        requestId: input.requestId,
      });
      return saved;
    });
    return serializeTeam(team);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ListingTeamError("A team with this name already exists, including archived teams", 409);
    }
    throw error;
  }
}

export async function updateListingTeam(input: {
  organizationId: string;
  actorUserId: string;
  teamId: string;
  name?: string;
  color?: string;
  requestId?: string;
}) {
  const current = await prisma.listingTeam.findFirst({ where: { id: input.teamId, organizationId: input.organizationId } });
  if (!current) throw new ListingTeamError("Listing team not found", 404);
  const name = input.name === undefined ? undefined : cleanName(input.name);
  try {
    const team = await prisma.$transaction(async (tx) => {
      const saved = await tx.listingTeam.update({
        where: { id: current.id },
        data: {
          name,
          normalizedName: name === undefined ? undefined : normalizeListingTeamName(name),
          color: input.color?.toUpperCase(),
        },
        include: { _count: { select: { listingDrafts: true } } },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "listing_team.updated",
        resourceType: "ListingTeam",
        resourceId: saved.id,
        summary: `Updated listing team ${saved.name}`,
        metadata: { previousName: current.name, name: saved.name, color: saved.color },
        requestId: input.requestId,
      });
      return saved;
    });
    return serializeTeam(team);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ListingTeamError("A team with this name already exists, including archived teams", 409);
    }
    throw error;
  }
}

async function setListingTeamArchived(input: {
  organizationId: string;
  actorUserId: string;
  teamId: string;
  isArchived: boolean;
  requestId?: string;
}) {
  const current = await prisma.listingTeam.findFirst({ where: { id: input.teamId, organizationId: input.organizationId } });
  if (!current) throw new ListingTeamError("Listing team not found", 404);
  const team = await prisma.$transaction(async (tx) => {
    const saved = await tx.listingTeam.update({
      where: { id: current.id },
      data: { isArchived: input.isArchived },
      include: { _count: { select: { listingDrafts: true } } },
    });
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.isArchived ? "listing_team.archived" : "listing_team.restored",
      resourceType: "ListingTeam",
      resourceId: saved.id,
      summary: `${input.isArchived ? "Archived" : "Restored"} listing team ${saved.name}`,
      metadata: { name: saved.name, usageCount: saved._count.listingDrafts },
      requestId: input.requestId,
    });
    return saved;
  });
  return serializeTeam(team);
}

export const archiveListingTeam = (input: Omit<Parameters<typeof setListingTeamArchived>[0], "isArchived">) =>
  setListingTeamArchived({ ...input, isArchived: true });

export const restoreListingTeam = (input: Omit<Parameters<typeof setListingTeamArchived>[0], "isArchived">) =>
  setListingTeamArchived({ ...input, isArchived: false });
