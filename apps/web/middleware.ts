import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const apiBase = process.env.INTERNAL_API_BASE_URL ?? "http://127.0.0.1:4000";
  const { pathname, search } = req.nextUrl;
  const target = new URL(pathname + search, apiBase);

  const headers = new Headers(req.headers);
  headers.set("x-user-id", process.env.CB_USER_ID ?? "admin");
  headers.set("x-workspace-id", process.env.CB_WORKSPACE_ID ?? "default");
  headers.set("x-user-role", process.env.CB_USER_ROLE ?? "admin");

  return NextResponse.rewrite(target, { request: { headers } });
}

export const config = {
  matcher: ["/api/v1/:path*", "/health"],
};
