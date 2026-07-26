import "../env.js";
import { getConfig } from "../config.js";

async function main() {
  const { ebay } = getConfig();
  if (!ebay.clientId || !ebay.clientSecret) throw new Error("Missing eBay app credentials");

  const basic = Buffer.from(`${ebay.clientId}:${ebay.clientSecret}`).toString("base64");
  const scopes = [
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/commerce.catalog.readonly",
    "https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/commerce.catalog.readonly",
  ];

  for (const scope of scopes) {
    const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope }),
    });
    const body = await res.json() as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    console.log("\nSCOPE:", scope);
    console.log("token status", res.status, body.error ?? "OK", body.error_description ?? `expires_in=${body.expires_in}`);
    if (!body.access_token) continue;

    const cat = await fetch(
      "https://api.ebay.com/commerce/catalog/v1_beta/product_summary/search?mpn=4E0833051C&limit=3",
      {
        headers: {
          Authorization: `Bearer ${body.access_token}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
      },
    );
    const catBody = await cat.json() as {
      productSummaries?: Array<{ title?: string; epid?: string }>;
      errors?: unknown;
    };
    console.log("catalog status", cat.status);
    if (catBody.errors) console.log("catalog errors", JSON.stringify(catBody.errors));
    else {
      console.log(
        "products",
        catBody.productSummaries?.length ?? 0,
        catBody.productSummaries?.[0]
          ? { epid: catBody.productSummaries[0].epid, title: catBody.productSummaries[0].title }
          : null,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
