"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, relativeTime, humanize, statusColor } from "../../lib/api";

type BiData = {
  revenue?: number;
  mrr?: number;
  customers?: number;
  churn_rate?: number;
  metrics?: Array<{ name: string; value: number | string; unit?: string; trend?: "up" | "down" | "flat" }>;
};

type ObsData = {
  api_latency_p50?: number;
  api_latency_p99?: number;
  error_rate?: number;
  uptime?: number;
  active_agents?: number;
  health?: Record<string, string>;
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
  const [bi, setBi] = useState<BiData | null>(null);
  const [obs, setObs] = useState<ObsData | null>(null);
  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"bi" | "obs" | "events">("bi");

  const load = useCallback(async () => {
    const [b, o, e] = await Promise.all([
      apiFetch<BiData>("/api/v1/bi"),
      apiFetch<ObsData>("/api/v1/obs"),
      apiFetch<{ events: OrgEvent[] }>("/api/v1/events"),
    ]);
    setBi(b);
    setObs(o);
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
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>BI &amp; Observability</h2>

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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <Stat label="MRR" value={bi?.mrr} unit="$" />
            <Stat label="ARR" value={bi?.mrr != null ? bi.mrr * 12 : undefined} unit="$" />
            <Stat label="Customers" value={bi?.customers} />
            <Stat label="Churn rate" value={bi?.churn_rate} unit="%" trend="down" />
          </div>
          {bi?.metrics && bi.metrics.length > 0 && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>Metrics</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0 }}>
                {bi.metrics.map((m, i) => (
                  <div key={m.name} style={{ padding: "12px 16px", borderRight: (i + 1) % 3 !== 0 ? "1px solid var(--border)" : "none", borderBottom: i < bi.metrics!.length - 3 ? "1px solid var(--border)" : "none" }}>
                    <Stat label={humanize(m.name)} value={m.value} unit={m.unit} trend={m.trend} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "obs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
            <Stat label="P50 latency" value={obs?.api_latency_p50} unit="ms" />
            <Stat label="P99 latency" value={obs?.api_latency_p99} unit="ms" />
            <Stat label="Error rate" value={obs?.error_rate} unit="%" trend="down" />
            <Stat label="Uptime" value={obs?.uptime} unit="%" trend="up" />
            <Stat label="Active agents" value={obs?.active_agents} />
          </div>
          {obs?.health && Object.keys(obs.health).length > 0 && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>Component Health</div>
              {Object.entries(obs.health).map(([name, status], i, arr) => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span style={{ fontSize: 13 }}>{humanize(name)}</span>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: statusColor(status) + "18", color: statusColor(status), fontWeight: 600 }}>{status}</span>
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
