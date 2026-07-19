export type EbayEnvironment = "sandbox" | "production";

export interface AppConfig {
  port: number;
  databaseUrl?: string;
  auth: {
    secret?: string;
    issuer: string;
    audience: string;
  };
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

  const authSecret = process.env.APP_AUTH_SECRET?.trim() || undefined;
  if (authSecret && authSecret.length < 32) {
    throw new Error("APP_AUTH_SECRET must contain at least 32 characters");
  }

  cachedConfig = {
    port,
    databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
    auth: {
      secret: authSecret,
      issuer: process.env.AUTH_ISSUER?.trim() || "partpulse-api",
      audience: process.env.AUTH_AUDIENCE?.trim() || "partpulse-web",
    },
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
