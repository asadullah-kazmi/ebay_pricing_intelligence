import "../env.js";
import { getConfig } from "../config.js";
import { prisma } from "../db.js";
import { getEbaySellerAccessToken } from "../ebay-seller-oauth.js";

const SELL_INVENTORY_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.inventory";

interface CliOptions {
  mpn?: string;
  brand?: string;
  query?: string;
  categoryId?: string;
  epid?: string;
  marketplace: string;
  organization?: string;
  limit: number;
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
    mpn?: string[];
  }>;
}

interface CatalogProductSummary {
  epid?: string;
  title?: string;
  brand?: string;
  mpn?: string[];
}

interface CatalogSearchResult {
  label: string;
  status: number;
  products: CatalogProductSummary[];
}

function normalizeIdentifier(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeBrand(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function buildMpnVariants(mpn: string): string[] {
  const original = mpn.trim().toUpperCase().replace(/\s+/g, " ");
  const compact = normalizeIdentifier(original);
  const existingParts = original.split(/[^A-Z0-9]+/).filter(Boolean);
  const variants = new Set<string>([original, compact]);

  if (existingParts.length > 1) {
    variants.add(existingParts.join(" "));
    variants.add(existingParts.join("-"));
  }

  // Common OE formats (including VAG/Audi) use 3-3-rest or 3-3-3-suffix
  // grouping. These are lookup alternatives only; no identifier characters are dropped.
  if (compact.length > 6) {
    const groups = [compact.slice(0, 3), compact.slice(3, 6), compact.slice(6)];
    variants.add(groups.join(" "));
    variants.add(groups.join("-"));
  }
  if (compact.length > 9) {
    const groups = [compact.slice(0, 3), compact.slice(3, 6), compact.slice(6, 9), compact.slice(9)];
    variants.add(groups.join(" "));
    variants.add(groups.join("-"));
  }

  return [...variants].filter(Boolean);
}

function usage(): never {
  console.log(`Usage:
  npm run ebay:catalog:check -- <part-number> [options]
  npm run ebay:catalog:check -- <part-number> --brand <brand> [options]
  npm run ebay:catalog:check -- mpn:<part-number> [options]
  npm run ebay:catalog:check -- epid:<eBay-product-id> [options]
  npm run ebay:catalog:check -- query:<keywords> [category:<category-id>]

Options:
  --mpn <value>            Manufacturer part number to search
  --brand <value>          Expected product brand; enables brand-aware searches and validation
  --epid <value>           Test getProduct with a known ePID
  query:<value>            Search Catalog by keywords to discover products
  category:<value>         Restrict a keyword/MPN search to an eBay category
  --marketplace <value>    Marketplace ID (default: EBAY_US)
  --organization <value>   Organization ID or exact organization name
  --limit <value>          Search result limit from 1 to 200 (default: 5)
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
  const options: CliOptions = { marketplace: "EBAY_US", limit: 5 };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") usage();
    if (argument?.toLowerCase().startsWith("mpn:")) {
      options.mpn = argument.slice("mpn:".length).trim();
    } else if (argument?.toLowerCase().startsWith("epid:")) {
      options.epid = argument.slice("epid:".length).trim();
    } else if (argument?.toLowerCase().startsWith("query:")) {
      options.query = argument.slice("query:".length).trim();
    } else if (argument?.toLowerCase().startsWith("category:")) {
      options.categoryId = argument.slice("category:".length).trim();
    } else if (argument?.startsWith("--mpn=")) {
      options.mpn = argument.slice("--mpn=".length).trim();
    } else if (argument?.toLowerCase().startsWith("brand:")) {
      options.brand = argument.slice("brand:".length).trim();
    } else if (argument?.startsWith("--brand=")) {
      options.brand = argument.slice("--brand=".length).trim();
    } else if (argument?.startsWith("--epid=")) {
      options.epid = argument.slice("--epid=".length).trim();
    } else if (argument === "--mpn") {
      options.mpn = readValue(args, index, argument);
      index += 1;
    } else if (argument === "--brand") {
      options.brand = readValue(args, index, argument);
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
    } else if (argument === "--limit") {
      options.limit = Number(readValue(args, index, argument));
      index += 1;
    } else if (argument?.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (argument && !options.mpn) {
      options.mpn = argument.trim();
    } else if (argument) {
      throw new Error(`Unexpected positional argument: ${argument}`);
    }
  }

  if (!options.mpn && !options.query && !options.epid) {
    throw new Error("Provide an MPN directly, mpn:<part-number>, query:<keywords>, or epid:<eBay-product-id>");
  }
  if (options.mpn && options.query) {
    throw new Error("Use either an MPN or a keyword query, not both");
  }
  if (options.brand && !options.mpn) {
    throw new Error("--brand can only be used with an MPN search");
  }
  if (options.categoryId && !/^\d+$/.test(options.categoryId)) {
    throw new Error("category:<category-id> must contain digits only");
  }
  if (!/^EBAY_[A-Z]{2,5}$/.test(options.marketplace)) {
    throw new Error("--marketplace must be an eBay marketplace ID such as EBAY_US");
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 200) {
    throw new Error("--limit must be an integer from 1 to 200");
  }
  return options;
}

function responseIdentifiers(response: Response) {
  return {
    rlogId: response.headers.get("rlogid") ?? undefined,
    requestId:
      response.headers.get("x-ebay-request-id")
      ?? response.headers.get("x-ebay-c-request-id")
      ?? undefined,
    correlationId: response.headers.get("x-ebay-c-correlation-id") ?? undefined,
    responseDateUtc: response.headers.get("date") ?? undefined,
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
  label?: string;
  mpn?: string;
  query?: string;
  categoryId?: string;
  brandAspect?: string;
  expectedBrand?: string;
  expectedMpn?: string;
  marketplace: string;
  limit?: number;
}): Promise<CatalogSearchResult> {
  const url = new URL(`${input.apiBase}/commerce/catalog/v1_beta/product_summary/search`);
  if (input.mpn) url.searchParams.set("mpn", input.mpn);
  if (input.query) url.searchParams.set("q", input.query);
  if (input.categoryId) url.searchParams.set("category_ids", input.categoryId);
  if (input.categoryId && input.brandAspect) {
    url.searchParams.set("aspect_filter", `categoryId:${input.categoryId},Brand:{${input.brandAspect}}`);
  }
  url.searchParams.set("limit", String(input.limit ?? 5));

  const label = input.label ?? "Catalog Product Summary Search";
  console.log(`\n${label}`);
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
      const exactMpn = input.expectedMpn
        ? product.mpn?.some((value) => normalizeIdentifier(value) === normalizeIdentifier(input.expectedMpn!)) ?? false
        : undefined;
      const exactBrand = input.expectedBrand
        ? normalizeBrand(product.brand ?? "") === normalizeBrand(input.expectedBrand)
        : undefined;
      console.log({
        result: index + 1,
        epid: product.epid,
        title: product.title,
        brand: product.brand,
        mpn: product.mpn,
        exactMpn,
        exactBrand,
        exactBrandAndMpn: exactMpn === undefined || exactBrand === undefined ? undefined : exactMpn && exactBrand,
      });
    });
  }

  return {
    label,
    status: response.status,
    products: body?.productSummaries ?? [],
  };
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
  const body = await readBody<EbayErrorBody & {
    epid?: string;
    title?: string;
    brand?: string;
    mpn?: string[];
    primaryCategoryId?: string;
    otherApplicableCategoryIds?: string[];
  }>(response);

  console.log({ httpStatus: response.status, ...responseIdentifiers(response) });
  console.log(explainStatus(response.status));
  printErrors(body);
  if (response.ok && body) {
    console.log({
      epid: body.epid,
      title: body.title,
      brand: body.brand,
      mpn: body.mpn,
      primaryCategoryId: body.primaryCategoryId,
      otherApplicableCategoryIds: body.otherApplicableCategoryIds,
    });
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
  const statuses: number[] = [];
  const searchResults: CatalogSearchResult[] = [];
  if (options.mpn) {
    const variants = buildMpnVariants(options.mpn);
    console.log("\nMPN diagnostic plan");
    console.log({
      suppliedMpn: options.mpn,
      expectedBrand: options.brand,
      normalizedIdentity: normalizeIdentifier(options.mpn),
      variants,
      note: options.brand
        ? "Catalog has no standalone brand+mpn request parameter. Exact MPN searches are followed by brand+MPN keyword searches, and every response is validated by exact Brand/MPN."
        : "Add --brand <brand> to enable brand-aware keyword searches and exact Brand/MPN validation.",
    });

    for (const variant of variants) {
      const result = await searchCatalog({
        apiBase,
        token,
        label: `Exact MPN search: ${variant}`,
        mpn: variant,
        categoryId: options.categoryId,
        expectedBrand: options.brand,
        expectedMpn: options.mpn,
        marketplace: options.marketplace,
        limit: options.limit,
      });
      searchResults.push(result);
      statuses.push(result.status);
    }

    if (options.brand) {
      if (options.categoryId) {
        const result = await searchCatalog({
          apiBase,
          token,
          label: `Category + Brand aspect scan: ${options.categoryId} / ${options.brand}`,
          categoryId: options.categoryId,
          brandAspect: options.brand,
          expectedBrand: options.brand,
          expectedMpn: options.mpn,
          marketplace: options.marketplace,
          limit: options.limit,
        });
        searchResults.push(result);
        statuses.push(result.status);
      }
      for (const variant of variants) {
        const brandQueries = [
          { label: "comma keywords", value: `${options.brand},${variant}` },
          { label: "brand-first phrase", value: `${options.brand} ${variant}` },
          { label: "mpn-first phrase", value: `${variant} ${options.brand}` },
        ];
        for (const brandQuery of brandQueries) {
          const result = await searchCatalog({
            apiBase,
            token,
            label: `Brand + MPN ${brandQuery.label}: ${options.brand} / ${variant}`,
            query: brandQuery.value,
            categoryId: options.categoryId,
            brandAspect: options.categoryId ? options.brand : undefined,
            expectedBrand: options.brand,
            expectedMpn: options.mpn,
            marketplace: options.marketplace,
            limit: options.limit,
          });
          searchResults.push(result);
          statuses.push(result.status);
        }
      }
    }
  } else if (options.query) {
    const result = await searchCatalog({
      apiBase,
      token,
      query: options.query,
      categoryId: options.categoryId,
      marketplace: options.marketplace,
      limit: options.limit,
    });
    searchResults.push(result);
    statuses.push(result.status);
  }

  if (options.epid) {
    statuses.push(await getProduct({
      apiBase,
      token,
      epid: options.epid,
      marketplace: options.marketplace,
    }));
  }

  console.log("\nDiagnostic conclusion");
  if (options.mpn && options.brand) {
    const exactCandidates = new Map<string, CatalogProductSummary>();
    for (const result of searchResults) {
      for (const product of result.products) {
        const exactMpn = product.mpn?.some(
          (value) => normalizeIdentifier(value) === normalizeIdentifier(options.mpn!),
        ) ?? false;
        const exactBrand = normalizeBrand(product.brand ?? "") === normalizeBrand(options.brand);
        if (exactMpn && exactBrand) {
          exactCandidates.set(product.epid ?? `${product.brand}:${product.mpn?.join("|")}`, product);
        }
      }
    }
    console.log({
      exactBrandAndMpnCandidates: exactCandidates.size,
      candidates: [...exactCandidates.values()].map((product) => ({
        epid: product.epid,
        title: product.title,
        brand: product.brand,
        mpn: product.mpn,
      })),
    });
    console.log(exactCandidates.size > 0
      ? "EXACT PRODUCT MATCH: at least one Catalog candidate matches both the normalized MPN and expected brand."
      : "NO EXACT PRODUCT MATCH: 200 keyword responses, if any, are not a match unless both normalized MPN and brand agree.");
  }
  if (statuses.some((status) => status === 401 || status === 403)) {
    console.log("FAILED AUTHORIZATION: retain the status, error body, request ID, and correlation ID for eBay Technical Support.");
    process.exitCode = 2;
  } else if (statuses.every((status) => status === 200)) {
    console.log("Catalog authorization is working and every requested Catalog lookup returned product data.");
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
