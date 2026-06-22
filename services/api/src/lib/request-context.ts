/**
 * Correlation IDs for request tracing. Minimal carry from mother-board;
 * the fuller security middleware (auth, cors, http-security, redaction) is
 * delivered by lanes against this gateway.
 */
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

export function correlationId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-correlation-id");
  const id = incoming && incoming.trim() !== "" ? incoming : randomUUID();
  req.correlationId = id;
  res.setHeader("x-correlation-id", id);
  next();
}
