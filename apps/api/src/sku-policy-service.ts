import { Prisma, type OrganizationSkuMode } from "@prisma/client";
import { recordAuditEvent } from "./audit-service.js";
import { prisma } from "./db.js";

export class SkuPolicyError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "SkuPolicyError";
  }
}

export function normalizeSkuPrefix(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function partNumberToSku(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "-").slice(0, 100);
}

function serializePolicy(policy: { skuMode: OrganizationSkuMode; skuPrefix: string; skuNextNumber: number }) {
  return {
    mode: policy.skuMode,
    prefix: policy.skuPrefix,
    nextNumber: policy.skuNextNumber,
    preview: policy.skuMode === "PART_NUMBER" ? "Uses each uploaded part number" : `${policy.skuPrefix}-${policy.skuNextNumber}`,
  };
}

export async function getOrganizationSkuPolicy(organizationId: string) {
  const policy = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { skuMode: true, skuPrefix: true, skuNextNumber: true },
  });
  if (!policy) throw new SkuPolicyError("Organization not found", 404);
  return serializePolicy(policy);
}

export async function updateOrganizationSkuPolicy(input: {
  organizationId: string;
  actorUserId: string;
  mode: OrganizationSkuMode;
  prefix?: string;
  nextNumber?: number;
  requestId?: string;
}) {
  const prefix = input.prefix === undefined ? undefined : normalizeSkuPrefix(input.prefix);
  if (input.mode === "SEQUENTIAL" && (!prefix || prefix.length < 2 || prefix.length > 20)) {
    throw new SkuPolicyError("SKU prefix must contain 2 to 20 letters or numbers");
  }
  const nextNumber = input.nextNumber;
  if (input.mode === "SEQUENTIAL" && (!Number.isSafeInteger(nextNumber) || nextNumber! < 0 || nextNumber! > 999_999_999)) {
    throw new SkuPolicyError("Starting suffix must be a whole number between 0 and 999999999");
  }

  return prisma.$transaction(async (tx) => {
    const saved = await tx.organization.update({
      where: { id: input.organizationId },
      data: input.mode === "SEQUENTIAL"
        ? { skuMode: input.mode, skuPrefix: prefix!, skuNextNumber: nextNumber! }
        : { skuMode: input.mode },
      select: { skuMode: true, skuPrefix: true, skuNextNumber: true },
    });
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "organization.sku_policy.updated",
      resourceType: "Organization",
      resourceId: input.organizationId,
      summary: `Updated SKU policy to ${input.mode === "PART_NUMBER" ? "part number" : `${saved.skuPrefix}-${saved.skuNextNumber}`}`,
      metadata: serializePolicy(saved),
      requestId: input.requestId,
    });
    return serializePolicy(saved);
  });
}

export async function allocateOrganizationSku(
  tx: Prisma.TransactionClient,
  organizationId: string,
  partNumber: string,
) {
  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
  const policy = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { skuMode: true, skuPrefix: true, skuNextNumber: true },
  });
  if (!policy) throw new SkuPolicyError("Organization not found", 404);

  if (policy.skuMode === "PART_NUMBER") {
    const sku = partNumberToSku(partNumber);
    if (!sku) throw new SkuPolicyError("Part number cannot be converted into an SKU");
    const existing = await tx.part.findFirst({ where: { organizationId, normalizedSku: sku }, select: { id: true } });
    if (existing) throw new SkuPolicyError(`SKU ${sku} already exists in the catalog`, 409);
    return { sku, normalizedSku: sku };
  }

  for (let number = policy.skuNextNumber; number <= 999_999_999; number += 1) {
    const sku = `${policy.skuPrefix}-${number}`;
    const normalizedSku = sku.toUpperCase();
    const existing = await tx.part.findFirst({ where: { organizationId, normalizedSku }, select: { id: true } });
    if (existing) continue;
    await tx.organization.update({ where: { id: organizationId }, data: { skuNextNumber: number + 1 } });
    return { sku, normalizedSku };
  }
  throw new SkuPolicyError("No SKU numbers remain in the configured sequence", 409);
}
