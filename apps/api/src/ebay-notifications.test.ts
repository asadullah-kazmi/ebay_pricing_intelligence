import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { accountDeletionNotificationSchema, generateChallengeResponse } from "./ebay-notifications.js";

describe("eBay account-deletion notifications", () => {
  it("generates the endpoint challenge in eBay's required order", () => {
    const expected = createHash("sha256").update("challenge").update("verification-token").update("https://example.com/webhook").digest("hex");
    expect(generateChallengeResponse("challenge", "verification-token", "https://example.com/webhook")).toBe(expected);
  });

  it("accepts an account-deletion notification without a username", () => {
    const result = accountDeletionNotificationSchema.safeParse({
      metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION", schemaVersion: "1.0", deprecated: false },
      notification: {
        notificationId: "notice-1",
        eventDate: "2026-01-01T00:00:00Z",
        publishDate: "2026-01-01T00:00:01Z",
        publishAttemptCount: 1,
        data: { userId: "immutable-user-id" },
      },
    });
    expect(result.success).toBe(true);
  });
});
