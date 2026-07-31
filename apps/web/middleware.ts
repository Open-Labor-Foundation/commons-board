import { NextRequest, NextResponse } from "next/server";

// This is the only auth boundary in front of CB_INSECURE_HEADER_AUTH
// deployments -- the internal API trusts x-user-id/x-workspace-id/x-user-role
// with zero verification in that mode, so this proxy must never let a client
// set them itself. Previously this fell back to hardcoded "admin"/"default"
// values whenever CB_USER_ID/CB_WORKSPACE_ID/CB_USER_ROLE weren't all
// configured -- meaning an operator who forgot to set them (or never
// intended single-operator mode at all) silently granted every visitor full
// admin access with no login step, on any deployment reachable beyond
// localhost. Fail closed instead: only forward a trusted identity when all
// three are explicitly configured; otherwise strip them so the backend's
// requireContext (services/api/src/lib/auth.ts) rejects the request for
// missing auth context, same as it already does for a request with no
// identity headers at all.
export function middleware(req: NextRequest) {
  const apiBase = process.env.INTERNAL_API_BASE_URL ?? "http://127.0.0.1:4000";
  const { pathname, search } = req.nextUrl;
  const target = new URL(pathname + search, apiBase);

  const headers = new Headers(req.headers);
  headers.delete("x-user-id");
  headers.delete("x-workspace-id");
  headers.delete("x-user-role");

  const { CB_USER_ID, CB_WORKSPACE_ID, CB_USER_ROLE } = process.env;
  if (CB_USER_ID && CB_WORKSPACE_ID && CB_USER_ROLE) {
    headers.set("x-user-id", CB_USER_ID);
    headers.set("x-workspace-id", CB_WORKSPACE_ID);
    headers.set("x-user-role", CB_USER_ROLE);
  }

  return NextResponse.rewrite(target, { request: { headers } });
}

export const config = {
  matcher: ["/api/v1/:path*", "/health"],
};
