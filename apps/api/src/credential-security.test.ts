import { describe, expect, it } from "vitest";
import { decryptMfaSecret, encryptMfaSecret, generateRecoveryCodes, generateTotpSecret, hashPassword, matchingTotpStep, normalizeRecoveryCode, totpCode, verifyPassword, verifyTotp } from "./credential-security.js";

describe("credential security", () => {
  it("hashes passwords with unique salts and verifies them", async () => {
    const first = await hashPassword("Correct-Horse-42!");
    const second = await hashPassword("Correct-Horse-42!");
    expect(first).not.toBe(second);
    expect(await verifyPassword("Correct-Horse-42!", first)).toBe(true);
    expect(await verifyPassword("wrong", first)).toBe(false);
  });

  it("generates and verifies RFC-style time-based codes", () => {
    const secret = generateTotpSecret();
    const now = new Date("2026-07-23T12:00:00.000Z");
    expect(verifyTotp(secret, totpCode(secret, now), now)).toBe(true);
    expect(matchingTotpStep(secret, totpCode(secret, now), now)).toBe(Math.floor(now.getTime() / 1000 / 30));
    expect(verifyTotp(secret, "000000", now)).toBe(false);
  });

  it("encrypts MFA secrets and creates normalized recovery codes", () => {
    const key = Buffer.alloc(32, 7);
    const encrypted = encryptMfaSecret("ABC123", key);
    expect(encrypted).not.toContain("ABC123");
    expect(decryptMfaSecret(encrypted, key)).toBe("ABC123");
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(8);
    expect(normalizeRecoveryCode(` ${codes[0]!.toLowerCase()} `)).toBe(codes[0]);
  });
});
