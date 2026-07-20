import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

interface RateWindow {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, RateWindow>();

  constructor(readonly limit: number, readonly windowMs: number, private readonly maxKeys = 50_000) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Rate limit must be a positive integer");
    if (!Number.isInteger(windowMs) || windowMs < 1_000) throw new Error("Rate-limit window must be at least one second");
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    if (this.windows.size > this.maxKeys) this.prune(now);
    const allowed = window.count <= this.limit;
    return {
      allowed,
      limit: this.limit,
      remaining: Math.max(0, this.limit - window.count),
      resetAt: window.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1_000)),
    };
  }

  private prune(now: number) {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
    while (this.windows.size > this.maxKeys) {
      const oldestKey = this.windows.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.windows.delete(oldestKey);
    }
  }
}

function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function createRateLimitMiddleware(options: { limit: number; windowMs: number; scope: string }): RequestHandler {
  const limiter = new FixedWindowRateLimiter(options.limit, options.windowMs);
  return (req, res, next) => {
    const result = limiter.consume(`${options.scope}:${clientKey(req)}`);
    res.set({
      "RateLimit-Limit": String(result.limit),
      "RateLimit-Remaining": String(result.remaining),
      "RateLimit-Reset": String(Math.ceil(result.resetAt / 1_000)),
    });
    if (!result.allowed) {
      res.set("Retry-After", String(result.retryAfterSeconds));
      return res.status(429).json({ error: "Too many requests. Retry after the indicated delay." });
    }
    next();
  };
}

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestSecurityMiddleware(req: Request, res: Response, next: NextFunction) {
  const suppliedRequestId = req.get("x-request-id");
  const requestId = suppliedRequestId && requestIdPattern.test(suppliedRequestId) ? suppliedRequestId : randomUUID();
  res.locals.requestId = requestId;
  res.set({
    "X-Request-Id": requestId,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Resource-Policy": "same-site",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Cache-Control": "no-store",
  });
  if (process.env.NODE_ENV === "production" && (req.secure || req.get("x-forwarded-proto") === "https")) {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

export function requestLogMiddleware(req: Request, res: Response, next: NextFunction) {
  const startedAt = process.hrtime.bigint();
  res.once("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.info(JSON.stringify({
      type: "http_request",
      requestId: res.locals.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
    }));
  });
  next();
}
