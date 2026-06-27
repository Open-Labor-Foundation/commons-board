"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, relativeTime, humanize, statusColor } from "../../lib/api";

type BiHealth = {
  overall_score?: number;
  trend?: "up" | "down" | "flat";
  domain_scores?: Record<string, number>;
  capability_count?: number;
  dashboard_count?: number;
  domain_count?: number;
};

type ObsRuns = {
  runs?: Array<{ run_id: string; status: string; initiated_at: string; action_count: number }>;
  total?: number;
};

type ObsCadence = {
  last_daily_at?: string;
  last_weekly_at?: string;
  last_monthly_at?: string;
};

type OrgEvent = {
  event_id: string;
  type: string;
  domain?: string;
  summary: string;
  actor?: string;
  created_at: string;
};

export default function BiPage() {
  const [bi, setBi] = useState<BiHealth | null>(null);
  const [obsRuns, setObsRuns] = useState<ObsRuns | null>(null);
  const [obsCadence, setObsCadence] = useState<ObsCadence | null>(null);
  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"bi" | "obs" | "events">("bi");

  const load = useCallback(async () => {
    const [b, r, c, e] = await Promise.all([
      apiFetch<BiHealth>("/api/v1/bi/health"),
      apiFetch<ObsRuns>("/api/v1/obs/execution-runs"),
      apiFetch<ObsCadence>("/api/v1/obs/last-cadence"),
      apiFetch<{ events: OrgEvent[] }>("/api/v1/events"),
    ]);
    setBi(b);
    setObsRuns(r);
    setObsCadence(c);
    setEvents(e?.events ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  function Stat({ label, value, unit, trend }: { label: string; value?: number | string | null; unit?: string; trend?: "up" | "down" | "flat" }) {
    const display = value == null ? "—" : unit === "%" ? `${Number(value).toFixed(1)}%` : unit === "ms" ? `${value}ms` : unit === "$" ? `$${Number(value).toLocaleString()}` : String(value);
    const trendColor = trend === "up" ? "#16a34a" : trend === "down" ? "#dc2626" : "#64748b";
    return (
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px" }}>
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</p>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{display}</p>
          {trend && <span style={{ fontSize: 12, color: trendColor }}>{trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}</span>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 1000 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Insights</h2>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        {(["bi", "obs", "events"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: tab === t ? 600 : 400,
            color: tab === t ? "var(--brand)" : "var(--text-secondary)",
            background: "none", borderBottom: tab === t ? "2px solid var(--brand)" : "2px solid transparent", marginBottom: -1,
          }}>
            {t === "bi" ? "Business Intelligence" : t === "obs" ? "Observability" : `Events (${events.length})`}
          </button>
        ))}
      </div>

      {tab === "bi" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <Stat label="Org health score" value={bi?.overall_score} trend={bi?.trend} />
            <Stat label="Capabilities" value={bi?.capability_count} />
            <Stat label="Domains tracked" value={bi?.domain_count} />
          </div>
          {bi?.domain_scores && Object.keys(bi.domain_scores).length > 0 && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>Domain Scores</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0 }}>
                {Object.entries(bi.domain_scores).map(([domain, score], i, arr) => (
                  <div key={domain} style={{ padding: "12px 16px", borderRight: (i + 1) % 3 !== 0 ? "1px solid var(--border)" : "none", borderBottom: i < arr.length - 3 ? "1px solid var(--border)" : "none" }}>
                    <Stat label={humanize(domain)} value={score} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {!bi && <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>No BI health data yet. Run a cadence cycle to generate domain scores.</p>}
        </div>
      )}

      {tab === "obs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <Stat label="Total runs" value={obsRuns?.total ?? 0} />
            <Stat label="Last daily cadence" value={obsCadence?.last_daily_at ? relativeTime(obsCadence.last_daily_at) : "—"} />
            <Stat label="Last weekly cadence" value={obsCadence?.last_weekly_at ? relativeTime(obsCadence.last_weekly_at) : "—"} />
          </div>
          {obsRuns?.runs && obsRuns.runs.length > 0 && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>Recent Execution Runs</div>
              {obsRuns.runs.slice(0, 10).map((r, i, arr) => (
                <div key={r.run_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span style={{ fontSize: 13 }}>{relativeTime(r.initiated_at)} · {r.action_count} actions</span>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: statusColor(r.status) + "18", color: statusColor(r.status), fontWeight: 600 }}>{r.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "events" && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          {events.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "24px 16px", margin: 0 }}>No events recorded.</p>
          ) : events.map((e, i) => (
            <div key={e.event_id} style={{ display: "flex", gap: 12, padding: "12px 16px", borderBottom: i < events.length - 1 ? "1px solid var(--border)" : "none", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{e.summary}</p>
                <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text-muted)", margin: "3px 0 0" }}>
                  <span>{humanize(e.type)}</span>
                  {e.domain && <span>{e.domain}</span>}
                  {e.actor && <span>by {e.actor}</span>}
                  <span>{relativeTime(e.created_at)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
