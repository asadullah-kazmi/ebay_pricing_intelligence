import { describe, expect, it } from "vitest";
import { canManageMemberRole, hashInvitationToken, maskInvitationEmail, normalizeInvitationEmail } from "./organization-team-service.js";

describe("organization team security", () => {
  it("normalizes email and stores only deterministic token hashes", () => {
    expect(normalizeInvitationEmail("  Person@Example.COM ")).toBe("person@example.com");
    expect(hashInvitationToken("secret-token")).toMatch(/^[a-f0-9]{64}$/);
    expect(hashInvitationToken("secret-token")).toBe(hashInvitationToken("secret-token"));
  });

  it("masks invitation email previews", () => {
    expect(maskInvitationEmail("person@example.com")).toBe("pe****@example.com");
    expect(maskInvitationEmail("a@example.com")).toBe("a**@example.com");
  });

  it("prevents administrators from changing privileged memberships", () => {
    expect(canManageMemberRole("OWNER", "OWNER", "VIEWER")).toBe(true);
    expect(canManageMemberRole("ADMIN", "OWNER", "VIEWER")).toBe(false);
    expect(canManageMemberRole("ADMIN", "MANAGER", "ADMIN")).toBe(false);
    expect(canManageMemberRole("ADMIN", "MANAGER", "PUBLISHER")).toBe(true);
  });
});
