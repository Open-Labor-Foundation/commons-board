/**
 * Device/controller credential issuance and verification -- this repo's
 * first "register a thing, get back credentials" flow. Existing patterns
 * (webhooks.ts, federation.ts) only ever reference an env-var *name*
 * holding a secret; olf-subscription.ts's generateHandoffToken HMAC-signs
 * using an already-configured key rather than minting one. A site
 * controller has no key to start with, so this mints one.
 *
 * v0 scope, deliberately narrow: this only issues and verifies a per-device
 * bearer credential scoped to one workspace. It does not change
 * docker-compose.yml's localhost-only binding -- exposing a controller
 * off-host is a separate, undecided infrastructure choice (see the v0 plan's
 * Step 5 notes), not something a credential mechanism should silently
 * enable on its own.
 */
import { randomBytes, createHash } from "node:crypto";
import { readJson, writeJsonAtomic } from "./persistence.js";

const DEVICES_KEY = "devices/registry";

export interface DeviceRecord {
  device_id: string;
  workspace_id: string;
  device_name: string;
  secret_hash: string;
  registered_at: string;
}

export type PublicDeviceRecord = Omit<DeviceRecord, "secret_hash">;

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function loadDevices(): DeviceRecord[] {
  return readJson<DeviceRecord[]>(DEVICES_KEY, []);
}

export interface RegisterDeviceResult {
  device_id: string;
  /** Raw secret -- returned once here, never persisted in plaintext, never retrievable again. */
  secret: string;
}

/** Registers a new device for a workspace, returning its id and one-time raw secret. */
export function registerDevice(workspaceId: string, deviceName: string): RegisterDeviceResult {
  const device_id = randomBytes(16).toString("hex");
  const secret = randomBytes(32).toString("hex");
  const record: DeviceRecord = {
    device_id,
    workspace_id: workspaceId,
    device_name: deviceName,
    secret_hash: hashSecret(secret),
    registered_at: new Date().toISOString(),
  };
  const devices = loadDevices();
  devices.push(record);
  writeJsonAtomic(DEVICES_KEY, devices);
  return { device_id, secret };
}

/** Verifies a device bearer token against the registry. Returns the matching record, or null. */
export function verifyDeviceToken(token: string): DeviceRecord | null {
  if (!token) return null;
  const hash = hashSecret(token);
  return loadDevices().find((d) => d.secret_hash === hash) ?? null;
}

/** Lists a workspace's registered devices without ever exposing a secret hash. */
export function listDevices(workspaceId: string): PublicDeviceRecord[] {
  return loadDevices()
    .filter((d) => d.workspace_id === workspaceId)
    .map(({ secret_hash: _secret_hash, ...rest }) => rest);
}

export function revokeDevice(workspaceId: string, deviceId: string): boolean {
  const devices = loadDevices();
  const next = devices.filter((d) => !(d.workspace_id === workspaceId && d.device_id === deviceId));
  if (next.length === devices.length) return false;
  writeJsonAtomic(DEVICES_KEY, next);
  return true;
}
