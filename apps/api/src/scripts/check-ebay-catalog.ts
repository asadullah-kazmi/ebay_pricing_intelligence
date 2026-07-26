import "../env.js";
import { getConfig } from "../config.js";
import { discoverEbayFitment } from "../providers/ebay-fitment.js";
import { getEbayApplicationToken } from "../providers/ebay.js";
import { prisma } from "../db.js";

async function catalogSearch(token: string, partNumber: string, label: string) {
  const url = `https://api.ebay.com/commerce/catalog/v1_beta/product_summary/search?mpn=${encodeURIComponent(partNumber)}&limit=5`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });
  const text = await response.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* keep text */ }
  console.log(`\n=== ${label} ===`);
  console.log("HTTP", response.status);
  if (typeof parsed === "object" && parsed && "productSummaries" in parsed) {
    const products = (parsed as { productSummaries?: Array<{ epid?: string; title?: string }> }).productSummaries ?? [];
    console.log("products", products.length);
    console.log("top", products[0] ? { epid: products[0].epid, title: products[0].title } : null);
  } else if (typeof parsed === "object" && parsed && "errors" in parsed) {
    console.log("errors", JSON.stringify((parsed as { errors: unknown }).errors, null, 2));
  } else {
    console.log(String(text).slice(0, 600));
  }
  return response.status;
}

async function main() {
  const config = getConfig();
  console.log(JSON.stringify({
    ebayMode: config.ebay.mode,
    environment: config.ebay.environment,
    hasCatalogScopeInConfig: config.ebay.oauth.scopes.some((scope) => scope.includes("commerce.catalog")),
    oauthScopes: config.ebay.oauth.scopes,
  }, null, 2));

  const partNumber = process.argv[2] || "4E0833051C";
  const brand = process.argv[3] || "Audi";

  const appToken = await getEbayApplicationToken();
  await catalogSearch(appToken, partNumber, "Catalog API with APP token");

  const org = await prisma.organization.findFirst({
    where: { ebaySellerConnection: { isNot: null } },
    select: { id: true, name: true },
  });

  if (org) {
    const { getEbaySellerAccessToken } = await import("../ebay-seller-oauth.js");
    try {
      const sellerToken = await getEbaySellerAccessToken(org.id);
      await catalogSearch(sellerToken, partNumber, `Catalog API with SELLER token (${org.name ?? org.id})`);
    } catch (error) {
      console.log(`\n=== Seller token unavailable ===`);
      console.log(error instanceof Error ? error.message : error);
    }
  } else {
    console.log("\nNo organization with eBay seller connection found.");
  }

  console.log("\n=== discoverEbayFitment (Quick SKU path, no org) ===");
  const appDiscovery = await discoverEbayFitment({ partNumber, brand, partName: null }, "EBAY_US");
  console.log(JSON.stringify({
    source: appDiscovery.source,
    candidates: appDiscovery.candidates.length,
    top: appDiscovery.candidates[0] ? {
      epid: appDiscovery.candidates[0].epid,
      title: appDiscovery.candidates[0].title,
      browseDerived: appDiscovery.candidates[0].epid.startsWith("browse:"),
    } : null,
  }, null, 2));

  if (org) {
    console.log("\n=== discoverEbayFitment (Quick SKU path, with org seller token) ===");
    const sellerDiscovery = await discoverEbayFitment(
      { partNumber, brand, partName: null },
      "EBAY_US",
      { organizationId: org.id },
    );
    console.log(JSON.stringify({
      source: sellerDiscovery.source,
      candidates: sellerDiscovery.candidates.length,
      top: sellerDiscovery.candidates[0] ? {
        epid: sellerDiscovery.candidates[0].epid,
        title: sellerDiscovery.candidates[0].title,
        browseDerived: sellerDiscovery.candidates[0].epid.startsWith("browse:"),
      } : null,
    }, null, 2));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
