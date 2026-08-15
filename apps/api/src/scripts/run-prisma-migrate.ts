import { spawn } from "node:child_process";
import { resolve } from "node:path";
import "../env.js";

const command = process.execPath;
const args = [resolve(process.cwd(), "../../node_modules/prisma/build/index.js"), "migrate", "deploy"];
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key, value]) => value !== undefined && !key.startsWith("=")),
) as NodeJS.ProcessEnv;

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: childEnv,
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
