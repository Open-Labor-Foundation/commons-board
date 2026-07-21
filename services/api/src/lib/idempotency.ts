/**
 * Idempotency key middleware.
 *
 * Clients may send X-Idempotency-Key (a UUID) on any mutating request.
 * A second request with the same key returns 409 with the outcome of the
 * first request rather than processing again.
 *
 * Uses the persistent idempotency store (Postgres when DATABASE_URL is
 * set, file-backed JSON otherwise). This replaces the in-memory Map that
 * was process-lifetime only.
 */
import type { NextFunction, Request, Response } from "express";
import { tryRegisterIdempotency, completeIdempotency } from "./idempotency-store.js";

export function idempotencyGuard(req: Request, res: Response, next: NextFunction): void {
  const key = req.header("x-idempotency-key");
  if (!key || req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }

  // Derive workspace from request context if available
  const workspaceId = (req as unknown as { workspaceId?: string }).workspaceId;
  const scope = `${req.method}:${req.path}`;

  void (async () => {
    try {
      const { accepted, existing } = await tryRegisterIdempotency({
        workspaceId,
        scope,
        key
      });

      if (!accepted && existing) {
        // Return the original response
        res.status(existing.status);
        if (existing.response !== undefined) {
          res.json(existing.response);
        } else {
          res.json({ error: "duplicate request", idempotency_key: key, original: { status: existing.status } });
        }
        return;
      }

      // New key — proceed with the request, capture the response
      res.on("finish", () => {
        void completeIdempotency({
          workspaceId,
          scope,
          key,
          status: res.statusCode
        });
      });

      next();
    } catch {
      // If the store fails, proceed without idempotency (fail-open)
      next();
    }
  })();
}
