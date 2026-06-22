/**
 * Governance payload signing — HMAC-SHA256 with a rotatable keyring.
 *
 * Ported from mother-board lib/motherboard-signing.ts and sanitized:
 * MB_* env vars -> CB_*, motherboard defaults -> commons-board.
 *
 * Signing keys are deployment-specific and read from the environment. No usable
 * key is ever committed to this repo.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SignedPayload } from "@commons-board/shared";

type GovernanceKeyring = {
  activeKeyId: string;
  keys: Map<string, string>;
};

function parseKeyMapFromJson(raw: string): Map<string, string> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CB_GOVERNANCE_SIGNING_KEYS_JSON must be a JSON object");
  }

  const map = new Map<string, string>();
  for (const [keyId, keyValue] of Object.entries(parsed)) {
    const normalizedId = String(keyId).trim();
    const normalizedKey = String(keyValue ?? "").trim();
    if (!normalizedId || !normalizedKey) {
      throw new Error("CB_GOVERNANCE_SIGNING_KEYS_JSON must contain non-empty key ids and values");
    }
    map.set(normalizedId, normalizedKey);
  }

  if (map.size === 0) {
    throw new Error("CB_GOVERNANCE_SIGNING_KEYS_JSON must define at least one signing key");
  }
  return map;
}

function resolveGovernanceKeyring(): GovernanceKeyring {
  const keyMapEnv = process.env.CB_GOVERNANCE_SIGNING_KEYS_JSON;
  if (keyMapEnv && keyMapEnv.trim() !== "") {
    const keys = parseKeyMapFromJson(keyMapEnv);
    const firstKeyId = keys.keys().next().value as string;
    const activeKeyId = (process.env.CB_GOVERNANCE_ACTIVE_KEY_ID ?? "").trim() || firstKeyId;
    if (!activeKeyId || !keys.has(activeKeyId)) {
      throw new Error("CB_GOVERNANCE_ACTIVE_KEY_ID must reference a key id in CB_GOVERNANCE_SIGNING_KEYS_JSON");
    }
    return { activeKeyId, keys };
  }

  const singleKey = (process.env.CB_GOVERNANCE_SIGNING_KEY ?? "commons-board-dev-signing-key").trim();
  const singleKeyId = (process.env.CB_GOVERNANCE_SIGNING_KEY_ID ?? "cb-local-dev").trim();
  if (!singleKey || !singleKeyId) {
    throw new Error("CB_GOVERNANCE_SIGNING_KEY and CB_GOVERNANCE_SIGNING_KEY_ID must be non-empty");
  }

  return {
    activeKeyId: singleKeyId,
    keys: new Map([[singleKeyId, singleKey]])
  };
}

/** Fail fast in production / strict mode if a real signing key is not configured. */
export function validateGovernanceSigningConfig(): void {
  const keyMapEnv = process.env.CB_GOVERNANCE_SIGNING_KEYS_JSON;
  const isProduction = process.env.NODE_ENV === "production";
  const strict = process.env.CB_GOVERNANCE_STRICT_SIGNING === "true";
  const enforceSafeConfig = isProduction || strict;

  if (!enforceSafeConfig) {
    resolveGovernanceKeyring();
    return;
  }

  if (!keyMapEnv || keyMapEnv.trim() === "") {
    throw new Error(
      "CB_GOVERNANCE_SIGNING_KEYS_JSON is required when NODE_ENV=production or CB_GOVERNANCE_STRICT_SIGNING=true"
    );
  }

  const keyring = resolveGovernanceKeyring();
  const activeSecret = keyring.keys.get(keyring.activeKeyId) ?? "";
  const lowered = activeSecret.toLowerCase();
  if (
    activeSecret === "" ||
    activeSecret === "commons-board-dev-signing-key" ||
    lowered.includes("dev") ||
    lowered.includes("changeme") ||
    lowered.includes("replace")
  ) {
    throw new Error("invalid commons-board governance signing key configuration");
  }
}

function hmacSignature(payload: unknown, key: string): string {
  return createHmac("sha256", key).update(JSON.stringify(payload)).digest("hex");
}

export function signPayload<T>(payload: T): SignedPayload<T> {
  const keyring = resolveGovernanceKeyring();
  const key = keyring.keys.get(keyring.activeKeyId);
  if (!key) {
    throw new Error("active governance key id is not available in keyring");
  }

  return {
    key_id: keyring.activeKeyId,
    algorithm: "HMAC-SHA256",
    payload,
    signature: hmacSignature(payload, key)
  };
}

export function verifySignedPayload<T>(signed: SignedPayload<T>): boolean {
  if (!signed?.payload || !signed?.signature || !signed?.key_id) {
    return false;
  }

  const keyring = resolveGovernanceKeyring();
  const key = keyring.keys.get(String(signed.key_id));
  if (!key) {
    return false;
  }

  const expected = hmacSignature(signed.payload, key);
  const provided = String(signed.signature);
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  if (expectedBytes.length !== providedBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, providedBytes);
}
