import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

export class IdempotencyError extends Error {
  constructor(message: string, readonly statusCode: 409 = 409) {
    super(message);
    this.name = "IdempotencyError";
  }
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export function requestHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function replay<T>(record: {
  requestHash: string;
  status: "IN_PROGRESS" | "COMPLETED";
  responseBody: Prisma.JsonValue | null;
}, hash: string): Promise<{ value: T; replayed: true }> {
  if (record.requestHash !== hash) throw new IdempotencyError("Idempotency key was already used with a different request");
  if (record.status !== "COMPLETED" || record.responseBody === null) {
    throw new IdempotencyError("A request with this idempotency key is still in progress");
  }
  return { value: record.responseBody as T, replayed: true };
}

export async function executeIdempotent<T>(input: {
  organizationId: string;
  operation: string;
  key?: string;
  request: unknown;
  responseStatus: number;
  execute: () => Promise<T>;
}): Promise<{ value: T; replayed: boolean }> {
  if (!input.key) return { value: await input.execute(), replayed: false };
  const hash = requestHash(input.request);
  const unique = { organizationId_operation_key: { organizationId: input.organizationId, operation: input.operation, key: input.key } };
  let existing = await prisma.idempotencyRecord.findUnique({ where: unique });
  if (existing && existing.expiresAt <= new Date()) {
    await prisma.idempotencyRecord.deleteMany({ where: { id: existing.id, expiresAt: { lte: new Date() } } });
    existing = null;
  }
  if (existing) return replay<T>(existing, hash);

  let reservation;
  try {
    reservation = await prisma.idempotencyRecord.create({
      data: {
        organizationId: input.organizationId,
        operation: input.operation,
        key: input.key,
        requestHash: hash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const concurrent = await prisma.idempotencyRecord.findUnique({ where: unique });
    if (!concurrent) throw error;
    return replay<T>(concurrent, hash);
  }

  try {
    const value = await input.execute();
    await prisma.idempotencyRecord.update({
      where: { id: reservation.id },
      data: { status: "COMPLETED", responseStatus: input.responseStatus, responseBody: asJson(value) },
    });
    return { value, replayed: false };
  } catch (error) {
    await prisma.idempotencyRecord.deleteMany({ where: { id: reservation.id, status: "IN_PROGRESS" } }).catch(() => undefined);
    throw error;
  }
}
