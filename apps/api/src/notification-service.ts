import {
  type NotificationCategory,
  type NotificationPreference,
  type NotificationSeverity,
  type OrganizationRole,
  type OutboxEvent,
} from "@prisma/client";
import { getConfig } from "./config.js";
import { prisma } from "./db.js";
import { emailIsConfigured, sendOperationalNotificationEmail } from "./email-service.js";

export class NotificationError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 = 400) {
    super(message);
    this.name = "NotificationError";
  }
}

interface NotificationDefinition {
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  message: string;
  actionUrl: string;
  roles: OrganizationRole[];
}

const text = (payload: unknown, key: string) => {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return "";
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
};

export function notificationForEvent(topic: string, payload: unknown): NotificationDefinition | null {
  const listingId = text(payload, "listingId");
  const mappings: Record<string, NotificationDefinition> = {
    "pricing.proposal.created": {
      category: "PRICING", severity: "INFO", title: "Price approval required",
      message: "A governed market-price proposal is ready for review.", actionUrl: "/catalog",
      roles: ["OWNER", "ADMIN", "PRICING_OPERATOR"],
    },
    "pricing.proposal.approved": {
      category: "PRICING", severity: "SUCCESS", title: "Price approved",
      message: "A governed price has been approved for listing preparation.", actionUrl: "/catalog",
      roles: ["OWNER", "ADMIN", "PRICING_OPERATOR"],
    },
    "fitment.application.approved": {
      category: "FITMENT", severity: "SUCCESS", title: "Fitment approved",
      message: "A vehicle-compatibility application was approved.", actionUrl: "/catalog#fitment-workflow",
      roles: ["OWNER", "ADMIN", "MANAGER", "CATALOG_OPERATOR"],
    },
    "listing.draft.invalidated": {
      category: "PUBLISHING", severity: "WARNING", title: "Listing draft needs review",
      message: "A catalog change invalidated a listing draft. Review it before publishing.", actionUrl: "/catalog#listing-drafts",
      roles: ["OWNER", "ADMIN", "MANAGER", "PUBLISHER"],
    },
    "listing.draft.fitment_invalidated": {
      category: "PUBLISHING", severity: "WARNING", title: "Listing fitment changed",
      message: "Approved compatibility changed. Revalidate the listing draft before publishing.", actionUrl: "/catalog#listing-drafts",
      roles: ["OWNER", "ADMIN", "MANAGER", "PUBLISHER"],
    },
    "listing.inventory.synced": {
      category: "PUBLISHING", severity: "SUCCESS", title: "Inventory synchronized",
      message: "An approved inventory and compatibility payload was written to eBay.", actionUrl: "/catalog#listing-drafts",
      roles: ["OWNER", "ADMIN", "PUBLISHER"],
    },
    "listing.offer.fees_ready": {
      category: "PUBLISHING", severity: "INFO", title: "Offer fees ready",
      message: "An unpublished eBay offer is ready for fee review and explicit publication approval.", actionUrl: "/catalog#listing-drafts",
      roles: ["OWNER", "ADMIN", "PUBLISHER"],
    },
    "listing.published": {
      category: "PUBLISHING", severity: "SUCCESS", title: "Listing published",
      message: listingId ? `eBay listing ${listingId} is live.` : "The approved eBay listing is live.", actionUrl: "/catalog#listing-drafts",
      roles: ["OWNER", "ADMIN", "PUBLISHER"],
    },
    "listing.revised": {
      category: "PUBLISHING", severity: "SUCCESS", title: "Listing revised",
      message: "The controlled eBay listing revision completed successfully.", actionUrl: "/catalog#listing-drafts",
      roles: ["OWNER", "ADMIN", "PUBLISHER"],
    },
    "listing.withdrawn": {
      category: "PUBLISHING", severity: "WARNING", title: "Listing withdrawn",
      message: "The selected eBay listing was withdrawn.", actionUrl: "/catalog#listing-drafts",
      roles: ["OWNER", "ADMIN", "PUBLISHER"],
    },
    "listing.reconciliation.drifted": {
      category: "PUBLISHING", severity: "CRITICAL", title: "eBay listing drift detected",
      message: "Remote eBay fields differ from the controlled local listing state. Review before making changes.", actionUrl: "/admin",
      roles: ["OWNER", "ADMIN", "PUBLISHER"],
    },
  };
  return mappings[topic] ?? null;
}

function wantsEmail(preference: NotificationPreference | null, definition: NotificationDefinition) {
  if (definition.severity === "CRITICAL") return preference?.emailFailures ?? true;
  if (definition.category === "PRICING") return preference?.emailPricing ?? false;
  if (definition.category === "FITMENT") return preference?.emailFitment ?? false;
  if (definition.category === "PUBLISHING") return preference?.emailPublishing ?? false;
  return false;
}

export async function consumeNotificationEvent(
  event: Pick<OutboxEvent, "id" | "organizationId" | "topic" | "aggregateType" | "aggregateId" | "payload">,
) {
  const definition = notificationForEvent(event.topic, event.payload);
  if (!definition) return { handled: false, created: 0, emailed: 0 };
  const memberships = await prisma.organizationMembership.findMany({
    where: { organizationId: event.organizationId, role: { in: definition.roles } },
    select: {
      userId: true,
      user: { select: { email: true, emailVerifiedAt: true } },
      organization: { select: { name: true } },
    },
  });
  const preferences = await prisma.notificationPreference.findMany({
    where: { organizationId: event.organizationId, userId: { in: memberships.map(({ userId }) => userId) } },
  });
  let created = 0;
  let emailed = 0;
  for (const membership of memberships) {
    const preference = preferences.find(({ userId }) => userId === membership.userId) ?? null;
    const emailRequested = Boolean(membership.user.emailVerifiedAt) && wantsEmail(preference, definition);
    const notification = await prisma.userNotification.upsert({
      where: { userId_sourceEventId: { userId: membership.userId, sourceEventId: event.id } },
      create: {
        organizationId: event.organizationId,
        userId: membership.userId,
        sourceEventId: event.id,
        category: definition.category,
        severity: definition.severity,
        title: definition.title,
        message: definition.message,
        actionUrl: definition.actionUrl,
        resourceType: event.aggregateType,
        resourceId: event.aggregateId,
        emailStatus: emailRequested ? "PENDING" : "NOT_REQUESTED",
      },
      update: {},
    });
    created += 1;
    if (!emailRequested || notification.emailStatus === "SENT") continue;
    if (!emailIsConfigured() || !getConfig().webOrigin) {
      await prisma.userNotification.update({
        where: { id: notification.id },
        data: { emailStatus: "FAILED", emailError: "Email delivery or WEB_ORIGIN is not configured" },
      });
      continue;
    }
    try {
      await sendOperationalNotificationEmail({
        to: membership.user.email,
        title: definition.title,
        message: `${definition.message} Organization: ${membership.organization.name}.`,
        actionUrl: `${getConfig().webOrigin}${definition.actionUrl}`,
      });
      await prisma.userNotification.update({
        where: { id: notification.id },
        data: { emailStatus: "SENT", emailedAt: new Date(), emailError: null },
      });
      emailed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed";
      await prisma.userNotification.update({ where: { id: notification.id }, data: { emailStatus: "FAILED", emailError: message } });
      throw error;
    }
  }
  return { handled: true, created, emailed };
}

export async function listNotifications(
  organizationId: string,
  userId: string,
  input: { unreadOnly: boolean; category?: NotificationCategory; limit: number },
) {
  const [notifications, unreadCount] = await prisma.$transaction([
    prisma.userNotification.findMany({
      where: {
        organizationId,
        userId,
        ...(input.unreadOnly ? { readAt: null } : {}),
        ...(input.category ? { category: input.category } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: input.limit,
      select: {
        id: true, category: true, severity: true, title: true, message: true, actionUrl: true,
        resourceType: true, resourceId: true, emailStatus: true, readAt: true, createdAt: true,
      },
    }),
    prisma.userNotification.count({ where: { organizationId, userId, readAt: null } }),
  ]);
  return { notifications, unreadCount };
}

export async function markNotificationRead(organizationId: string, userId: string, notificationId: string) {
  const updated = await prisma.userNotification.updateMany({
    where: { id: notificationId, organizationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (!updated.count) {
    const exists = await prisma.userNotification.count({ where: { id: notificationId, organizationId, userId } });
    if (!exists) throw new NotificationError("Notification not found", 404);
  }
  return { read: true };
}

export async function markAllNotificationsRead(organizationId: string, userId: string) {
  const result = await prisma.userNotification.updateMany({
    where: { organizationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
}

export async function getNotificationPreferences(organizationId: string, userId: string) {
  const preference = await prisma.notificationPreference.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
  return preference ?? {
    id: null, organizationId, userId,
    emailPricing: false, emailFitment: false, emailPublishing: false, emailFailures: true,
    createdAt: null, updatedAt: null,
  };
}

export function updateNotificationPreferences(
  organizationId: string,
  userId: string,
  input: Pick<NotificationPreference, "emailPricing" | "emailFitment" | "emailPublishing" | "emailFailures">,
) {
  return prisma.notificationPreference.upsert({
    where: { organizationId_userId: { organizationId, userId } },
    create: { organizationId, userId, ...input },
    update: input,
  });
}
