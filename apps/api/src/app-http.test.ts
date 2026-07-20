import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("API HTTP release boundary", () => {
  it("serves liveness with secure headers and no framework disclosure", async () => {
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(response.headers.get("x-powered-by")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(response.headers.get("ratelimit-limit")).toBe("600");
  });

  it("preserves a valid correlation ID and returns JSON for unknown routes", async () => {
    const requestId = "4c67d96f-7f6d-4ce7-a6ac-91dbe67e9734";
    const response = await fetch(`${baseUrl}/missing`, { headers: { "X-Request-Id": requestId } });
    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(requestId);
    await expect(response.json()).resolves.toEqual({ error: "Route not found", requestId });
  });

  it("replaces malformed caller-supplied correlation IDs", async () => {
    const response = await fetch(`${baseUrl}/health/live`, { headers: { "X-Request-Id": "not-safe" } });
    expect(response.headers.get("x-request-id")).not.toBe("not-safe");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
