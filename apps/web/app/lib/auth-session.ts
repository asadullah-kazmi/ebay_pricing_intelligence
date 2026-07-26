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

export class SessionExpiredError extends Error {
  constructor(message = "Session expired") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

let inflight: Promise<AccessSession> | null = null;
let cached: AccessSession | null = null;
let cachedWorkspaceSession: CachedWorkspaceSession | null = null;

const getInflight = new Map<string, Promise<unknown>>();
const getCache = new Map<string, { expiresAt: number; data: unknown }>();

function isFresh(session: AccessSession, skewMs = 60_000) {
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
      if (!response.ok) throw new SessionExpiredError();
      const body = (await response.json()) as { accessToken?: string; expiresIn?: number };
      if (!body.accessToken) throw new SessionExpiredError();
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
      throw error instanceof SessionExpiredError ? error : new SessionExpiredError();
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

function errorFromBody(body: unknown, fallback = "Request failed") {
  if (typeof body === "object" && body && "error" in body && typeof (body as { error: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return fallback;
}

async function rawAuthorizedFetch(path: string, accessToken: string, init: RequestInit = {}) {
  return fetch(`${apiBase}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

/**
 * Authenticated API request with automatic access-token refresh + single 401 retry.
 */
export async function apiRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  let session = await refreshAccessSession();
  let response = await rawAuthorizedFetch(path, session.accessToken, init);

  if (response.status === 401) {
    cached = null;
    getInflight.clear();
    getCache.clear();
    session = await refreshAccessSession({ force: true });
    response = await rawAuthorizedFetch(path, session.accessToken, init);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("json") ? await response.json() : await response.text();
  if (!response.ok) {
    if (response.status === 401) throw new SessionExpiredError(errorFromBody(body, "Invalid or expired access token"));
    throw new Error(errorFromBody(body));
  }
  return body;
}

/** Dedupes concurrent identical GETs and briefly caches successful responses. */
export function apiGetCached(
  path: string,
  tokenOrInit?: string | RequestInit,
  maybeInit?: RequestInit,
  ttlMs = 20_000,
): Promise<unknown> {
  // Back-compat: apiGetCached(path, token, init) and apiGetCached(path, init)
  const init: RequestInit =
    typeof tokenOrInit === "string" || tokenOrInit === undefined
      ? (maybeInit ?? {})
      : tokenOrInit;
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    return apiRequest(path, init).then((result) => {
      getCache.clear();
      return result;
    });
  }

  const cacheKey = path;
  const hit = getCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data);

  const existing = getInflight.get(cacheKey);
  if (existing) return existing;

  const pending = apiRequest(path, init)
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

export { apiBase };
