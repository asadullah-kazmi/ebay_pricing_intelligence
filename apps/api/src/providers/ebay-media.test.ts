import { describe, expect, it } from "vitest";
import { normalizeEbayImageResponse } from "./ebay-media.js";

describe("eBay Media API response", () => {
  it("captures the image ID, HTTPS URLs, and expiry", () => {
    expect(normalizeEbayImageResponse(
      "https://apim.ebay.com/commerce/media/v1_beta/image/image_123",
      { imageUrl: "https://i.ebayimg.com/images/g/example/s-l1600.jpg", maxDimensionImageUrl: "https://i.ebayimg.com/images/g/example/s-l5000.jpg", expirationDate: "2026-08-20T10:00:00Z" },
    )).toMatchObject({
      imageId: "image_123",
      imageUrl: "https://i.ebayimg.com/images/g/example/s-l1600.jpg",
      maxDimensionImageUrl: "https://i.ebayimg.com/images/g/example/s-l5000.jpg",
    });
  });

  it("rejects responses without a durable EPS URL", () => {
    expect(() => normalizeEbayImageResponse("/image/id", { imageUrl: "http://example.com/image.jpg" })).toThrow("invalid image response");
  });
});
