import { Prisma, type OrganizationRole, type PricingProposalStatus } from "@prisma/client";
import { recordAuditEvent } from "./audit-service.js";
import { prisma } from "./db.js";
import { enqueueOutboxEvent } from "./outbox-service.js";

export class PricingGovernanceError extends Error {
  constructor(message: string, readonly statusCode: 400 | 403 | 404 | 409 = 400) {
    super(message);
    this.name = "PricingGovernanceError";
  }
}

export interface PricingRuleValues {
  marketAdjustmentPercent: number;
  minimumMarginPercent: number;
  minimumProfitAmount: number;
  requireApproval: boolean;
}

export interface PricingCalculation {
  marketRecommendedPrice: number;
  floorPrice: number | null;
  proposedPrice: number;
  floorUnavailableReason: string | null;
}

export const defaultPricingRule: PricingRuleValues = {
  marketAdjustmentPercent: 0,
  minimumMarginPercent: 20,
  minimumProfitAmount: 10,
  requireApproval: true,
};

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateGovernedPrice(input: {
  marketRecommendedPrice: number;
  marketCurrency: string;
  costAmount: number | null;
  costCurrency: string | null;
  rule: PricingRuleValues;
}): PricingCalculation {
  const adjusted = money(input.marketRecommendedPrice * (1 + input.rule.marketAdjustmentPercent / 100));
  if (input.costAmount === null || input.costCurrency === null) {
    return {
      marketRecommendedPrice: money(input.marketRecommendedPrice),
      floorPrice: null,
      proposedPrice: Math.max(0.01, adjusted),
      floorUnavailableReason: "INVENTORY_COST_MISSING",
    };
  }
  if (input.costCurrency !== input.marketCurrency) {
    return {
      marketRecommendedPrice: money(input.marketRecommendedPrice),
      floorPrice: null,
      proposedPrice: Math.max(0.01, adjusted),
      floorUnavailableReason: "COST_CURRENCY_MISMATCH",
    };
  }
  const profitFloor = input.costAmount + input.rule.minimumProfitAmount;
  const marginFloor = input.rule.minimumMarginPercent >= 100
    ? Number.POSITIVE_INFINITY
    : input.costAmount / (1 - input.rule.minimumMarginPercent / 100);
  const floorPrice = money(Math.max(profitFloor, marginFloor));
  return {
    marketRecommendedPrice: money(input.marketRecommendedPrice),
    floorPrice,
    proposedPrice: money(Math.max(adjusted, floorPrice)),
    floorUnavailableReason: null,
  };
}

function ruleValues(rule?: {
  marketAdjustmentPercent: Prisma.Decimal;
  minimumMarginPercent: Prisma.Decimal;
  minimumProfitAmount: Prisma.Decimal;
  requireApproval: boolean;
} | null): PricingRuleValues {
  if (!rule) return defaultPricingRule;
  return {
    marketAdjustmentPercent: Number(rule.marketAdjustmentPercent.toString()),
    minimumMarginPercent: Number(rule.minimumMarginPercent.toString()),
    minimumProfitAmount: Number(rule.minimumProfitAmount.toString()),
    requireApproval: rule.requireApproval,
  };
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function serializeProposal<T extends {
  marketRecommendedPrice: Prisma.Decimal;
  costAmount: Prisma.Decimal | null;
  floorPrice: Prisma.Decimal | null;
  proposedPrice: Prisma.Decimal;
  approvedPrice: Prisma.Decimal | null;
}>(proposal: T) {
  return {
    ...proposal,
    marketRecommendedPrice: Number(proposal.marketRecommendedPrice.toString()),
    costAmount: proposal.costAmount === null ? null : Number(proposal.costAmount.toString()),
    floorPrice: proposal.floorPrice === null ? null : Number(proposal.floorPrice.toString()),
    proposedPrice: Number(proposal.proposedPrice.toString()),
    approvedPrice: proposal.approvedPrice === null ? null : Number(proposal.approvedPrice.toString()),
  };
}

export async function getOrganizationPricingRule(organizationId: string) {
  const rule = await prisma.pricingRule.findUnique({
    where: { organizationId },
    include: { updatedBy: { select: { id: true, email: true, name: true } } },
  });
  return rule ? { id: rule.id, ...ruleValues(rule), updatedAt: rule.updatedAt, updatedBy: rule.updatedBy } : {
    id: null,
    ...defaultPricingRule,
    updatedAt: null,
    updatedBy: null,
  };
}

export async function updateOrganizationPricingRule(input: {
  organizationId: string;
  userId: string;
  values: PricingRuleValues;
  requestId?: string;
}) {
  const rule = await prisma.$transaction(async (tx) => {
    const updated = await tx.pricingRule.upsert({
      where: { organizationId: input.organizationId },
      create: { organizationId: input.organizationId, updatedById: input.userId, ...input.values },
      update: { updatedById: input.userId, ...input.values },
      include: { updatedBy: { select: { id: true, email: true, name: true } } },
    });
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "pricing.rule.updated",
      resourceType: "PricingRule",
      resourceId: updated.id,
      severity: "WARNING",
      summary: "Organization pricing governance rule updated",
      metadata: asJson(input.values),
      requestId: input.requestId,
    });
    return updated;
  });
  return { id: rule.id, ...ruleValues(rule), updatedAt: rule.updatedAt, updatedBy: rule.updatedBy };
}

export async function createPricingProposal(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    partId: string;
    pricingJobItemId: string;
    marketplace: string;
    marketRecommendedPrice: number;
    currency: string;
  },
) {
  const [ruleRecord, inventory] = await Promise.all([
    tx.pricingRule.findUnique({ where: { organizationId: input.organizationId } }),
    tx.inventoryItem.findUnique({ where: { partId: input.partId }, select: { cost: true, currency: true } }),
  ]);
  const rule = ruleValues(ruleRecord);
  const costAmount = inventory ? Number(inventory.cost.toString()) : null;
  const calculation = calculateGovernedPrice({
    marketRecommendedPrice: input.marketRecommendedPrice,
    marketCurrency: input.currency,
    costAmount,
    costCurrency: inventory?.currency ?? null,
    rule,
  });
  await tx.pricingProposal.updateMany({
    where: {
      organizationId: input.organizationId,
      partId: input.partId,
      marketplace: input.marketplace,
      status: { in: ["PENDING", "APPROVED", "OVERRIDDEN"] },
    },
    data: { status: "SUPERSEDED" },
  });
  const autoApproved = !rule.requireApproval && calculation.floorPrice !== null;
  const now = new Date();
  const proposal = await tx.pricingProposal.create({
    data: {
      organizationId: input.organizationId,
      partId: input.partId,
      pricingJobItemId: input.pricingJobItemId,
      marketplace: input.marketplace,
      currency: input.currency,
      marketRecommendedPrice: calculation.marketRecommendedPrice,
      costAmount,
      costCurrency: inventory?.currency ?? null,
      floorPrice: calculation.floorPrice,
      proposedPrice: calculation.proposedPrice,
      approvedPrice: autoApproved ? calculation.proposedPrice : null,
      floorUnavailableReason: calculation.floorUnavailableReason,
      ruleSnapshot: asJson(rule),
      status: autoApproved ? "APPROVED" : "PENDING",
      decisionReason: autoApproved ? "Automatically approved by organization pricing rule" : null,
      decidedAt: autoApproved ? now : null,
    },
  });
  await enqueueOutboxEvent(tx, {
    organizationId: input.organizationId,
    topic: autoApproved ? "pricing.proposal.approved" : "pricing.proposal.created",
    aggregateType: "PricingProposal",
    aggregateId: proposal.id,
    payload: {
      proposalId: proposal.id,
      partId: input.partId,
      marketplace: input.marketplace,
      status: proposal.status,
      proposedPrice: calculation.proposedPrice,
      currency: input.currency,
    },
  });
  return proposal;
}

export async function listPricingProposals(input: {
  organizationId: string;
  status?: PricingProposalStatus;
  partId?: string;
  marketplace?: string;
  limit: number;
}) {
  const proposals = await prisma.pricingProposal.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.partId ? { partId: input.partId } : {}),
      ...(input.marketplace ? { marketplace: input.marketplace } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: input.limit,
    include: {
      part: { select: { id: true, sku: true, primaryPartNumber: true, partName: true } },
      decidedBy: { select: { id: true, email: true, name: true } },
    },
  });
  return proposals.map(serializeProposal);
}

export async function decidePricingProposal(input: {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  proposalId: string;
  action: "APPROVE" | "REJECT" | "OVERRIDE";
  overridePrice?: number;
  reason?: string;
  requestId?: string;
}) {
  const proposal = await prisma.pricingProposal.findFirst({
    where: { id: input.proposalId, organizationId: input.organizationId },
  });
  if (!proposal) throw new PricingGovernanceError("Pricing proposal not found", 404);
  if (proposal.status !== "PENDING") throw new PricingGovernanceError("Only a pending pricing proposal can be decided", 409);
  if (input.action !== "REJECT" && proposal.floorPrice === null) {
    throw new PricingGovernanceError("Set an inventory cost in the same currency before approving this proposal", 409);
  }
  if (input.action === "REJECT" && !input.reason?.trim()) {
    throw new PricingGovernanceError("A rejection reason is required");
  }
  if (input.action === "OVERRIDE" && (!input.overridePrice || input.overridePrice <= 0 || !input.reason?.trim())) {
    throw new PricingGovernanceError("A positive override price and reason are required");
  }
  const approvedPrice = input.action === "APPROVE"
    ? Number(proposal.proposedPrice.toString())
    : input.action === "OVERRIDE"
      ? money(input.overridePrice!)
      : null;
  const floorPrice = proposal.floorPrice === null ? null : Number(proposal.floorPrice.toString());
  const belowFloor = approvedPrice !== null && floorPrice !== null && approvedPrice < floorPrice;
  if (belowFloor && input.role !== "OWNER" && input.role !== "ADMIN") {
    throw new PricingGovernanceError("Only an organization owner or admin can approve a below-floor override", 403);
  }
  const status: PricingProposalStatus = input.action === "APPROVE" ? "APPROVED" : input.action === "REJECT" ? "REJECTED" : "OVERRIDDEN";
  const now = new Date();
  const decided = await prisma.$transaction(async (tx) => {
    const updated = await tx.pricingProposal.updateMany({
      where: { id: proposal.id, organizationId: input.organizationId, status: "PENDING" },
      data: {
        status,
        approvedPrice,
        belowFloor,
        decisionReason: input.reason?.trim() || (input.action === "APPROVE" ? "Approved proposed price" : null),
        decidedById: input.userId,
        decidedAt: now,
      },
    });
    if (!updated.count) throw new PricingGovernanceError("Pricing proposal changed; reload it before deciding", 409);
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: `pricing.proposal.${status.toLowerCase()}`,
      resourceType: "PricingProposal",
      resourceId: proposal.id,
      severity: belowFloor ? "CRITICAL" : status === "REJECTED" ? "WARNING" : "INFO",
      summary: belowFloor ? "Below-floor pricing override approved" : `Pricing proposal ${status.toLowerCase()}`,
      metadata: { approvedPrice, floorPrice, currency: proposal.currency, reason: input.reason?.trim() || null },
      requestId: input.requestId,
    });
    await enqueueOutboxEvent(tx, {
      organizationId: input.organizationId,
      topic: `pricing.proposal.${status.toLowerCase()}`,
      aggregateType: "PricingProposal",
      aggregateId: proposal.id,
      payload: { proposalId: proposal.id, partId: proposal.partId, marketplace: proposal.marketplace, approvedPrice, currency: proposal.currency, belowFloor },
    });
    return tx.pricingProposal.findUniqueOrThrow({
      where: { id: proposal.id },
      include: {
        part: { select: { id: true, sku: true, primaryPartNumber: true, partName: true } },
        decidedBy: { select: { id: true, email: true, name: true } },
      },
    });
  });
  return serializeProposal(decided);
}

export async function getApprovedPricingContext(organizationId: string, partId: string, marketplace: string) {
  const proposal = await prisma.pricingProposal.findFirst({
    where: { organizationId, partId, marketplace, status: { in: ["APPROVED", "OVERRIDDEN"] } },
    orderBy: { decidedAt: "desc" },
    select: { id: true, approvedPrice: true, currency: true, belowFloor: true, decidedAt: true },
  });
  if (!proposal?.approvedPrice) return null;
  return {
    proposalId: proposal.id,
    approvedPrice: Number(proposal.approvedPrice.toString()),
    currency: proposal.currency,
    belowFloor: proposal.belowFloor,
    decidedAt: proposal.decidedAt,
  };
}

export async function assertApprovedListingPrice(input: {
  organizationId: string;
  partId: string;
  marketplace: string;
  price: Prisma.Decimal | null;
  currency: string;
}) {
  const approval = await getApprovedPricingContext(input.organizationId, input.partId, input.marketplace);
  if (!approval) throw new PricingGovernanceError("Approve a current pricing proposal before preparing or publishing this listing", 409);
  if (
    !input.price
    || Math.round(Number(input.price.toString()) * 100) !== Math.round(approval.approvedPrice * 100)
    || input.currency !== approval.currency
  ) {
    throw new PricingGovernanceError("The listing price must exactly match the current approved pricing proposal", 409);
  }
  return approval;
}
