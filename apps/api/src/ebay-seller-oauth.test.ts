import { describe, expect, it } from "vitest";
import { buildEbayConsentUrl, decryptSellerToken, encryptSellerToken } from "./ebay-seller-oauth.js";

describe("eBay seller OAuth token encryption", () => {
  it("round-trips a token with a unique authenticated IV", () => {
    const key = Buffer.alloc(32, 7);
    const first = encryptSellerToken("refresh-secret", key);
    const second = encryptSellerToken("refresh-secret", key);
    expect(decryptSellerToken(first, key)).toBe("refresh-secret");
    expect(Buffer.from(first.iv).equals(Buffer.from(second.iv))).toBe(false);
    expect(Buffer.from(first.ciphertext).toString("utf8")).not.toContain("refresh-secret");
  });

  it("rejects ciphertext whose authentication tag was changed", () => {
    const key = Buffer.alloc(32, 9);
    const encrypted = encryptSellerToken("access-secret", key);
    const tag = Uint8Array.from(encrypted.tag);
    tag[0] = tag[0]! ^ 1;
    expect(() => decryptSellerToken({ ...encrypted, tag }, key)).toThrow();
  });
});

describe("eBay seller consent URL", () => {
  it("uses the RuName, exact scopes, and opaque CSRF state", () => {
    const url = new URL(buildEbayConsentUrl({
      environment: "production",
      clientId: "client-id",
      ruName: "example-runame",
      scopes: ["https://api.ebay.com/oauth/api_scope/sell.inventory", "https://api.ebay.com/oauth/api_scope/sell.account"],
      state: "opaque-state",
    }));
    expect(url.origin).toBe("https://auth.ebay.com");
    expect(url.searchParams.get("redirect_uri")).toBe("example-runame");
    expect(url.searchParams.get("state")).toBe("opaque-state");
    expect(url.searchParams.get("scope")?.split(" ")).toHaveLength(2);
  });
});
