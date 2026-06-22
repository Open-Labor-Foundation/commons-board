/** Security headers + basic rate limit + CORS. Ported from mother-board (AEB_->CB_). */
import type { Request, Response, NextFunction } from "express";

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; connect-src 'self' http: https:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none';"
  );
  next();
}

const requestCounter = new Map<string, { count: number; windowStart: number }>();

export function basicRateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const windowMs = Number(process.env.CB_RATE_LIMIT_WINDOW_MS ?? 60_000);
  const maxRequests = Number(process.env.CB_RATE_LIMIT_MAX ?? 600);
  const key = `${req.ip ?? "unknown"}:${req.path}`;
  const now = Date.now();
  const entry = requestCounter.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    requestCounter.set(key, { count: 1, windowStart: now });
    next();
    return;
  }
  if (entry.count >= maxRequests) {
    res.status(429).json({ error: "rate limit exceeded" });
    return;
  }
  entry.count += 1;
  next();
}

function allowedOrigins(): string[] {
  const raw = process.env.CB_CORS_ORIGINS;
  if (!raw || raw.trim() === "") {
    return ["http://localhost:3000", "http://127.0.0.1:3000"];
  }
  return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.header("origin");
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type,authorization,x-auth-token,x-user-id,x-user-role,x-workspace-id,x-correlation-id"
  );
  if (req.method === "OPTIONS") {
    res.status(204).send();
    return;
  }
  next();
}
