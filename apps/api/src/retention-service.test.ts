import { describe, expect, it } from "vitest";
import { buildRetentionCutoffs, defaultRetentionPolicy } from "./retention-service.js";

describe("retention cutoff snapshots", () => {
  it("freezes each policy window relative to one generated timestamp", () => {
    const now = new Date("2026-07-24T12:00:00.000Z");
    expect(buildRetentionCutoffs(defaultRetentionPolicy, now)).toEqual({
      generatedAt: "2026-07-24T12:00:00.000Z",
      readNotificationsBefore: "2026-04-25T12:00:00.000Z",
      competitorSnapshotsBefore: "2026-04-25T12:00:00.000Z",
      publishedOutboxBefore: "2026-06-24T12:00:00.000Z",
      resolvedDeadLettersBefore: "2026-01-25T12:00:00.000Z",
      auditArchiveEligibleBefore: "2025-07-24T12:00:00.000Z",
    });
  });

  it("uses independent retention windows without mutating the policy", () => {
    const policy = {
      readNotificationDays: 30,
      competitorSnapshotDays: 60,
      publishedOutboxDays: 7,
      resolvedDeadLetterDays: 120,
      auditArchiveAfterDays: 730,
    };
    const snapshot = buildRetentionCutoffs(policy, new Date("2026-07-24T00:00:00.000Z"));
    expect(snapshot.readNotificationsBefore).toBe("2026-06-24T00:00:00.000Z");
    expect(snapshot.publishedOutboxBefore).toBe("2026-07-17T00:00:00.000Z");
    expect(policy.publishedOutboxDays).toBe(7);
  });
});
