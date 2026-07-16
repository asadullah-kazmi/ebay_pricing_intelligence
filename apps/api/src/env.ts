import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

const candidates = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
];
const envPath = candidates.find(existsSync);

if (envPath) config({ path: envPath, quiet: true });
