import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

const candidates = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
];
const envPath = candidates.find(existsSync);

if (envPath) config({ path: envPath, quiet: true });

// Neon pooler endpoints can be unreachable on some local networks even when
// the direct compute endpoint is healthy. Prefer the direct endpoint for the
// long-lived local API process; deployed production services retain pooling.
const databaseUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV !== "production" && databaseUrl?.includes("-pooler.")) {
  process.env.DATABASE_URL = databaseUrl.replace("-pooler.", ".");
}
