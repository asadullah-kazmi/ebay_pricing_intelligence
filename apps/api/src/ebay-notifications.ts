import { createHash, createVerify } from "node:crypto";
import { z } from "zod";
import { getConfig } from "./config.js";
import { getEbayApplicationToken } from "./providers/ebay.js";

const signatureSchema = z.object({ kid: z.string().min(1), signature: z.string().min(1) });

export const accountDeletionNotificationSchema = z.object({
  metadata: z.object({
    topic: z.literal("MARKETPLACE_ACCOUNT_DELETION"),
    schemaVersion: z.string(),
    deprecated: z.boolean(),
  }),
  notification: z.object({
    notificationId: z.string().min(1),
    eventDate: z.string(),
    publishDate: z.string(),
    publishAttemptCount: z.number().int().positive(),
    data: z.object({
      username: z.string().optional(),
      userId: z.string().optional(),
      eiasToken: z.string().optional(),
    }),
  }),
});

export type AccountDeletionNotification = z.infer<typeof accountDeletionNotificationSchema>;

const publicKeyCache = new Map<string, { key: string; expiresAt: number }>();

export function generateChallengeResponse(challengeCode: string, verificationToken: string, endpoint: string): string {
  return createHash("sha256")
    .update(challengeCode)
    .update(verificationToken)
    .update(endpoint)
    .digest("hex");
}

function formatPublicKey(key: string): string {
  return key
    .replace(/-----BEGIN PUBLIC KEY-----\s*/, "-----BEGIN PUBLIC KEY-----\n")
    .replace(/\s*-----END PUBLIC KEY-----/, "\n-----END PUBLIC KEY-----");
}

async function getNotificationPublicKey(keyId: string): Promise<string> {
  const cached = publicKeyCache.get(keyId);
  if (cached && cached.expiresAt > Date.now()) return cached.key;

  const config = getConfig();
  const base = config.ebay.environment === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
  const token = await getEbayApplicationToken();
  const response = await fetch(`${base}/commerce/notification/v1/public_key/${encodeURIComponent(keyId)}`, {
    signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(`eBay notification public-key request failed (${response.status})`);

  const body = z.object({ key: z.string().min(1) }).parse(await response.json());
  const key = formatPublicKey(body.key);
  publicKeyCache.set(keyId, { key, expiresAt: Date.now() + 60 * 60 * 1000 });
  return key;
}

export async function verifyEbayNotificationSignature(message: unknown, signatureHeader: string): Promise<boolean> {
  const decoded = Buffer.from(signatureHeader, "base64").toString("utf8");
  const signature = signatureSchema.parse(JSON.parse(decoded));
  const publicKey = await getNotificationPublicKey(signature.kid);
  const verifier = createVerify("sha1");
  verifier.update(JSON.stringify(message));
  verifier.end();
  return verifier.verify(publicKey, signature.signature, "base64");
}
