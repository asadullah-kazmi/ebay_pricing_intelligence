import { type AuditActorType, type AuditSeverity, Prisma } from "@prisma/client";
import { prisma } from "./db.js";

type AuditWriter = Pick<Prisma.TransactionClient, "organizationAuditEvent">;

export interface AuditEventInput {
  organizationId: string;
  actorUserId?: string | null;
  actorType?: AuditActorType;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  severity?: AuditSeverity;
  summary: string;
  metadata?: Prisma.InputJsonValue;
  requestId?: string | null;
}

export function recordAuditEvent(writer: AuditWriter, input: AuditEventInput) {
  return writer.organizationAuditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorType: input.actorType ?? (input.actorUserId ? "USER" : "SYSTEM"),
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      severity: input.severity ?? "INFO",
      summary: input.summary,
      metadata: input.metadata,
      requestId: input.requestId,
    },
  });
}

export async function listAuditEvents(organizationId: string, input: {
  action?: string;
  resourceType?: string;
  severity?: AuditSeverity;
  createdFrom?: Date;
  createdTo?: Date;
  limit: number;
}) {
  return prisma.organizationAuditEvent.findMany({
    where: {
      organizationId,
      action: input.action ? { contains: input.action, mode: "insensitive" } : undefined,
      resourceType: input.resourceType,
      severity: input.severity,
      occurredAt: input.createdFrom || input.createdTo ? { gte: input.createdFrom, lte: input.createdTo } : undefined,
    },
    orderBy: { occurredAt: "desc" },
    take: input.limit,
    select: {
      id: true,
      actorType: true,
      action: true,
      resourceType: true,
      resourceId: true,
      severity: true,
      summary: true,
      metadata: true,
      requestId: true,
      occurredAt: true,
      actorUser: { select: { id: true, email: true, name: true } },
    },
  });
}
