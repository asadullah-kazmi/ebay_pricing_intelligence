export type EbayEnvironment = "sandbox" | "production";

export interface AppConfig {
  port: number;
  databaseUrl?: string;
  jwt: {
    accessSecret?: string;
    refreshSecret?: string;
    issuer: string;
    audience: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  };
  webOrigin?: string;
  ebay: {
    clientId?: string;
    clientSecret?: string;
    environment: EbayEnvironment;
    mode: "demo" | "live";
    notifications: {
      endpoint?: string;
      verificationToken?: string;
    };
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

  const notificationEndpoint = process.env.EBAY_NOTIFICATION_ENDPOINT?.trim() || undefined;
  const notificationVerificationToken = process.env.EBAY_NOTIFICATION_VERIFICATION_TOKEN?.trim() || undefined;
  if (Boolean(notificationEndpoint) !== Boolean(notificationVerificationToken)) {
    throw new Error("EBAY_NOTIFICATION_ENDPOINT and EBAY_NOTIFICATION_VERIFICATION_TOKEN must be provided together");
  }
  if (notificationEndpoint && !/^https:\/\//i.test(notificationEndpoint)) {
    throw new Error("EBAY_NOTIFICATION_ENDPOINT must be a public HTTPS URL");
  }
  if (notificationVerificationToken && !/^[A-Za-z0-9_-]{32,80}$/.test(notificationVerificationToken)) {
    throw new Error("EBAY_NOTIFICATION_VERIFICATION_TOKEN must be 32-80 letters, numbers, underscores, or hyphens");
  }

  const accessSecret = process.env.JWT_ACCESS_SECRET?.trim() || undefined;
  const refreshSecret = process.env.JWT_REFRESH_SECRET?.trim() || undefined;
  if (Boolean(accessSecret) !== Boolean(refreshSecret)) {
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be provided together");
  }
  if (accessSecret && accessSecret.length < 32) {
    throw new Error("JWT_ACCESS_SECRET must contain at least 32 characters");
  }
  if (refreshSecret && refreshSecret.length < 32) {
    throw new Error("JWT_REFRESH_SECRET must contain at least 32 characters");
  }

  const accessTtlSeconds = Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900);
  const refreshTtlSeconds = Number(process.env.JWT_REFRESH_TTL_SECONDS ?? 2_592_000);
  if (!Number.isInteger(accessTtlSeconds) || accessTtlSeconds < 60 || accessTtlSeconds > 3_600) {
    throw new Error("JWT_ACCESS_TTL_SECONDS must be an integer between 60 and 3600");
  }
  if (!Number.isInteger(refreshTtlSeconds) || refreshTtlSeconds < 3_600 || refreshTtlSeconds > 7_776_000) {
    throw new Error("JWT_REFRESH_TTL_SECONDS must be an integer between 3600 and 7776000");
  }

  cachedConfig = {
    port,
    databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
    jwt: {
      accessSecret,
      refreshSecret,
      issuer: process.env.JWT_ISSUER?.trim() || "partpulse-api",
      audience: process.env.JWT_AUDIENCE?.trim() || "partpulse-web",
      accessTtlSeconds,
      refreshTtlSeconds,
    },
    webOrigin: process.env.WEB_ORIGIN?.trim() || undefined,
    ebay: {
      clientId,
      clientSecret,
      environment,
      mode: clientId && clientSecret ? "live" : "demo",
      notifications: {
        endpoint: notificationEndpoint,
        verificationToken: notificationVerificationToken,
      },
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
