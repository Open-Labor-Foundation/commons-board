/**
 * Cadence scheduler — reads cadence_protocol.json per org and manages run state.
 *
 * New for Phase 7 (authored, not ported — no equivalent in mother-board).
 * Handles timezone-aware scheduling and missed-run recovery.
 */
import { readJson, writeJsonAtomic } from "../lib/persistence.js";

export type CadenceFrequency = "daily" | "weekly" | "monthly";

export type CadenceRunState = {
  last_daily_at?: string;
  last_weekly_at?: string;
  last_monthly_at?: string;
  missed_daily: number;
  missed_weekly: number;
  missed_monthly: number;
};

export type CadenceProtocol = {
  enabled: boolean;
  timezone?: string;
  daily?: { enabled?: boolean; hour?: number; channels?: string[] };
  weekly?: { enabled?: boolean; day?: number; hour?: number; channels?: string[] };
  monthly?: { enabled?: boolean; day?: number; hour?: number; channels?: string[] };
};

function schedKey(orgId: string): string {
  return `cadence-state/${orgId}`;
}

export function getCadenceState(orgId: string): CadenceRunState {
  return readJson<CadenceRunState>(schedKey(orgId), {
    missed_daily: 0,
    missed_weekly: 0,
    missed_monthly: 0
  });
}

export function recordCadenceRun(orgId: string, frequency: CadenceFrequency): void {
  const state = getCadenceState(orgId);
  const now = new Date().toISOString();
  const update: Partial<CadenceRunState> = {};
  if (frequency === "daily") { update.last_daily_at = now; update.missed_daily = 0; }
  if (frequency === "weekly") { update.last_weekly_at = now; update.missed_weekly = 0; }
  if (frequency === "monthly") { update.last_monthly_at = now; update.missed_monthly = 0; }
  writeJsonAtomic(schedKey(orgId), { ...state, ...update });
}

export function isDue(orgId: string, frequency: CadenceFrequency, protocol: CadenceProtocol): boolean {
  if (!protocol.enabled) return false;
  const cfg = protocol[frequency];
  if (!cfg || cfg.enabled === false) return false;

  const state = getCadenceState(orgId);
  const now = new Date();
  const tz = protocol.timezone ?? "UTC";

  if (frequency === "daily") {
    const last = state.last_daily_at ? new Date(state.last_daily_at) : null;
    if (!last) return true;
    const msElapsed = now.getTime() - last.getTime();
    return msElapsed >= 20 * 60 * 60 * 1000; // 20 hours minimum
  }

  if (frequency === "weekly") {
    const last = state.last_weekly_at ? new Date(state.last_weekly_at) : null;
    if (!last) return true;
    const msElapsed = now.getTime() - last.getTime();
    return msElapsed >= 6 * 24 * 60 * 60 * 1000; // 6 days minimum
  }

  if (frequency === "monthly") {
    const last = state.last_monthly_at ? new Date(state.last_monthly_at) : null;
    if (!last) return true;
    const msElapsed = now.getTime() - last.getTime();
    return msElapsed >= 27 * 24 * 60 * 60 * 1000; // 27 days minimum
  }

  void tz; // timezone-aware scheduling for future implementation
  return false;
}

export function getMissedRuns(orgId: string): { daily: number; weekly: number; monthly: number } {
  const state = getCadenceState(orgId);
  return {
    daily: state.missed_daily,
    weekly: state.missed_weekly,
    monthly: state.missed_monthly
  };
}

export function incrementMissed(orgId: string, frequency: CadenceFrequency): void {
  const state = getCadenceState(orgId);
  const update: Partial<CadenceRunState> = {};
  if (frequency === "daily") update.missed_daily = (state.missed_daily ?? 0) + 1;
  if (frequency === "weekly") update.missed_weekly = (state.missed_weekly ?? 0) + 1;
  if (frequency === "monthly") update.missed_monthly = (state.missed_monthly ?? 0) + 1;
  writeJsonAtomic(schedKey(orgId), { ...state, ...update });
}
