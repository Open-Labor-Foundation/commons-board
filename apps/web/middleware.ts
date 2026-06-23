import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const apiBase = process.env.INTERNAL_API_BASE_URL ?? "http://127.0.0.1:4000";
  const { pathname, search } = req.nextUrl;
  const target = new URL(pathname + search, apiBase);
  return NextResponse.rewrite(target);
}

export const config = {
  matcher: ["/api/v1/:path*", "/health"],
};
