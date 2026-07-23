import { createHash } from "node:crypto";
import { Prisma, type FitmentApplicationSource, type OrganizationRole } from "@prisma/client";
import { recordAuditEvent } from "./audit-service.js";
import { prisma } from "./db.js";
import { enqueueOutboxEvent } from "./outbox-service.js";

export class ManualFitmentError extends Error {
  constructor(message: string, readonly statusCode: 400 | 403 | 404 | 409 = 400) {
    super(message);
    this.name = "ManualFitmentError";
  }
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function normalizeManualFitmentProperties(properties: Record<string, string>) {
  const normalized = Object.fromEntries(Object.entries(properties)
    .map(([name, value]) => [name.trim(), value.trim()] as const)
    .filter(([name, value]) => name && value)
    .sort(([left], [right]) => left.localeCompare(right)));
  if (!Object.keys(normalized).length) throw new ManualFitmentError("At least one compatibility property is required");
  const fingerprint = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  return { properties: normalized, fingerprint };
}

function requiredVehicleProperties(properties: Record<string, string>) {
  const lower = new Map(Object.entries(properties).map(([name, value]) => [name.toLowerCase(), value]));
  if (!lower.get("year") || !lower.get("make") || !lower.get("model")) {
    throw new ManualFitmentError("Year, Make, and Model are required for manual compatibility");
  }
}

function applicationSnapshot(application: {
  marketplace: string;
  source: string;
  status: string;
  fingerprint: string;
  properties: Prisma.JsonValue;
  notes: string | null;
  sourceVehicleId: string | null;
  sourceEvidence: Prisma.JsonValue | null;
  revision: number;
  decisionReason: string | null;
  approvedAt: Date | null;
}) {
  return asJson({
    marketplace: application.marketplace,
    source: application.source,
    status: application.status,
    fingerprint: application.fingerprint,
    properties: application.properties,
    notes: application.notes,
    sourceVehicleId: application.sourceVehicleId,
    sourceEvidence: application.sourceEvidence,
    revision: application.revision,
    decisionReason: application.decisionReason,
    approvedAt: application.approvedAt,
  });
}

function readinessIssues(value: Prisma.JsonValue | null, message: string) {
  const current = Array.isArray(value)
    ? value.filter((issue) => typeof issue !== "object" || issue === null || !("code" in issue) || issue.code !== "FITMENT_REVALIDATION_REQUIRED")
    : [];
  return asJson([...current, {
    code: "FITMENT_REVALIDATION_REQUIRED",
    severity: "BLOCKER",
    field: "fitment",
    message,
  }]);
}

function draftSnapshot(draft: {
  title: string;
  description: string | null;
  categoryId: string | null;
  condition: string;
  ebayCondition: string | null;
  price: Prisma.Decimal | null;
  currency: string;
  quantity: number;
  aspects: Prisma.JsonValue;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
  shippingPolicyId: string | null;
  merchantLocationKey: string | null;
}, issues: Prisma.InputJsonValue) {
  return asJson({
    title: draft.title,
    description: draft.description,
    categoryId: draft.categoryId,
    condition: draft.condition,
    ebayCondition: draft.ebayCondition,
    price: draft.price?.toString() ?? null,
    currency: draft.currency,
    quantity: draft.quantity,
    aspects: draft.aspects,
    paymentPolicyId: draft.paymentPolicyId,
    returnPolicyId: draft.returnPolicyId,
    shippingPolicyId: draft.shippingPolicyId,
    merchantLocationKey: draft.merchantLocationKey,
    status: "BLOCKED",
    validationIssues: issues,
  });
}

export async function invalidateFitmentDrafts(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; partId: string; userId: string; message: string },
) {
  const drafts = await tx.listingDraft.findMany({
    where: { organizationId: input.organizationId, partId: input.partId },
  });
  for (const draft of drafts) {
    const issues = readinessIssues(draft.validationIssues, input.message);
    const nextVersion = draft.version + 1;
    await tx.listingDraft.update({
      where: { id: draft.id },
      data: {
        status: "BLOCKED",
        validationIssues: issues,
        validatedAt: new Date(),
        liveValidatedAt: null,
        updatedById: input.userId,
        version: nextVersion,
      },
    });
    await tx.listingDraftVersion.create({
      data: {
        organizationId: input.organizationId,
        listingDraftId: draft.id,
        version: nextVersion,
        snapshot: draftSnapshot(draft, issues),
        reason: input.message,
        createdById: input.userId,
      },
    });
    await enqueueOutboxEvent(tx, {
      organizationId: input.organizationId,
      topic: "listing.draft.fitment_invalidated",
      aggregateType: "ListingDraft",
      aggregateId: draft.id,
      payload: { draftId: draft.id, partId: input.partId, version: nextVersion },
    });
  }
}

const applicationInclude = {
  sourceVehicle: { select: { id: true, vin: true, year: true, make: true, model: true, trim: true, engine: true } },
  createdBy: { select: { id: true, email: true, name: true } },
  approvedBy: { select: { id: true, email: true, name: true } },
  revisions: {
    orderBy: { revision: "desc" as const },
    take: 20,
    include: { createdBy: { select: { id: true, email: true, name: true } } },
  },
};

export async function listPartFitment(organizationId: string, partId: string, marketplace: string) {
  const part = await prisma.part.findFirst({
    where: { id: partId, organizationId },
    select: {
      id: true,
      sku: true,
      primaryPartNumber: true,
      donorVehicle: { select: { id: true, vin: true, year: true, make: true, model: true, trim: true, engine: true } },
    },
  });
  if (!part) throw new ManualFitmentError("Catalog part not found", 404);
  const applications = await prisma.fitmentApplication.findMany({
    where: { organizationId, partId, marketplace },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: applicationInclude,
  });
  return { part, marketplace, applications };
}

export async function createManualFitment(input: {
  organizationId: string;
  userId: string;
  partId: string;
  marketplace: string;
  source: Exclude<FitmentApplicationSource, "EBAY_CATALOG">;
  properties: Record<string, string>;
  notes?: string;
  requestId?: string;
}) {
  const part = await prisma.part.findFirst({
    where: { id: input.partId, organizationId: input.organizationId, status: { not: "ARCHIVED" } },
    include: { donorVehicle: true },
  });
  if (!part) throw new ManualFitmentError("Catalog part not found or archived", 404);
  if (input.source === "DONOR_VEHICLE" && !part.donorVehicle) {
    throw new ManualFitmentError("This part has no donor vehicle; add a VIN-backed vehicle or use manual fitment", 409);
  }
  const donorProperties = input.source === "DONOR_VEHICLE" && part.donorVehicle ? {
    ...(part.donorVehicle.year ? { Year: String(part.donorVehicle.year) } : {}),
    ...(part.donorVehicle.make ? { Make: part.donorVehicle.make } : {}),
    ...(part.donorVehicle.model ? { Model: part.donorVehicle.model } : {}),
    ...(part.donorVehicle.trim ? { Trim: part.donorVehicle.trim } : {}),
    ...(part.donorVehicle.engine ? { Engine: part.donorVehicle.engine } : {}),
  } : {};
  const normalized = normalizeManualFitmentProperties({ ...donorProperties, ...input.properties });
  requiredVehicleProperties(normalized.properties);
  const duplicate = await prisma.fitmentApplication.findFirst({
    where: {
      organizationId: input.organizationId,
      partId: input.partId,
      marketplace: input.marketplace,
      fingerprint: normalized.fingerprint,
      status: { in: ["PENDING", "APPROVED"] },
    },
    select: { id: true },
  });
  if (duplicate) throw new ManualFitmentError("An active application with the same compatibility already exists", 409);
  return prisma.$transaction(async (tx) => {
    const application = await tx.fitmentApplication.create({
      data: {
        organizationId: input.organizationId,
        partId: input.partId,
        marketplace: input.marketplace,
        source: input.source,
        status: "PENDING",
        fingerprint: normalized.fingerprint,
        properties: asJson(normalized.properties),
        notes: input.notes?.trim() || null,
        sourceVehicleId: input.source === "DONOR_VEHICLE" ? part.donorVehicle!.id : null,
        sourceEvidence: input.source === "DONOR_VEHICLE" ? asJson({
          vehicleId: part.donorVehicle!.id,
          vin: part.donorVehicle!.vin,
          capturedAt: new Date(),
        }) : Prisma.JsonNull,
        createdById: input.userId,
      },
    });
    await tx.fitmentApplicationRevision.create({
      data: {
        organizationId: input.organizationId,
        fitmentApplicationId: application.id,
        revision: application.revision,
        snapshot: applicationSnapshot(application),
        reason: "Manual fitment application created",
        createdById: input.userId,
      },
    });
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "fitment.application.created",
      resourceType: "FitmentApplication",
      resourceId: application.id,
      summary: `${input.source === "DONOR_VEHICLE" ? "Donor-vehicle" : "Manual"} fitment application created for review`,
      metadata: { partId: input.partId, marketplace: input.marketplace, source: input.source },
      requestId: input.requestId,
    });
    return tx.fitmentApplication.findUniqueOrThrow({ where: { id: application.id }, include: applicationInclude });
  });
}

export async function reviseManualFitment(input: {
  organizationId: string;
  userId: string;
  applicationId: string;
  properties: Record<string, string>;
  notes?: string | null;
  reason: string;
  requestId?: string;
}) {
  const current = await prisma.fitmentApplication.findFirst({
    where: { id: input.applicationId, organizationId: input.organizationId },
  });
  if (!current) throw new ManualFitmentError("Fitment application not found", 404);
  if (current.source === "EBAY_CATALOG") throw new ManualFitmentError("eBay catalog applications are immutable; create a manual replacement", 409);
  if (current.status === "SUPERSEDED") throw new ManualFitmentError("A superseded application cannot be edited", 409);
  const normalized = normalizeManualFitmentProperties(input.properties);
  requiredVehicleProperties(normalized.properties);
  const duplicate = await prisma.fitmentApplication.findFirst({
    where: {
      organizationId: input.organizationId,
      partId: current.partId,
      marketplace: current.marketplace,
      fingerprint: normalized.fingerprint,
      status: { in: ["PENDING", "APPROVED"] },
      id: { not: current.id },
    },
    select: { id: true },
  });
  if (duplicate) throw new ManualFitmentError("An active application with the same compatibility already exists", 409);
  const nextRevision = current.revision + 1;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.fitmentApplication.update({
      where: { id: current.id },
      data: {
        properties: asJson(normalized.properties),
        fingerprint: normalized.fingerprint,
        notes: input.notes === undefined ? current.notes : input.notes?.trim() || null,
        status: "PENDING",
        revision: nextRevision,
        approvedById: null,
        approvedAt: null,
        decisionReason: null,
      },
    });
    await tx.fitmentApplicationRevision.create({
      data: {
        organizationId: input.organizationId,
        fitmentApplicationId: updated.id,
        revision: nextRevision,
        snapshot: applicationSnapshot(updated),
        reason: input.reason.trim(),
        createdById: input.userId,
      },
    });
    if (current.status === "APPROVED") {
      await invalidateFitmentDrafts(tx, {
        organizationId: input.organizationId,
        partId: current.partId,
        userId: input.userId,
        message: "Approved compatibility was edited and requires review and live validation",
      });
    }
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "fitment.application.revised",
      resourceType: "FitmentApplication",
      resourceId: updated.id,
      severity: "WARNING",
      summary: "Manual fitment application revised and returned to review",
      metadata: { revision: nextRevision, reason: input.reason.trim() },
      requestId: input.requestId,
    });
    return tx.fitmentApplication.findUniqueOrThrow({ where: { id: updated.id }, include: applicationInclude });
  });
}

export async function decideManualFitment(input: {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  applicationId: string;
  action: "APPROVE" | "REJECT" | "SUPERSEDE";
  reason: string;
  replaceExisting?: boolean;
  requestId?: string;
}) {
  const current = await prisma.fitmentApplication.findFirst({
    where: { id: input.applicationId, organizationId: input.organizationId },
  });
  if (!current) throw new ManualFitmentError("Fitment application not found", 404);
  if ((input.action === "SUPERSEDE" || input.replaceExisting) && !["OWNER", "ADMIN", "MANAGER"].includes(input.role)) {
    throw new ManualFitmentError("Only an owner, admin, or manager can replace or remove approved compatibility", 403);
  }
  if (input.action === "SUPERSEDE" ? current.status !== "APPROVED" : current.status !== "PENDING") {
    throw new ManualFitmentError("The fitment application is not in a valid state for this decision", 409);
  }
  const nextStatus = input.action === "APPROVE" ? "APPROVED" : input.action === "REJECT" ? "REJECTED" : "SUPERSEDED";
  const now = new Date();
  const nextRevision = current.revision + 1;
  return prisma.$transaction(async (tx) => {
    if (input.action === "APPROVE" && input.replaceExisting) {
      await tx.fitmentApplication.updateMany({
        where: {
          organizationId: input.organizationId,
          partId: current.partId,
          marketplace: current.marketplace,
          status: "APPROVED",
          id: { not: current.id },
        },
        data: { status: "SUPERSEDED", decisionReason: `Replaced by ${current.id}` },
      });
    }
    const updated = await tx.fitmentApplication.update({
      where: { id: current.id },
      data: {
        status: nextStatus,
        revision: nextRevision,
        approvedById: input.action === "APPROVE" ? input.userId : null,
        approvedAt: input.action === "APPROVE" ? now : null,
        decisionReason: input.reason.trim(),
      },
    });
    await tx.fitmentApplicationRevision.create({
      data: {
        organizationId: input.organizationId,
        fitmentApplicationId: updated.id,
        revision: nextRevision,
        snapshot: applicationSnapshot(updated),
        reason: input.reason.trim(),
        createdById: input.userId,
      },
    });
    if (input.action === "APPROVE" || input.action === "SUPERSEDE") {
      await invalidateFitmentDrafts(tx, {
        organizationId: input.organizationId,
        partId: current.partId,
        userId: input.userId,
        message: input.action === "APPROVE"
          ? "Approved compatibility changed; run live validation before preparing inventory"
          : "Approved compatibility was removed; run live validation before preparing inventory",
      });
    }
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: `fitment.application.${nextStatus.toLowerCase()}`,
      resourceType: "FitmentApplication",
      resourceId: updated.id,
      severity: input.action === "SUPERSEDE" || input.replaceExisting ? "WARNING" : "INFO",
      summary: `Fitment application ${nextStatus.toLowerCase()}`,
      metadata: { reason: input.reason.trim(), replaceExisting: Boolean(input.replaceExisting), source: current.source },
      requestId: input.requestId,
    });
    await enqueueOutboxEvent(tx, {
      organizationId: input.organizationId,
      topic: `fitment.application.${nextStatus.toLowerCase()}`,
      aggregateType: "FitmentApplication",
      aggregateId: updated.id,
      payload: { applicationId: updated.id, partId: current.partId, marketplace: current.marketplace, status: nextStatus },
    });
    return tx.fitmentApplication.findUniqueOrThrow({ where: { id: updated.id }, include: applicationInclude });
  });
}
