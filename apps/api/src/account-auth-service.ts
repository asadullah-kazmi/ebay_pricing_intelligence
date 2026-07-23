import { randomBytes } from "node:crypto";
import { Prisma, type OrganizationRole, type UserAuthTokenType } from "@prisma/client";
import { issueTokenPair, type RefreshSessionStore, type TokenPair } from "./auth-sessions.js";
import { recordAuditEvent } from "./audit-service.js";
import { type JwtConfiguration } from "./auth.js";
import { getConfig } from "./config.js";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashOpaqueToken,
  hashPassword,
  matchingTotpStep,
  normalizeRecoveryCode,
  verifyPassword,
} from "./credential-security.js";
import { prisma } from "./db.js";
import { emailIsConfigured, sendAccountRecoveryEmail, sendPasswordResetEmail, sendVerificationEmail } from "./email-service.js";

const verificationTtlMs = 24 * 60 * 60_000;
const passwordResetTtlMs = 60 * 60_000;
const accountRecoveryTtlMs = 15 * 60_000;
const mfaChallengeTtlMs = 5 * 60_000;
const mfaSetupTtlMs = 10 * 60_000;
const accountLockMs = 15 * 60_000;
const maxLoginFailures = 5;
const maxMfaAttempts = 5;
const dummyPasswordHash = "scrypt$16384$8$1$MDEyMzQ1Njc4OWFiY2RlZg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export class AccountAuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 401 | 403 | 404 | 409 | 429 | 503 = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AccountAuthError";
  }
}

export function passwordMeetsPolicy(password: string) {
  return password.length >= 12
    && password.length <= 128
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function slugBase(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 45) || "organization";
}

async function uniqueOrganizationSlug(tx: Prisma.TransactionClient, name: string) {
  const base = slugBase(name);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomBytes(3).toString("hex")}`;
    if (!(await tx.organization.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
  }
  throw new AccountAuthError("Unable to create a unique organization identifier", 409);
}

function actionUrl(path: string, token: string) {
  const origin = getConfig().webOrigin ?? "http://localhost:3000";
  return `${origin}${path}#token=${encodeURIComponent(token)}`;
}

async function createAuthToken(tx: Prisma.TransactionClient, userId: string, type: UserAuthTokenType, ttlMs: number) {
  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  await tx.userAuthToken.updateMany({
    where: { userId, type, consumedAt: null },
    data: { consumedAt: now },
  });
  await tx.userAuthToken.create({
    data: { userId, type, tokenHash: hashOpaqueToken(token), expiresAt: new Date(now.getTime() + ttlMs) },
  });
  return token;
}

async function deliverVerification(email: string, token: string) {
  const url = actionUrl("/verify-email", token);
  if (!emailIsConfigured()) return { emailDelivery: "not_configured" as const, ...(process.env.NODE_ENV !== "production" ? { developmentUrl: url } : {}) };
  try {
    await sendVerificationEmail(email, url);
    return { emailDelivery: "sent" as const };
  } catch (error) {
    console.error(JSON.stringify({ type: "verification_email_failed", error: error instanceof Error ? error.message : "Unknown email error" }));
    return { emailDelivery: "failed" as const };
  }
}

async function deliverPasswordReset(email: string, token: string) {
  const url = actionUrl("/reset-password", token);
  if (!emailIsConfigured()) return process.env.NODE_ENV !== "production" ? { developmentUrl: url } : {};
  try {
    await sendPasswordResetEmail(email, url);
  } catch (error) {
    console.error(JSON.stringify({ type: "password_reset_email_failed", error: error instanceof Error ? error.message : "Unknown email error" }));
  }
  return {};
}

async function deliverAccountRecovery(email: string, token: string) {
  const url = actionUrl("/account-recovery/confirm", token);
  if (!emailIsConfigured()) return process.env.NODE_ENV !== "production" ? { developmentUrl: url } : {};
  try {
    await sendAccountRecoveryEmail(email, url);
  } catch (error) {
    console.error(JSON.stringify({ type: "account_recovery_email_failed", error: error instanceof Error ? error.message : "Unknown email error" }));
  }
  return {};
}

function transactionSessionStore(tx: Prisma.TransactionClient): RefreshSessionStore {
  return {
    membershipExists: async (userId, organizationId) => Boolean(await tx.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true },
    })),
    create: async (session) => { await tx.refreshSession.create({ data: session }); },
    rotate: async () => false,
    revoke: async () => undefined,
  };
}

export async function registerAccount(input: {
  email: string;
  name: string;
  password: string;
  organizationName: string;
  requestId?: string;
}) {
  if (!passwordMeetsPolicy(input.password)) throw new AccountAuthError("Password does not meet the security requirements");
  const email = normalizeEmail(input.email);
  const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
  if (existing) throw new AccountAuthError("An account already exists for this email", 409);
  const passwordHash = await hashPassword(input.password);
  const created = await prisma.$transaction(async (tx) => {
    const slug = await uniqueOrganizationSlug(tx, input.organizationName);
    const user = await tx.user.create({
      data: { email, name: input.name.trim(), passwordHash, passwordChangedAt: new Date() },
      select: { id: true, email: true, name: true },
    });
    const organization = await tx.organization.create({
      data: { name: input.organizationName.trim(), slug },
      select: { id: true, name: true, slug: true },
    });
    await tx.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
    const token = await createAuthToken(tx, user.id, "EMAIL_VERIFICATION", verificationTtlMs);
    await recordAuditEvent(tx, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: "auth.account.registered",
      resourceType: "User",
      resourceId: user.id,
      summary: "Organization owner account registered",
      metadata: { email: user.email },
      requestId: input.requestId,
    });
    return { user, organization, token };
  }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AccountAuthError("Registration conflicted with an existing account. Sign in or try again.", 409);
    }
    throw error;
  });
  return {
    user: created.user,
    organization: created.organization,
    verificationRequired: true,
    ...(await deliverVerification(created.user.email, created.token)),
  };
}

export async function requestEmailVerification(emailInput: string) {
  const email = normalizeEmail(emailInput);
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, emailVerifiedAt: null },
    select: { id: true, email: true },
  });
  if (!user) return { accepted: true };
  const token = await prisma.$transaction((tx) => createAuthToken(tx, user.id, "EMAIL_VERIFICATION", verificationTtlMs));
  return { accepted: true, ...(await deliverVerification(user.email, token)) };
}

export async function verifyAccountEmail(token: string) {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const record = await tx.userAuthToken.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      include: { user: { select: { id: true, email: true, emailVerifiedAt: true, memberships: { select: { organizationId: true }, take: 1 } } } },
    });
    if (!record || record.type !== "EMAIL_VERIFICATION" || record.consumedAt || record.expiresAt <= now) {
      throw new AccountAuthError("Verification link is invalid or expired", 409);
    }
    await tx.userAuthToken.update({ where: { id: record.id }, data: { consumedAt: now } });
    await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: record.user.emailVerifiedAt ?? now } });
    const organizationId = record.user.memberships[0]?.organizationId;
    if (organizationId) {
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: record.userId,
        action: "auth.email.verified",
        resourceType: "User",
        resourceId: record.userId,
        summary: "Account email address verified",
      });
    }
    return { email: record.user.email, verified: true };
  });
  return result;
}

type LoginMembership = {
  role: OrganizationRole;
  organization: { id: string; name: string; slug: string };
};

function selectMembership(memberships: LoginMembership[], slug?: string) {
  if (slug) {
    const membership = memberships.find((item) => item.organization.slug.toLowerCase() === slug.toLowerCase());
    if (!membership) throw new AccountAuthError("Invalid email, password, or organization", 401);
    return membership;
  }
  if (memberships.length === 1) return memberships[0]!;
  return null;
}

export type LoginResult =
  | { organizationRequired: true; organizations: Array<{ name: string; slug: string }> }
  | { mfaRequired: true; challengeToken: string; expiresIn: number }
  | { authenticated: true; pair: TokenPair; organization: { id: string; name: string; slug: string }; role: OrganizationRole };

export async function loginAccount(input: {
  email: string;
  password: string;
  organizationSlug?: string;
  jwt: JwtConfiguration;
  requestId?: string;
}): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true, email: true, passwordHash: true, emailVerifiedAt: true, failedLoginAttempts: true, lockedUntil: true,
      mfaEnabled: true,
      memberships: { select: { role: true, organization: { select: { id: true, name: true, slug: true } } } },
    },
  });
  const validPassword = await verifyPassword(input.password, user?.passwordHash ?? dummyPasswordHash);
  if (!user || !validPassword) {
    if (user) {
      const failed = await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true },
      });
      if (failed.failedLoginAttempts >= maxLoginFailures) {
        await prisma.user.update({
          where: { id: user.id },
          data: { lockedUntil: new Date(Date.now() + accountLockMs) },
        });
      }
    }
    throw new AccountAuthError("Invalid email, password, or organization", 401);
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new AccountAuthError("Account is temporarily locked. Try again later.", 429);
  if (!user.emailVerifiedAt) throw new AccountAuthError("Verify your email before signing in", 403, { verificationRequired: true });
  if (!user.memberships.length) throw new AccountAuthError("This account has no active organization membership", 403);
  const membership = selectMembership(user.memberships, input.organizationSlug);
  if (!membership) {
    return { organizationRequired: true, organizations: user.memberships.map(({ organization }) => ({ name: organization.name, slug: organization.slug })) };
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
  if (user.mfaEnabled) {
    if (!getConfig().mfaEncryptionKey) throw new AccountAuthError("MFA is not configured on the server", 503);
    const challengeToken = randomBytes(32).toString("base64url");
    await prisma.mfaLoginChallenge.create({
      data: {
        userId: user.id,
        organizationId: membership.organization.id,
        tokenHash: hashOpaqueToken(challengeToken),
        expiresAt: new Date(Date.now() + mfaChallengeTtlMs),
      },
    });
    return { mfaRequired: true, challengeToken, expiresIn: Math.floor(mfaChallengeTtlMs / 1000) };
  }
  const pair = await issueTokenPair({ userId: user.id, organizationId: membership.organization.id }, input.jwt);
  await recordAuditEvent(prisma, {
    organizationId: membership.organization.id,
    actorUserId: user.id,
    action: "auth.login.succeeded",
    resourceType: "User",
    resourceId: user.id,
    summary: "User signed in",
    requestId: input.requestId,
  });
  return { authenticated: true, pair, organization: membership.organization, role: membership.role };
}

async function consumeMfaCode(tx: Prisma.TransactionClient, user: { id: string; mfaSecretEncrypted: string | null }, code: string, now: Date) {
  const key = getConfig().mfaEncryptionKey;
  if (!key || !user.mfaSecretEncrypted) throw new AccountAuthError("MFA is not available", 503);
  if (/^\d{6}$/.test(code.replace(/\s/g, ""))) {
    const step = matchingTotpStep(decryptMfaSecret(user.mfaSecretEncrypted, key), code, now);
    if (step === null) return false;
    const claimed = await tx.user.updateMany({
      where: {
        id: user.id,
        OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }],
      },
      data: { mfaLastUsedStep: step },
    });
    return claimed.count === 1;
  }
  const recovery = await tx.mfaRecoveryCode.findFirst({
    where: { userId: user.id, codeHash: hashOpaqueToken(normalizeRecoveryCode(code)), usedAt: null },
  });
  if (!recovery) return false;
  const claimed = await tx.mfaRecoveryCode.updateMany({
    where: { id: recovery.id, usedAt: null },
    data: { usedAt: now },
  });
  return claimed.count === 1;
}

export async function completeMfaLogin(input: {
  challengeToken: string;
  code: string;
  jwt: JwtConfiguration;
  requestId?: string;
}) {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const challenge = await tx.mfaLoginChallenge.findUnique({
      where: { tokenHash: hashOpaqueToken(input.challengeToken) },
      include: {
        user: { select: { id: true, mfaSecretEncrypted: true } },
        organization: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= now || challenge.attempts >= maxMfaAttempts) {
      throw new AccountAuthError("MFA challenge is invalid or expired", 401);
    }
    const valid = await consumeMfaCode(tx, challenge.user, input.code, now);
    if (!valid) {
      await tx.mfaLoginChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 }, ...(challenge.attempts + 1 >= maxMfaAttempts ? { consumedAt: now } : {}) },
      });
      return { invalid: true as const };
    }
    await tx.mfaLoginChallenge.update({ where: { id: challenge.id }, data: { consumedAt: now } });
    const pair = await issueTokenPair(
      { userId: challenge.userId, organizationId: challenge.organizationId },
      input.jwt,
      transactionSessionStore(tx),
      now,
    );
    await recordAuditEvent(tx, {
      organizationId: challenge.organizationId,
      actorUserId: challenge.userId,
      action: "auth.login.mfa_succeeded",
      resourceType: "User",
      resourceId: challenge.userId,
      summary: "User completed MFA sign-in",
      requestId: input.requestId,
    });
    return { authenticated: true as const, pair, organization: challenge.organization };
  });
  if ("invalid" in result) throw new AccountAuthError("Invalid authentication code", 401);
  return result;
}

export async function requestPasswordReset(emailInput: string) {
  const email = normalizeEmail(emailInput);
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true },
  });
  if (!user) return { accepted: true };
  const token = await prisma.$transaction((tx) => createAuthToken(tx, user.id, "PASSWORD_RESET", passwordResetTtlMs));
  return { accepted: true, ...(await deliverPasswordReset(user.email, token)) };
}

export async function requestAccountRecovery(emailInput: string) {
  const email = normalizeEmail(emailInput);
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true },
  });
  if (!user) return { accepted: true };
  const token = await prisma.$transaction((tx) => createAuthToken(tx, user.id, "ACCOUNT_RECOVERY", accountRecoveryTtlMs));
  return { accepted: true, ...(await deliverAccountRecovery(user.email, token)) };
}

export async function resetAccountPassword(token: string, password: string) {
  if (!passwordMeetsPolicy(password)) throw new AccountAuthError("Password does not meet the security requirements");
  const passwordHash = await hashPassword(password);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const record = await tx.userAuthToken.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      include: { user: { select: { memberships: { select: { organizationId: true }, take: 1 } } } },
    });
    if (!record || record.type !== "PASSWORD_RESET" || record.consumedAt || record.expiresAt <= now) {
      throw new AccountAuthError("Password reset link is invalid or expired", 409);
    }
    await tx.userAuthToken.update({ where: { id: record.id }, data: { consumedAt: now } });
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, passwordChangedAt: now, failedLoginAttempts: 0, lockedUntil: null },
    });
    await tx.refreshSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.mfaLoginChallenge.deleteMany({ where: { userId: record.userId } });
    const organizationId = record.user.memberships[0]?.organizationId;
    if (organizationId) {
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: record.userId,
        action: "auth.password.reset",
        resourceType: "User",
        resourceId: record.userId,
        severity: "WARNING",
        summary: "Account password reset; active sessions revoked",
      });
    }
    return { reset: true };
  });
}

export async function recoverAccount(token: string, password: string) {
  if (!passwordMeetsPolicy(password)) throw new AccountAuthError("Password does not meet the security requirements");
  const passwordHash = await hashPassword(password);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const record = await tx.userAuthToken.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      include: { user: { select: { emailVerifiedAt: true, memberships: { select: { organizationId: true } } } } },
    });
    if (!record || record.type !== "ACCOUNT_RECOVERY" || record.consumedAt || record.expiresAt <= now) {
      throw new AccountAuthError("Account recovery link is invalid or expired", 409);
    }
    await tx.userAuthToken.updateMany({
      where: { userId: record.userId, consumedAt: null },
      data: { consumedAt: now },
    });
    await tx.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        passwordChangedAt: now,
        emailVerifiedAt: record.user.emailVerifiedAt ?? now,
        failedLoginAttempts: 0,
        lockedUntil: null,
        mfaEnabled: false,
        mfaSecretEncrypted: null,
        pendingMfaSecretEncrypted: null,
        pendingMfaCreatedAt: null,
        mfaLastUsedStep: null,
      },
    });
    await tx.refreshSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.mfaLoginChallenge.deleteMany({ where: { userId: record.userId } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: record.userId } });
    for (const membership of record.user.memberships) {
      await recordAuditEvent(tx, {
        organizationId: membership.organizationId,
        actorUserId: record.userId,
        action: "auth.account.recovered",
        resourceType: "User",
        resourceId: record.userId,
        severity: "CRITICAL",
        summary: "Account recovered by email; password replaced, MFA removed, and sessions revoked",
      });
    }
    return { recovered: true, mfaDisabled: true, reauthenticationRequired: true };
  });
}

export async function getAccountSecurity(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true, emailVerifiedAt: true, passwordHash: true, passwordChangedAt: true, mfaEnabled: true,
      _count: { select: { mfaRecoveryCodes: { where: { usedAt: null } } } },
    },
  });
  if (!user) throw new AccountAuthError("Account not found", 404);
  return {
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    emailVerifiedAt: user.emailVerifiedAt,
    hasPassword: Boolean(user.passwordHash),
    passwordChangedAt: user.passwordChangedAt,
    mfaEnabled: user.mfaEnabled,
    recoveryCodesRemaining: user._count.mfaRecoveryCodes,
  };
}

export async function changeAccountPassword(input: {
  userId: string;
  organizationId: string;
  currentPassword?: string;
  password: string;
  requestId?: string;
}) {
  if (!passwordMeetsPolicy(input.password)) throw new AccountAuthError("Password does not meet the security requirements");
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { passwordHash: true } });
  if (!user) throw new AccountAuthError("Account not found", 404);
  if (user.passwordHash && (!input.currentPassword || !(await verifyPassword(input.currentPassword, user.passwordHash)))) {
    throw new AccountAuthError("Current password is incorrect", 401);
  }
  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.userId }, data: { passwordHash, passwordChangedAt: now } });
    await tx.refreshSession.updateMany({ where: { userId: input.userId, revokedAt: null }, data: { revokedAt: now } });
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: user.passwordHash ? "auth.password.changed" : "auth.password.created",
      resourceType: "User",
      resourceId: input.userId,
      severity: "WARNING",
      summary: user.passwordHash ? "Password changed; active sessions revoked" : "Initial account password created; active sessions revoked",
      requestId: input.requestId,
    });
  });
  return { changed: true, reauthenticationRequired: true };
}

function mfaKey() {
  const key = getConfig().mfaEncryptionKey;
  if (!key) throw new AccountAuthError("MFA is not configured on the server", 503);
  return key;
}

export async function beginMfaSetup(input: { userId: string; email: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { passwordHash: true, mfaEnabled: true } });
  if (!user?.passwordHash) throw new AccountAuthError("Create an account password before enabling MFA", 409);
  if (!(await verifyPassword(input.password, user.passwordHash))) throw new AccountAuthError("Password is incorrect", 401);
  if (user.mfaEnabled) throw new AccountAuthError("MFA is already enabled", 409);
  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: input.userId },
    data: { pendingMfaSecretEncrypted: encryptMfaSecret(secret, mfaKey()), pendingMfaCreatedAt: new Date() },
  });
  const issuer = "PartPulse";
  const uri = `otpauth://totp/${encodeURIComponent(`${issuer}:${input.email}`)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  return { secret, otpauthUri: uri };
}

export async function confirmMfaSetup(input: {
  userId: string;
  organizationId: string;
  code: string;
  requestId?: string;
}) {
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { pendingMfaSecretEncrypted: true, pendingMfaCreatedAt: true, mfaEnabled: true } });
  if (!user?.pendingMfaSecretEncrypted || !user.pendingMfaCreatedAt || user.mfaEnabled) throw new AccountAuthError("MFA setup is not pending", 409);
  if (user.pendingMfaCreatedAt.getTime() + mfaSetupTtlMs <= Date.now()) {
    await prisma.user.update({ where: { id: input.userId }, data: { pendingMfaSecretEncrypted: null, pendingMfaCreatedAt: null } });
    throw new AccountAuthError("MFA setup expired; begin again", 409);
  }
  const secret = decryptMfaSecret(user.pendingMfaSecretEncrypted, mfaKey());
  const setupStep = matchingTotpStep(secret, input.code);
  if (setupStep === null) throw new AccountAuthError("Invalid authentication code", 401);
  const codes = generateRecoveryCodes();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: {
        mfaEnabled: true,
        mfaSecretEncrypted: user.pendingMfaSecretEncrypted,
        pendingMfaSecretEncrypted: null,
        pendingMfaCreatedAt: null,
        mfaLastUsedStep: setupStep,
      },
    });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: input.userId } });
    await tx.mfaRecoveryCode.createMany({ data: codes.map((code) => ({ userId: input.userId, codeHash: hashOpaqueToken(code) })) });
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "auth.mfa.enabled",
      resourceType: "User",
      resourceId: input.userId,
      severity: "WARNING",
      summary: "Multi-factor authentication enabled",
      requestId: input.requestId,
    });
  });
  return { enabled: true, recoveryCodes: codes };
}

export async function disableMfa(input: {
  userId: string;
  organizationId: string;
  password: string;
  code: string;
  requestId?: string;
}) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, passwordHash: true, mfaEnabled: true, mfaSecretEncrypted: true },
  });
  if (!user?.mfaEnabled || !user.passwordHash) throw new AccountAuthError("MFA is not enabled", 409);
  if (!(await verifyPassword(input.password, user.passwordHash))) throw new AccountAuthError("Password is incorrect", 401);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (!(await consumeMfaCode(tx, user, input.code, now))) throw new AccountAuthError("Invalid authentication or recovery code", 401);
    await tx.user.update({
      where: { id: input.userId },
      data: {
        mfaEnabled: false,
        mfaSecretEncrypted: null,
        pendingMfaSecretEncrypted: null,
        pendingMfaCreatedAt: null,
        mfaLastUsedStep: null,
      },
    });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: input.userId } });
    await tx.mfaLoginChallenge.deleteMany({ where: { userId: input.userId } });
    await tx.refreshSession.updateMany({ where: { userId: input.userId, revokedAt: null }, data: { revokedAt: now } });
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "auth.mfa.disabled",
      resourceType: "User",
      resourceId: input.userId,
      severity: "CRITICAL",
      summary: "Multi-factor authentication disabled; active sessions revoked",
      requestId: input.requestId,
    });
  });
  return { disabled: true, reauthenticationRequired: true };
}

export async function regenerateMfaRecoveryCodes(input: {
  userId: string;
  organizationId: string;
  password: string;
  code: string;
  requestId?: string;
}) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, passwordHash: true, mfaEnabled: true, mfaSecretEncrypted: true },
  });
  if (!user?.mfaEnabled || !user.passwordHash) throw new AccountAuthError("MFA is not enabled", 409);
  if (!(await verifyPassword(input.password, user.passwordHash))) throw new AccountAuthError("Password is incorrect", 401);
  const now = new Date();
  const codes = generateRecoveryCodes();
  await prisma.$transaction(async (tx) => {
    if (!(await consumeMfaCode(tx, user, input.code, now))) throw new AccountAuthError("Invalid authentication or recovery code", 401);
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: input.userId } });
    await tx.mfaRecoveryCode.createMany({ data: codes.map((code) => ({ userId: input.userId, codeHash: hashOpaqueToken(code) })) });
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "auth.mfa.recovery_codes_regenerated",
      resourceType: "User",
      resourceId: input.userId,
      severity: "WARNING",
      summary: "MFA recovery codes regenerated",
      requestId: input.requestId,
    });
  });
  return { recoveryCodes: codes };
}
