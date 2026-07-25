const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type AccessSession = {
  accessToken: string;
  expiresIn: number;
  expiresAt: number;
};

export type CachedWorkspaceSession = {
  user: { id: string; email: string; name: string | null };
  organization: { id: string; name: string; slug: string };
  role: string;
};

let inflight: Promise<AccessSession> | null = null;
let cached: AccessSession | null = null;
let cachedWorkspaceSession: CachedWorkspaceSession | null = null;

const getInflight = new Map<string, Promise<unknown>>();
const getCache = new Map<string, { expiresAt: number; data: unknown }>();

function isFresh(session: AccessSession, skewMs = 30_000) {
  return Date.now() < session.expiresAt - skewMs;
}

export function getCachedAccessSession(): AccessSession | null {
  if (!cached || !isFresh(cached)) return null;
  return cached;
}

export function getCachedWorkspaceSession(): CachedWorkspaceSession | null {
  return cachedWorkspaceSession;
}

export function setCachedWorkspaceSession(session: CachedWorkspaceSession | null): void {
  cachedWorkspaceSession = session;
}

export function clearAccessSessionCache(): void {
  cached = null;
  cachedWorkspaceSession = null;
  getInflight.clear();
  getCache.clear();
}

/**
 * Returns a usable access token.
 * Concurrent callers share one in-flight refresh. Fresh tokens are reused
 * so route changes do not rotate the one-time refresh cookie again.
 */
export function refreshAccessSession(options?: { force?: boolean }): Promise<AccessSession> {
  if (!options?.force) {
    const existing = getCachedAccessSession();
    if (existing) return Promise.resolve(existing);
  }
  if (inflight) return inflight;

  inflight = fetch(`${apiBase}/api/auth/refresh`, {
    method: "POST",
    credentials: "include",
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("Session expired");
      const body = (await response.json()) as { accessToken?: string; expiresIn?: number };
      if (!body.accessToken) throw new Error("Session expired");
      const expiresIn = body.expiresIn ?? 900;
      const session: AccessSession = {
        accessToken: body.accessToken,
        expiresIn,
        expiresAt: Date.now() + expiresIn * 1_000,
      };
      cached = session;
      return session;
    })
    .catch((error) => {
      cached = null;
      throw error;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export async function logoutSession(): Promise<void> {
  clearAccessSessionCache();
  await fetch(`${apiBase}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

/** Dedupes concurrent identical GETs and briefly caches successful responses. */
export function apiGetCached(
  path: string,
  token: string,
  init: RequestInit = {},
  ttlMs = 20_000,
): Promise<unknown> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    return apiRequest(path, token, init).then((result) => {
      getCache.clear();
      return result;
    });
  }

  const cacheKey = `${token}::${path}`;
  const hit = getCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data);

  const existing = getInflight.get(cacheKey);
  if (existing) return existing;

  const pending = apiRequest(path, token, init)
    .then((data) => {
      getCache.set(cacheKey, { expiresAt: Date.now() + ttlMs, data });
      return data;
    })
    .finally(() => {
      getInflight.delete(cacheKey);
    });

  getInflight.set(cacheKey, pending);
  return pending;
}

async function apiRequest(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(
      typeof body === "object" && body && "error" in body && typeof body.error === "string"
        ? body.error
        : "Request failed",
    );
  }
  return body;
}

export { apiBase };
