import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
const passwordKeyLength = 64;
const scryptCost = 16_384;
const scryptBlockSize = 8;
const scryptParallelization = 1;
const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function scrypt(password: string, salt: Uint8Array, keyLength: number, options: { N: number; r: number; p: number; maxmem: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, passwordKeyLength, {
    N: scryptCost,
    r: scryptBlockSize,
    p: scryptParallelization,
    maxmem: 64 * 1024 * 1024,
  });
  return ["scrypt", scryptCost, scryptBlockSize, scryptParallelization, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !cost || !blockSize || !parallelization || !saltValue || !hashValue) return false;
  try {
    const expected = Buffer.from(hashValue, "base64url");
    const derived = await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length, {
      N: Number(cost), r: Number(blockSize), p: Number(parallelization), maxmem: 64 * 1024 * 1024,
    });
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

export function hashOpaqueToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function base32Encode(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += base32Alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string) {
  const normalized = input.toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of normalized) {
    const index = base32Alphabet.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, now = new Date(), stepOffset = 0) {
  const counter = Math.floor(now.getTime() / 1000 / 30) + stepOffset;
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return number.toString().padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, now = new Date()) {
  return matchingTotpStep(secret, code, now) !== null;
}

export function matchingTotpStep(secret: string, code: string, now = new Date()): number | null {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const currentStep = Math.floor(now.getTime() / 1000 / 30);
  for (const offset of [-1, 0, 1]) {
    const expected = Buffer.from(totpCode(secret, now, offset));
    const supplied = Buffer.from(normalized);
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return currentStep + offset;
  }
  return null;
}

export function encryptMfaSecret(secret: string, key: Buffer) {
  if (key.length !== 32) throw new Error("MFA encryption requires a 32-byte key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptMfaSecret(value: string, key: Buffer) {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext || key.length !== 32) throw new Error("Invalid encrypted MFA secret");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => {
    const value = randomBytes(8).toString("hex").toUpperCase();
    return `PP-${value.slice(0, 8)}-${value.slice(8)}`;
  });
}

export function normalizeRecoveryCode(code: string) {
  return code.trim().toUpperCase().replace(/\s/g, "");
}
