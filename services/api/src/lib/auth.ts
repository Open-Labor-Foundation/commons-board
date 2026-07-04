/**
 * Auth + RBAC. Ported from mother-board lib/auth.ts and sanitized (AEB_->CB_).
 * Roles unified with the shared `Role` type. Full collective membership
 * resolution (DB-backed) is wired in the collective-governance phase; Phase 1
 * uses header/JWT context.
 */
import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Role } from "@commons-board/shared";

export type RequestContext = {
  userId: string;
  workspaceId: string;
  role: Role;
};

const ROLE_SET = new Set<Role>(["admin", "operator", "member", "observer"]);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx?: RequestContext;
    }
  }
}

export function requireContext(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    const apiToken = process.env.CB_API_TOKEN;
    const jwtConfigured = !!(process.env.CB_JWT_SECRET || process.env.CB_OIDC_JWKS_URL);
    // Trusts client-supplied x-user-id/x-workspace-id/x-user-role headers with no
    // verification. Only safe for a single-operator, network-isolated deployment
    // (e.g. localhost-only). Must never be set on a shared or public-facing instance.
    const insecureHeaderAuth = process.env.CB_INSECURE_HEADER_AUTH === "true";

    if (!apiToken && !jwtConfigured && !insecureHeaderAuth) {
      res.status(500).json({
        error: "server misconfigured: no authentication method configured",
        hint:
          "set CB_API_TOKEN and/or CB_JWT_SECRET / CB_OIDC_JWKS_URL. " +
          "CB_INSECURE_HEADER_AUTH=true trusts client-supplied identity headers unverified " +
          "— single-operator/dev use only, never on a shared or public deployment."
      });
      return;
    }

    if (apiToken) {
      const authHeader = req.header("authorization");
      const tokenFromBearer =
        authHeader && authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : undefined;
      const token = req.header("x-auth-token") ?? tokenFromBearer;
      if (!token || token !== apiToken) {
        res.status(401).json({ error: "invalid API token" });
        return;
      }
    }

    const authHeader = req.header("authorization");
    const bearer =
      authHeader && authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : undefined;

    let userId = req.header("x-user-id") ?? "";
    let workspaceId = req.header("x-workspace-id") ?? "";
    let role = req.header("x-user-role") ?? "";

    if (jwtConfigured) {
      if (!bearer) {
        res.status(401).json({ error: "bearer token required" });
        return;
      }
      const claims = await verifyJwtClaims(bearer);
      if (!claims) {
        res.status(401).json({ error: "invalid bearer token" });
        return;
      }
      userId = claims.userId;
      workspaceId = claims.workspaceId;
      role = claims.role;
    } else if (!insecureHeaderAuth) {
      // apiToken-only mode: the shared secret authenticated the caller above, but
      // identity/role still need a verified source. Without JWT or the explicit
      // insecure opt-in, refuse rather than trust unverified headers.
      res.status(401).json({
        error: "no verified identity source configured",
        hint: "set CB_JWT_SECRET / CB_OIDC_JWKS_URL, or CB_INSECURE_HEADER_AUTH=true to trust identity headers"
      });
      return;
    }

    if (!userId || !workspaceId || !role || !ROLE_SET.has(role as Role)) {
      res.status(401).json({
        error: "missing or invalid auth context",
        requiredHeaders: ["x-user-id", "x-workspace-id", "x-user-role"]
      });
      return;
    }

    req.ctx = { userId, workspaceId, role: role as Role };

    // Cross-tenant guard: if caller explicitly names a target workspace, it must match.
    const targetWorkspaceId = req.header("x-target-workspace-id");
    if (targetWorkspaceId && targetWorkspaceId !== workspaceId) {
      res.status(403).json({ error: "cross-tenant access denied", target: targetWorkspaceId, context: workspaceId });
      return;
    }

    next();
  })().catch((error) => {
    res.status(401).json({ error: error instanceof Error ? error.message : "auth failure" });
  });
}

export function requireRole(allowed: Role[]) {
  const allowedSet = new Set(allowed);
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.ctx?.role;
    if (!role || !allowedSet.has(role)) {
      res.status(403).json({ error: "insufficient permissions", allowed });
      return;
    }
    next();
  };
}

let remoteJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

async function verifyJwtClaims(
  token: string
): Promise<{ userId: string; workspaceId: string; role: Role } | null> {
  const jwksUrl = process.env.CB_OIDC_JWKS_URL;
  const issuer = process.env.CB_OIDC_ISSUER;
  const audience = process.env.CB_OIDC_AUDIENCE;
  const sharedSecret = process.env.CB_JWT_SECRET;

  try {
    if (jwksUrl) {
      if (!remoteJwks) remoteJwks = createRemoteJWKSet(new URL(jwksUrl));
      const verified = await jwtVerify(token, remoteJwks, {
        issuer: issuer || undefined,
        audience: audience || undefined
      });
      return claimsToContext(verified.payload);
    }
    if (sharedSecret) {
      const verified = await jwtVerify(token, new TextEncoder().encode(sharedSecret), {
        issuer: issuer || undefined,
        audience: audience || undefined
      });
      return claimsToContext(verified.payload);
    }
  } catch {
    return null;
  }
  return null;
}

function claimsToContext(
  payload: Record<string, unknown>
): { userId: string; workspaceId: string; role: Role } | null {
  const userId = String(payload["sub"] ?? payload["user_id"] ?? "");
  const workspaceId = String(payload["workspace_id"] ?? payload["workspaceId"] ?? "");
  const candidate = String(payload["role"] ?? payload["workspace_role"] ?? "").toLowerCase();
  const role = ROLE_SET.has(candidate as Role) ? (candidate as Role) : "";
  if (!userId || !workspaceId || !role) return null;
  return { userId, workspaceId, role: role as Role };
}
