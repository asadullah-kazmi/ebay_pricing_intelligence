import { describe, expect, it } from "vitest";
import { passwordMeetsPolicy } from "./account-auth-service.js";

describe("account authentication policy", () => {
  it("requires long mixed-class passwords", () => {
    expect(passwordMeetsPolicy("Short1!")).toBe(false);
    expect(passwordMeetsPolicy("alllowercase123!")).toBe(false);
    expect(passwordMeetsPolicy("Valid-Password-42!")).toBe(true);
  });

  it("rejects excessively long passwords before expensive hashing", () => {
    expect(passwordMeetsPolicy(`Aa1!${"x".repeat(130)}`)).toBe(false);
  });
});
