import { createHash, randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
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
export type TokenType = "access" | "refresh";

export interface JwtConfiguration {
  accessSecret: string;
  refreshSecret: string;
  issuer: string;
  audience: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

const baseClaimsSchema = z.object({
  sub: z.string().min(1),
  organizationId: z.string().min(1),
  iss: z.string().min(1),
  aud: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});
const accessClaimsSchema = baseClaimsSchema.extend({ tokenType: z.literal("access") });
const refreshClaimsSchema = baseClaimsSchema.extend({
  tokenType: z.literal("refresh"),
  jti: z.string().uuid(),
});

export type AccessTokenClaims = z.infer<typeof accessClaimsSchema>;
export type RefreshTokenClaims = z.infer<typeof refreshClaimsSchema>;

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

function key(secret: string): Uint8Array {
  if (secret.length < 32) throw new Error("JWT signing secrets must contain at least 32 characters");
  return new TextEncoder().encode(secret);
}

async function signToken(
  input: { userId: string; organizationId: string; tokenType: TokenType; sessionId?: string },
  secret: string,
  options: { issuer: string; audience: string; ttlSeconds: number; now?: Date },
): Promise<string> {
  const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (!Number.isInteger(options.ttlSeconds) || options.ttlSeconds < 1) throw new Error("Token lifetime must be a positive integer");
  let token = new SignJWT({ organizationId: input.organizationId, tokenType: input.tokenType })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.userId)
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + options.ttlSeconds);
  if (input.sessionId) token = token.setJti(input.sessionId);
  return token.sign(key(secret));
}

async function verifyToken<T>(
  token: string,
  tokenType: TokenType,
  secret: string,
  schema: z.ZodType<T>,
  options: { issuer: string; audience: string; now?: Date },
): Promise<T> {
  try {
    const { payload, protectedHeader } = await jwtVerify(token, key(secret), {
      algorithms: ["HS256"],
      issuer: options.issuer,
      audience: options.audience,
      currentDate: options.now,
    });
    if (protectedHeader.typ !== "JWT" || payload.tokenType !== tokenType) throw new AuthenticationError();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new AuthenticationError();
    return parsed.data;
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;
    throw new AuthenticationError(tokenType === "refresh" ? "Invalid or expired refresh token" : undefined);
  }
}

export function createAccessToken(
  input: { userId: string; organizationId: string },
  config: JwtConfiguration,
  now?: Date,
): Promise<string> {
  return signToken({ ...input, tokenType: "access" }, config.accessSecret, {
    issuer: config.issuer,
    audience: config.audience,
    ttlSeconds: config.accessTtlSeconds,
    now,
  });
}

export async function createRefreshToken(
  input: { userId: string; organizationId: string; sessionId?: string },
  config: JwtConfiguration,
  now?: Date,
): Promise<{ token: string; sessionId: string }> {
  const sessionId = input.sessionId ?? randomUUID();
  const token = await signToken({ ...input, tokenType: "refresh", sessionId }, config.refreshSecret, {
    issuer: config.issuer,
    audience: config.audience,
    ttlSeconds: config.refreshTtlSeconds,
    now,
  });
  return { token, sessionId };
}

export function verifyAccessToken(token: string, config: JwtConfiguration, now?: Date): Promise<AccessTokenClaims> {
  return verifyToken(token, "access", config.accessSecret, accessClaimsSchema, {
    issuer: config.issuer,
    audience: config.audience,
    now,
  });
}

export function verifyRefreshToken(token: string, config: JwtConfiguration, now?: Date): Promise<RefreshTokenClaims> {
  return verifyToken(token, "refresh", config.refreshSecret, refreshClaimsSchema, {
    issuer: config.issuer,
    audience: config.audience,
    now,
  });
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
