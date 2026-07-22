import { NextRequest, NextResponse } from "next/server";
import { getSessionSecret, verifySession, SESSION_COOKIE, isSessionAuthEnabled } from "./lib/session";

export async function middleware(req: NextRequest) {
  const apiBase = process.env.INTERNAL_API_BASE_URL ?? "http://127.0.0.1:4000";
  const { pathname, search } = req.nextUrl;
  const target = new URL(pathname + search, apiBase);

  const headers = new Headers(req.headers);

  if (isSessionAuthEnabled()) {
    // Session-based auth: read identity from JWT cookie
    const cookie = req.cookies.get(SESSION_COOKIE)?.value;
    if (cookie) {
      const claims = await verifySession(cookie);
      if (claims) {
        headers.set("x-user-id", claims.userId);
        headers.set("x-workspace-id", claims.workspaceId);
        headers.set("x-user-role", claims.role);
      }
    }
    // If no valid session, the API will return 401 — the client-side
    // auth check will redirect to /login. We don't block here because
    // the middleware only runs on /api/v1/* paths, not page routes.
  } else {
    // Legacy env-var-based auth (dev/single-operator mode)
    headers.set("x-user-id", process.env.CB_USER_ID ?? "admin");
    headers.set("x-workspace-id", process.env.CB_WORKSPACE_ID ?? "default");
    headers.set("x-user-role", process.env.CB_USER_ROLE ?? "admin");
  }

  return NextResponse.rewrite(target, { request: { headers } });
}

export const config = {
  // Auth routes are handled by Next.js route handlers, not proxied to the API
  matcher: ["/api/v1/((?!auth/).*)", "/health"],
};
