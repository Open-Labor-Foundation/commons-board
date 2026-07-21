import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE, isSessionAuthEnabled } from "../../../../../lib/session";

export async function GET(req: NextRequest) {
  if (!isSessionAuthEnabled()) {
    // Legacy mode — identity comes from env vars
    return NextResponse.json({
      authenticated: true,
      legacy: true,
      userId: process.env.CB_USER_ID ?? "admin",
      workspaceId: process.env.CB_WORKSPACE_ID ?? "default",
      role: process.env.CB_USER_ROLE ?? "admin",
    });
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const claims = await verifySession(cookie);
  if (!claims) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    userId: claims.userId,
    workspaceId: claims.workspaceId,
    role: claims.role,
  });
}