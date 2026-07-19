import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const organizationRoles = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "CATALOG_OPERATOR",
  "PRICING_OPERATOR",
  "PUBLISHER",
  "VIEWER",
] as const;

export type OrganizationRole = (typeof organizationRoles)[number];

const tokenHeaderSchema = z.object({ alg: z.literal("HS256"), typ: z.literal("JWT") });
const tokenClaimsSchema = z.object({
  sub: z.string().min(1),
  organizationId: z.string().min(1),
  iss: z.string().min(1),
  aud: z.string().min(1),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

export type ApplicationTokenClaims = z.infer<typeof tokenClaimsSchema>;

export class AuthenticationError extends Error {
  constructor(message = "Invalid or expired access token") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message = "Insufficient organization permission") {
    super(message);
    this.name = "AuthorizationError";
  }
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new AuthenticationError();
  }
}

function signatureFor(unsignedToken: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(unsignedToken).digest();
}

function assertStrongSecret(secret: string): void {
  if (secret.length < 32) throw new Error("The application authentication secret must contain at least 32 characters");
}

export function createApplicationToken(
  input: { userId: string; organizationId: string },
  options: { secret: string; issuer: string; audience: string; lifetimeSeconds?: number; now?: Date },
): string {
  assertStrongSecret(options.secret);
  const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const lifetimeSeconds = options.lifetimeSeconds ?? 15 * 60;
  if (!Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 1) throw new Error("Token lifetime must be a positive integer");

  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    sub: input.userId,
    organizationId: input.organizationId,
    iss: options.issuer,
    aud: options.audience,
    iat: issuedAt,
    exp: issuedAt + lifetimeSeconds,
  });
  const unsignedToken = `${header}.${payload}`;
  return `${unsignedToken}.${signatureFor(unsignedToken, options.secret).toString("base64url")}`;
}

export function verifyApplicationToken(
  token: string,
  options: { secret: string; issuer: string; audience: string; now?: Date },
): ApplicationTokenClaims {
  assertStrongSecret(options.secret);
  const segments = token.split(".");
  if (segments.length !== 3) throw new AuthenticationError();
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new AuthenticationError();

  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = signatureFor(unsignedToken, options.secret);
  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    throw new AuthenticationError();
  }
  if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) {
    throw new AuthenticationError();
  }

  const header = tokenHeaderSchema.safeParse(decodeJson(encodedHeader));
  const claims = tokenClaimsSchema.safeParse(decodeJson(encodedPayload));
  if (!header.success || !claims.success) throw new AuthenticationError();

  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (
    claims.data.iss !== options.issuer
    || claims.data.aud !== options.audience
    || claims.data.iat > now
    || claims.data.exp <= now
    || claims.data.exp <= claims.data.iat
  ) {
    throw new AuthenticationError();
  }
  return claims.data;
}
