/**
 * Idempotency key middleware.
 *
 * Clients may send X-Idempotency-Key (a UUID) on any mutating request.
 * A second request with the same key returns 409 with the outcome of the
 * first request rather than processing again. Keys are scoped to the
 * process lifetime (in-memory map); persistent idempotency store is a
 * future phase.
 */
import type { NextFunction, Request, Response } from "express";

type IdempotencyEntry = { processed_at: string; status: number };
const store = new Map<string, IdempotencyEntry>();

export function idempotencyGuard(req: Request, res: Response, next: NextFunction): void {
  const key = req.header("x-idempotency-key");
  if (!key || req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }

  const existing = store.get(key);
  if (existing) {
    res.status(409).json({ error: "duplicate request", idempotency_key: key, original: existing });
    return;
  }

  const entry: IdempotencyEntry = { processed_at: new Date().toISOString(), status: 202 };
  store.set(key, entry);

  res.on("finish", () => {
    store.set(key, { ...entry, status: res.statusCode });
  });

  next();
}
