export type EbayEnvironment = "sandbox" | "production";

export interface AppConfig {
  port: number;
  databaseUrl?: string;
  ebay: {
    clientId?: string;
    clientSecret?: string;
    environment: EbayEnvironment;
    mode: "demo" | "live";
  };
  ownSellers: Set<string>;
}

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const environment = process.env.EBAY_ENVIRONMENT ?? "sandbox";
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("EBAY_ENVIRONMENT must be either sandbox or production");
  }

  const clientId = process.env.EBAY_CLIENT_ID?.trim() || undefined;
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim() || undefined;
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new Error("EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be provided together");
  }

  cachedConfig = {
    port,
    databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
    ebay: {
      clientId,
      clientSecret,
      environment,
      mode: clientId && clientSecret ? "live" : "demo",
    },
    ownSellers: new Set(
      (process.env.OWN_SELLERS ?? "")
        .split(",")
        .map((seller) => seller.trim().toLowerCase())
        .filter(Boolean),
    ),
  };

  return cachedConfig;
}
