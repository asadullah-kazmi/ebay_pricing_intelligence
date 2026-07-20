export type EbayEnvironment = "sandbox" | "production";

export interface AppConfig {
  port: number;
  databaseUrl?: string;
  shutdownTimeoutMs: number;
  jwt: {
    accessSecret?: string;
    refreshSecret?: string;
    issuer: string;
    audience: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  };
  webOrigin?: string;
  storage?: {
    bucket: string;
    region: string;
    endpoint?: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    uploadUrlTtlSeconds: number;
    maxImageBytes: number;
    maxImportBytes: number;
    maxImageArchiveBytes: number;
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
    oauth: {
      ruName?: string;
      encryptionKey?: Buffer;
      scopes: string[];
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

  const ebayRuName = process.env.EBAY_RUNAME?.trim() || undefined;
  const ebayEncryptionKeyValue = process.env.EBAY_OAUTH_ENCRYPTION_KEY?.trim() || undefined;
  if (Boolean(ebayRuName) !== Boolean(ebayEncryptionKeyValue)) {
    throw new Error("EBAY_RUNAME and EBAY_OAUTH_ENCRYPTION_KEY must be provided together");
  }
  let ebayEncryptionKey: Buffer | undefined;
  if (ebayEncryptionKeyValue) {
    ebayEncryptionKey = Buffer.from(ebayEncryptionKeyValue, "base64");
    if (ebayEncryptionKey.length !== 32 || ebayEncryptionKey.toString("base64") !== ebayEncryptionKeyValue) {
      throw new Error("EBAY_OAUTH_ENCRYPTION_KEY must be a canonical Base64-encoded 32-byte key");
    }
  }
  const defaultEbayOAuthScopes = [
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope/sell.account",
    "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
  ];
  const ebayOAuthScopes = (process.env.EBAY_OAUTH_SCOPES?.trim() || defaultEbayOAuthScopes.join(" ")).split(/\s+/).filter(Boolean);
  if (!ebayOAuthScopes.length || ebayOAuthScopes.some((scope) => !/^https:\/\/api\.ebay\.com\/oauth\/api_scope\/[a-z0-9._-]+$/i.test(scope))) {
    throw new Error("EBAY_OAUTH_SCOPES must contain space-separated eBay OAuth scope URLs");
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

  const shutdownTimeoutMs = Number(process.env.API_SHUTDOWN_TIMEOUT_MS ?? 10_000);
  if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 1_000 || shutdownTimeoutMs > 30_000) {
    throw new Error("API_SHUTDOWN_TIMEOUT_MS must be an integer between 1000 and 30000");
  }

  const storageBucket = process.env.STORAGE_BUCKET?.trim() || undefined;
  const storageRegion = process.env.STORAGE_REGION?.trim() || undefined;
  const storageAccessKeyId = process.env.STORAGE_ACCESS_KEY_ID?.trim() || undefined;
  const storageSecretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY?.trim() || undefined;
  const storageEndpoint = process.env.STORAGE_ENDPOINT?.trim() || undefined;
  const storageValues = [storageBucket, storageRegion, storageAccessKeyId, storageSecretAccessKey];
  if (storageValues.some(Boolean) && !storageValues.every(Boolean)) {
    throw new Error("STORAGE_BUCKET, STORAGE_REGION, STORAGE_ACCESS_KEY_ID, and STORAGE_SECRET_ACCESS_KEY must be provided together");
  }
  if (storageEndpoint && !/^https:\/\//i.test(storageEndpoint)) {
    throw new Error("STORAGE_ENDPOINT must be an HTTPS URL");
  }
  const storageUploadUrlTtlSeconds = Number(process.env.STORAGE_UPLOAD_URL_TTL_SECONDS ?? 300);
  if (!Number.isInteger(storageUploadUrlTtlSeconds) || storageUploadUrlTtlSeconds < 60 || storageUploadUrlTtlSeconds > 900) {
    throw new Error("STORAGE_UPLOAD_URL_TTL_SECONDS must be an integer between 60 and 900");
  }
  const storageMaxImageBytes = Number(process.env.STORAGE_MAX_IMAGE_BYTES ?? 20_971_520);
  if (!Number.isInteger(storageMaxImageBytes) || storageMaxImageBytes < 1_048_576 || storageMaxImageBytes > 52_428_800) {
    throw new Error("STORAGE_MAX_IMAGE_BYTES must be an integer between 1048576 and 52428800");
  }
  const storageMaxImportBytes = Number(process.env.STORAGE_MAX_IMPORT_BYTES ?? 10_485_760);
  if (!Number.isInteger(storageMaxImportBytes) || storageMaxImportBytes < 1_048_576 || storageMaxImportBytes > 52_428_800) {
    throw new Error("STORAGE_MAX_IMPORT_BYTES must be an integer between 1048576 and 52428800");
  }
  const storageMaxImageArchiveBytes = Number(process.env.STORAGE_MAX_IMAGE_ARCHIVE_BYTES ?? 104_857_600);
  if (!Number.isInteger(storageMaxImageArchiveBytes) || storageMaxImageArchiveBytes < 10_485_760 || storageMaxImageArchiveBytes > 524_288_000) {
    throw new Error("STORAGE_MAX_IMAGE_ARCHIVE_BYTES must be an integer between 10485760 and 524288000");
  }

  const databaseUrl = process.env.DATABASE_URL?.trim() || undefined;
  const webOrigin = process.env.WEB_ORIGIN?.trim() || undefined;
  if (webOrigin) {
    let parsedOrigin: URL;
    try { parsedOrigin = new URL(webOrigin); } catch { throw new Error("WEB_ORIGIN must be a valid absolute URL"); }
    if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") throw new Error("WEB_ORIGIN must use HTTP or HTTPS");
    if (parsedOrigin.origin !== webOrigin.replace(/\/$/, "")) throw new Error("WEB_ORIGIN must contain only the scheme and host");
  }
  if (process.env.NODE_ENV === "production") {
    const missing = [
      !databaseUrl && "DATABASE_URL",
      !accessSecret && "JWT_ACCESS_SECRET",
      !refreshSecret && "JWT_REFRESH_SECRET",
      !webOrigin && "WEB_ORIGIN",
      !storageBucket && "STORAGE_BUCKET",
      !storageRegion && "STORAGE_REGION",
      !storageAccessKeyId && "STORAGE_ACCESS_KEY_ID",
      !storageSecretAccessKey && "STORAGE_SECRET_ACCESS_KEY",
      !clientId && "EBAY_CLIENT_ID",
      !clientSecret && "EBAY_CLIENT_SECRET",
      !notificationEndpoint && "EBAY_NOTIFICATION_ENDPOINT",
      !notificationVerificationToken && "EBAY_NOTIFICATION_VERIFICATION_TOKEN",
    ].filter(Boolean);
    if (missing.length) throw new Error(`Production configuration is missing: ${missing.join(", ")}`);
    if (environment !== "production") throw new Error("EBAY_ENVIRONMENT must be production when NODE_ENV=production");
    if (webOrigin && !webOrigin.startsWith("https://")) throw new Error("WEB_ORIGIN must use HTTPS in production");
  }

  cachedConfig = {
    port,
    databaseUrl,
    shutdownTimeoutMs,
    jwt: {
      accessSecret,
      refreshSecret,
      issuer: process.env.JWT_ISSUER?.trim() || "partpulse-api",
      audience: process.env.JWT_AUDIENCE?.trim() || "partpulse-web",
      accessTtlSeconds,
      refreshTtlSeconds,
    },
    webOrigin,
    storage: storageBucket && storageRegion && storageAccessKeyId && storageSecretAccessKey ? {
      bucket: storageBucket,
      region: storageRegion,
      endpoint: storageEndpoint,
      accessKeyId: storageAccessKeyId,
      secretAccessKey: storageSecretAccessKey,
      forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
      uploadUrlTtlSeconds: storageUploadUrlTtlSeconds,
      maxImageBytes: storageMaxImageBytes,
      maxImportBytes: storageMaxImportBytes,
      maxImageArchiveBytes: storageMaxImageArchiveBytes,
    } : undefined,
    ebay: {
      clientId,
      clientSecret,
      environment,
      mode: clientId && clientSecret ? "live" : "demo",
      notifications: {
        endpoint: notificationEndpoint,
        verificationToken: notificationVerificationToken,
      },
      oauth: {
        ruName: ebayRuName,
        encryptionKey: ebayEncryptionKey,
        scopes: ebayOAuthScopes,
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
