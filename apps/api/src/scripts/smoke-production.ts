import "../env.js";

const rawBaseUrl = process.env.API_BASE_URL?.trim();
if (!rawBaseUrl) throw new Error("API_BASE_URL is required, for example https://your-api.up.railway.app");
const baseUrl = rawBaseUrl.replace(/\/$/, "");
const parsed = new URL(baseUrl);
if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
  throw new Error("API_BASE_URL must use HTTPS outside localhost");
}

async function check(path: string, accessToken?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  const requestId = response.headers.get("x-request-id");
  if (!requestId) throw new Error(`${path} did not return X-Request-Id`);
  if (response.headers.get("x-content-type-options") !== "nosniff") throw new Error(`${path} is missing security headers`);
  console.log(`${path}: HTTP ${response.status} (request ${requestId})`);
}

await check("/health/live");
await check("/health/ready");
const accessToken = process.env.API_ACCESS_TOKEN?.trim();
if (accessToken) {
  await check("/api/session", accessToken);
  await check("/api/parts?page=1&pageSize=1", accessToken);
} else {
  console.log("API_ACCESS_TOKEN is not set; authenticated smoke checks were skipped");
}
console.log("Production smoke checks passed");
