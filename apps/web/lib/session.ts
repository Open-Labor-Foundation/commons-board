/**
 * Session management — JWT-based sessions stored in httpOnly cookies.
 *
 * When CB_SESSION_SECRET is set, the web app requires login and uses
 * signed JWT sessions. When not set, falls back to env-var-based
 * identity (legacy/dev mode).
 *
 * The session JWT is separate from the API's auth — the web app
 * verifies the session and injects identity headers that the API
 * trusts via its existing auth configuration.
 */
import { SignJWT, jwtVerify } from "jose";

export type SessionClaims = {
  userId: string;
  workspaceId: string;
  role: string;
};

const COOKIE_NAME = "cb-session";
const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60; // 7 days

export function getSessionSecret(): Uint8Array | null {
  const secret = process.env.CB_SESSION_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

export function isSessionAuthEnabled(): boolean {
  return getSessionSecret() !== null;
}

export async function createSession(claims: SessionClaims): Promise<string> {
  const secret = getSessionSecret();
  if (!secret) throw new Error("CB_SESSION_SECRET is not configured");

  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(secret);
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  const secret = getSessionSecret();
  if (!secret) return null;

  try {
    const { payload } = await jwtVerify(token, secret);
    const userId = String(payload.userId ?? "");
    const workspaceId = String(payload.workspaceId ?? "");
    const role = String(payload.role ?? "");
    if (!userId || !workspaceId || !role) return null;
    return { userId, workspaceId, role };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = COOKIE_NAME;
export const SESSION_MAX_AGE = SESSION_DURATION_SECONDS;