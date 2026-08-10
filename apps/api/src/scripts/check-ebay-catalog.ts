import "../env.js";
import { getConfig } from "../config.js";
import { prisma } from "../db.js";
import { getEbaySellerAccessToken } from "../ebay-seller-oauth.js";

const SELL_INVENTORY_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.inventory";

interface CliOptions {
  mpn: string;
  epid?: string;
  marketplace: string;
  organization?: string;
}

interface EbayErrorBody {
  errors?: Array<{
    errorId?: number;
    domain?: string;
    category?: string;
    message?: string;
    longMessage?: string;
  }>;
}

interface CatalogSearchBody extends EbayErrorBody {
  total?: number;
  productSummaries?: Array<{
    epid?: string;
    title?: string;
    brand?: string;
    mpns?: string[];
  }>;
}

function usage(): never {
  console.log(`Usage:
  npm run ebay:catalog:check -- <part-number> [options]
  npm run ebay:catalog:check -- --mpn=<part-number> [options]

Options:
  --mpn <value>            Manufacturer part number to search (required)
  --epid <value>           Also test getProduct with a known ePID
  --marketplace <value>    Marketplace ID (default: EBAY_US)
  --organization <value>   Organization ID or exact organization name
  --help                    Show this help

This diagnostic deliberately uses only the connected seller's authorization-code
User token. It never prints access tokens, refresh tokens, or client credentials.`);
  process.exit(0);
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { mpn: "", marketplace: "EBAY_US" };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") usage();
    if (argument?.startsWith("--mpn=")) {
      options.mpn = argument.slice("--mpn=".length).trim();
    } else if (argument === "--mpn") {
      options.mpn = readValue(args, index, argument);
      index += 1;
    } else if (argument === "--epid") {
      options.epid = readValue(args, index, argument);
      index += 1;
    } else if (argument === "--marketplace") {
      options.marketplace = readValue(args, index, argument).toUpperCase();
      index += 1;
    } else if (argument === "--organization") {
      options.organization = readValue(args, index, argument);
      index += 1;
    } else if (argument?.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (argument && !options.mpn) {
      options.mpn = argument.trim();
    } else if (argument) {
      throw new Error(`Unexpected positional argument: ${argument}`);
    }
  }

  if (!options.mpn) throw new Error("Missing required option: --mpn <part-number>");
  if (!/^EBAY_[A-Z]{2,5}$/.test(options.marketplace)) {
    throw new Error("--marketplace must be an eBay marketplace ID such as EBAY_US");
  }
  return options;
}

function responseIdentifiers(response: Response) {
  return {
    requestId: response.headers.get("x-ebay-c-request-id") ?? undefined,
    correlationId: response.headers.get("x-ebay-c-correlation-id") ?? undefined,
  };
}

async function readBody<T>(response: Response): Promise<T | undefined> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { rawResponse: text.slice(0, 500) } as T;
  }
}

function explainStatus(status: number): string {
  if (status === 200) return "AUTHORIZED: eBay returned Catalog data.";
  if (status === 204) return "AUTHORIZED, NO MATCH: the Catalog accepted the token but found no product.";
  if (status === 400) return "BAD REQUEST: review the MPN, marketplace, and request parameters.";
  if (status === 401) return "UNAUTHORIZED: the seller token is missing, invalid, or expired.";
  if (status === 403) return "FORBIDDEN: capture this output and open an eBay Technical Incident.";
  return `UNEXPECTED HTTP STATUS: ${status}`;
}

function printErrors(body: EbayErrorBody | undefined) {
  if (!body?.errors?.length) return;
  console.log("eBay errors:");
  for (const error of body.errors) {
    console.log({
      errorId: error.errorId,
      domain: error.domain,
      category: error.category,
      message: error.message,
      longMessage: error.longMessage,
    });
  }
}

async function searchCatalog(input: {
  apiBase: string;
  token: string;
  mpn: string;
  marketplace: string;
}) {
  const url = new URL(`${input.apiBase}/commerce/catalog/v1_beta/product_summary/search`);
  url.searchParams.set("mpn", input.mpn);
  url.searchParams.set("limit", "5");

  console.log("\nCatalog Product Summary Search");
  console.log({ endpoint: url.toString(), marketplace: input.marketplace, tokenType: "USER" });

  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: "application/json",
      "X-EBAY-C-MARKETPLACE-ID": input.marketplace,
    },
  });
  const body = await readBody<CatalogSearchBody>(response);

  console.log({ httpStatus: response.status, ...responseIdentifiers(response) });
  console.log(explainStatus(response.status));
  printErrors(body);

  if (response.ok && response.status !== 204) {
    const products = body?.productSummaries ?? [];
    console.log({ reportedTotal: body?.total, returnedProducts: products.length });
    products.forEach((product, index) => {
      console.log({
        result: index + 1,
        epid: product.epid,
        title: product.title,
        brand: product.brand,
        mpns: product.mpns,
      });
    });
  }

  return response.status;
}

async function getProduct(input: {
  apiBase: string;
  token: string;
  epid: string;
  marketplace: string;
}) {
  const url = `${input.apiBase}/commerce/catalog/v1_beta/product/${encodeURIComponent(input.epid)}`;

  console.log("\nCatalog Get Product");
  console.log({ endpoint: url, marketplace: input.marketplace, tokenType: "USER" });

  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: "application/json",
      "X-EBAY-C-MARKETPLACE-ID": input.marketplace,
    },
  });
  const body = await readBody<EbayErrorBody & { epid?: string; title?: string; brand?: string; mpns?: string[] }>(response);

  console.log({ httpStatus: response.status, ...responseIdentifiers(response) });
  console.log(explainStatus(response.status));
  printErrors(body);
  if (response.ok && body) {
    console.log({ epid: body.epid, title: body.title, brand: body.brand, mpns: body.mpns });
  }
  return response.status;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = getConfig();
  const apiBase = config.ebay.environment === "production"
    ? "https://api.ebay.com"
    : "https://api.sandbox.ebay.com";

  const connection = await prisma.ebaySellerConnection.findFirst({
    where: {
      status: { in: ["ACTIVE", "ERROR"] },
      ...(options.organization ? {
        organization: {
          OR: [{ id: options.organization }, { name: options.organization }],
        },
      } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      organizationId: true,
      environment: true,
      status: true,
      username: true,
      scopes: true,
      accessTokenExpiresAt: true,
      refreshTokenExpiresAt: true,
      organization: { select: { name: true } },
    },
  });

  if (!connection) {
    throw new Error(options.organization
      ? `No active eBay seller connection found for organization '${options.organization}'`
      : "No active eBay seller connection found. Connect an eBay seller account first.");
  }

  console.log("eBay Catalog API diagnostic (seller User token only)");
  console.log({
    organization: connection.organization.name,
    organizationId: connection.organizationId,
    configuredEnvironment: config.ebay.environment,
    connectionEnvironment: connection.environment,
    connectionStatus: connection.status,
    ebayUsername: connection.username,
    hasSellInventoryScope: connection.scopes.includes(SELL_INVENTORY_SCOPE),
    recordedScopes: connection.scopes,
    accessTokenExpiresAt: connection.accessTokenExpiresAt,
    refreshTokenExpiresAt: connection.refreshTokenExpiresAt,
  });

  if (connection.environment !== config.ebay.environment) {
    throw new Error(`Environment mismatch: connection is ${connection.environment}, but EBAY_ENVIRONMENT is ${config.ebay.environment}`);
  }
  if (!connection.scopes.includes(SELL_INVENTORY_SCOPE)) {
    throw new Error(`The connected seller authorization does not record the required scope: ${SELL_INVENTORY_SCOPE}`);
  }

  const token = await getEbaySellerAccessToken(connection.organizationId);
  const statuses = [await searchCatalog({
    apiBase,
    token,
    mpn: options.mpn,
    marketplace: options.marketplace,
  })];

  if (options.epid) {
    statuses.push(await getProduct({
      apiBase,
      token,
      epid: options.epid,
      marketplace: options.marketplace,
    }));
  }

  console.log("\nDiagnostic conclusion");
  if (statuses.some((status) => status === 401 || status === 403)) {
    console.log("FAILED AUTHORIZATION: retain the status, error body, request ID, and correlation ID for eBay Technical Support.");
    process.exitCode = 2;
  } else if (statuses.every((status) => status === 200 || status === 204)) {
    console.log("Catalog authorization is working. A 204 result means no Catalog match, not a permissions failure.");
  } else {
    console.log("The request did not prove an authorization failure, but returned an unexpected/request error. Review the output above.");
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("\nCatalog diagnostic failed:");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
