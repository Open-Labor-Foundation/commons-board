import { NextRequest, NextResponse } from "next/server";
import { createSession, isSessionAuthEnabled, SESSION_COOKIE, SESSION_MAX_AGE } from "../../../../../lib/session";

/**
 * Login endpoint — validates credentials and sets a session cookie.
 *
 * When CB_SESSION_SECRET is set, this is the real auth path.
 * Credentials are validated against CB_AUTH_USERS env var, which is a
 * JSON array of { user_id, password_hash, workspace_id, role }.
 *
 * Password hashing uses Web Crypto SubtleCrypto (PBKDF2).
 * When CB_AUTH_USERS is not set, falls back to a single admin user
 * with CB_AUTH_DEFAULT_PASSWORD (for initial setup).
 */

type AuthUser = {
  user_id: string;
  password_hash: string;
  password_salt: string;
  workspace_id: string;
  role: string;
};

function parseAuthUsers(): AuthUser[] {
  const raw = process.env.CB_AUTH_USERS;
  if (!raw) return [];
  try {
    return JSON.parse(raw) as AuthUser[];
  } catch {
    return [];
  }
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return Buffer.from(new Uint8Array(bits)).toString("hex");
}

export async function POST(req: NextRequest) {
  if (!isSessionAuthEnabled()) {
    return NextResponse.json(
      { error: "Session auth is not configured. Set CB_SESSION_SECRET to enable login." },
      { status: 503 }
    );
  }

  let body: { user_id?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userId = body.user_id?.trim();
  const password = body.password;
  if (!userId || !password) {
    return NextResponse.json({ error: "user_id and password are required" }, { status: 400 });
  }

  const users = parseAuthUsers();

  // Fallback: single admin user for initial setup
  if (users.length === 0) {
    const defaultPassword = process.env.CB_AUTH_DEFAULT_PASSWORD;
    const defaultWorkspace = process.env.CB_WORKSPACE_ID ?? "default";
    if (defaultPassword && password === defaultPassword) {
      const token = await createSession({
        userId,
        workspaceId: defaultWorkspace,
        role: "admin",
      });
      const res = NextResponse.json({ ok: true });
      res.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: SESSION_MAX_AGE,
        path: "/",
      });
      return res;
    }
    return NextResponse.json(
      { error: "No users configured. Set CB_AUTH_USERS or CB_AUTH_DEFAULT_PASSWORD." },
      { status: 401 }
    );
  }

  // Find user and verify password
  const user = users.find((u) => u.user_id === userId);
  if (!user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const computedHash = await hashPassword(password, user.password_salt);
  if (computedHash !== user.password_hash) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await createSession({
    userId: user.user_id,
    workspaceId: user.workspace_id,
    role: user.role,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return res;
}