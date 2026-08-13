import { describe, expect, it } from "vitest";
import {
  buildConditionDescriptionPlain,
  buildListingDescriptionHtml,
  fitmentRowsFromApplications,
  isListingDescriptionTemplate,
  listingTitleFromDescriptionHtml,
} from "./listing-description.js";

const fiatFitment = [
  { Make: "Fiat", Model: "500L", Year: "2014" },
  { Make: "Fiat", Model: "500L", Year: "2015" },
  { Make: "Fiat", Model: "500L", Year: "2020" },
  { Make: "Chrysler", Model: "200", Year: "2015" },
];

describe("listing description template", () => {
  it("builds unbranded HTML with title, policies, fitment, and notice", () => {
    const html = buildListingDescriptionHtml({
      title: "2014-2020 Fiat 500L Timing Belt Tensioner 55238027",
      partName: "Timing Belt Tensioner",
      primaryPartNumber: "55238027",
      condition: "USED",
      fitmentApplications: fiatFitment,
    });

    expect(html).toContain("Product Description");
    expect(html).toContain("Payment, Shipping &amp; Returns");
    expect(html).toContain("Vehicle Fitment");
    expect(html).toContain("Important Compatibility Notice");
    expect(html).toContain("GENUINE USED PARTS");
    expect(html).toContain("WORLDWIDE SHIPPING");
    expect(html).toContain("QUALITY INSPECTED STOCK");
    expect(html).toContain("Vehicle: Fiat 500L");
    expect(html).toContain("Model Years: 2014-2020");
    expect(html).toContain("Part No: 55238027");
    expect(html).toContain("55238027");
    expect(html).toContain("Fiat");
    expect(html).toContain("500L");
    expect(html).toContain("2014");
    expect(html).toContain("Return Policy");
    expect(html).toContain("14 days");
    expect(html).toContain("Handling Time");
    expect(html).toContain("3 working days");
    expect(html).not.toMatch(/black\s*line/i);
    expect(html).not.toMatch(/blackline/i);
    expect(html).not.toContain("Authenticity Guaranteed");
  });

  it("escapes user-provided title and notes", () => {
    const html = buildListingDescriptionHtml({
      title: `Brake <script>alert(1)</script> & "Caliper"`,
      partName: "Caliper",
      primaryPartNumber: "ABC&123",
      condition: "NEW",
      notes: `Connector intact <b>ok</b>`,
    });
    expect(html).toContain("Brake &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Caliper&quot;");
    expect(html).toContain("Connector intact &lt;b&gt;ok&lt;/b&gt;");
    expect(html).toContain("GENUINE NEW PARTS");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("dedupes and sorts fitment rows", () => {
    expect(fitmentRowsFromApplications([
      { Make: "Fiat", Model: "500L", Year: "2020" },
      { Make: "Fiat", Model: "500L", Year: "2014" },
      { Make: "Fiat", Model: "500L", Year: "2014" },
      { Make: "Audi", Model: "A6", Year: "2015" },
    ])).toEqual([
      { make: "Audi", model: "A6", year: "2015" },
      { make: "Fiat", model: "500L", year: "2014" },
      { make: "Fiat", model: "500L", year: "2020" },
    ]);
  });

  it("builds a plain condition description under 1000 chars", () => {
    const plain = buildConditionDescriptionPlain({
      condition: "USED",
      partName: "Timing Belt Tensioner",
      primaryPartNumber: "55238027",
    });
    expect(plain).toContain("Used OEM Timing Belt Tensioner");
    expect(plain).toContain("55238027");
    expect(plain).not.toContain("<");
    expect(plain.length).toBeLessThanOrEqual(1000);
  });

  it("detects the HTML template marker", () => {
    const html = buildListingDescriptionHtml({
      title: "Test Part",
      partName: "Test Part",
      primaryPartNumber: "123",
      condition: "USED",
    });
    expect(isListingDescriptionTemplate(html)).toBe(true);
    expect(isListingDescriptionTemplate("Hersteller: AUDI\nFarbe: Gris")).toBe(false);
    expect(isListingDescriptionTemplate(null)).toBe(false);
  });

  it("recovers listing titles from current and legacy generated descriptions", () => {
    const html = buildListingDescriptionHtml({
      title: "Audi S6 Front Right Door Shell 4G0831052 OEM Used",
      partName: "Door Shell",
      primaryPartNumber: "4G0831052",
      condition: "USED",
    });
    expect(listingTitleFromDescriptionHtml(html)).toBe("Audi S6 Front Right Door Shell 4G0831052 OEM Used");

    const legacy = '<div style="font-family:Arial;font-size:22px;font-weight:700;">Audi A6 Door Shell &amp; Trim</div>';
    expect(listingTitleFromDescriptionHtml(legacy)).toBe("Audi A6 Door Shell & Trim");
  });
});
