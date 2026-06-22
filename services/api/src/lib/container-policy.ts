/**
 * Container policy — network mode and adapter enable/disable controls.
 *
 * Ported from mother-board lib/container-policy.ts.
 * Sanitized:
 *   - AEB_ADAPTERS_DEFAULT_ENABLED → CB_ADAPTERS_DEFAULT_ENABLED
 *   - BOARD_NETWORK_MODE, BOARD_OUTBOUND_ALLOWLIST, ENABLE_*_ADAPTER unchanged
 *
 * CB_ADAPTERS_DEFAULT_ENABLED: baseline enabled state for all adapters (default false).
 * ENABLE_EMAIL_ADAPTER / ENABLE_PUBLISH_ADAPTER / ENABLE_DEPLOY_ADAPTER: per-adapter overrides.
 * BOARD_NETWORK_MODE: "offline" | "controlled" | "restricted" (default "controlled").
 * BOARD_OUTBOUND_ALLOWLIST: comma-separated adapter names allowed in restricted mode.
 */

export type BoardNetworkMode = "offline" | "controlled" | "restricted";

const ALLOWED_MODES = new Set<BoardNetworkMode>(["offline", "controlled", "restricted"]);

export function boardNetworkMode(): BoardNetworkMode {
  const raw = (process.env.BOARD_NETWORK_MODE ?? "controlled").toLowerCase();
  return ALLOWED_MODES.has(raw as BoardNetworkMode) ? (raw as BoardNetworkMode) : "controlled";
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

export function adapterEnabled(adapter: "email" | "publish" | "deploy"): boolean {
  const defaultValue = parseBool(process.env.CB_ADAPTERS_DEFAULT_ENABLED, false);
  if (adapter === "email") return parseBool(process.env.ENABLE_EMAIL_ADAPTER, defaultValue);
  if (adapter === "publish") return parseBool(process.env.ENABLE_PUBLISH_ADAPTER, defaultValue);
  return parseBool(process.env.ENABLE_DEPLOY_ADAPTER, defaultValue);
}

export function externalWriteAllowed(adapter: "email" | "publish" | "deploy"): { ok: boolean; reason?: string } {
  const mode = boardNetworkMode();
  if (mode === "offline") {
    return { ok: false, reason: "network mode offline blocks external writes" };
  }
  if (mode === "restricted") {
    const allowlist = (process.env.BOARD_OUTBOUND_ALLOWLIST ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);
    if (!allowlist.includes(adapter)) {
      return { ok: false, reason: `adapter ${adapter} not allowlisted in restricted mode` };
    }
  }
  if (!adapterEnabled(adapter)) {
    return { ok: false, reason: `adapter ${adapter} disabled by configuration` };
  }
  return { ok: true };
}
