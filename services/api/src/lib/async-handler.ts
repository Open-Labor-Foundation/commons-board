/**
 * Express async handler wrapper.
 *
 * Express 4 does not catch rejected promises from async route handlers —
 * they bypass the error middleware and become unhandled rejections. This
 * wrapper forwards rejections to `next()` so the error middleware handles
 * them uniformly.
 *
 * Usage:
 *   router.post("/", asyncHandler(async (req, res) => { ... }));
 */
import type { NextFunction, Request, Response, RequestHandler } from "express";

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}