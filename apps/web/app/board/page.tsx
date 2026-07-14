"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPost, apiPatch, relativeTime, humanize } from "../../lib/api";

type BoardRequest = {
  id: string;
  title: string;
  request: string;
  requested_by: string;
  target_domain: string;
  status: string;
  priority: string;
  risk_level: string;
  approval_required: boolean;
  created_at: string;
  updated_at: string;
  auto_dispatch_to_commons_crew?: boolean;
};

type CadenceBrief = {
  generated_at: string;
  daily?: { headline?: string; text?: string; next_best_action?: string };
  weekly?: { tldr?: string; objective_status?: { trend?: string }; decisions_needed?: string[] };
};

type SimResult = {
  scenario: string;
  outcome?: string;
  projected_metrics?: Record<string, string | number>;
  recommendations?: string[];
  run_at: string;
};

export default function BoardPage() {
  const [requests, setRequests] = useState<BoardRequest[]>([]);
  const [brief, setBrief] = useState<CadenceBrief | null>(null);
  const [total, setTotal] = useState(0);
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"requests" | "brief" | "sim">("requests");
  const [simForm, setSimForm] = useState({ scenario: "", domain: "ops", horizon: "30" });
  const [simulating, setSimulating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const DOMAINS = ["ops", "it", "security", "hr", "rnd", "finance", "growth", "sales", "legal", "product", "strategy"];

  const load = useCallback(async () => {
    const [r, b] = await Promise.all([
      apiFetch<{ requests: BoardRequest[]; total: number }>("/api/v1/board/requests"),
      apiFetch<CadenceBrief>("/api/v1/cadence/brief"),
    ]);
    setRequests(r?.requests ?? []);
    setTotal(r?.total ?? 0);
    setBrief(b ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function transitionRequest(id: string, status: string) {
    setActing(id + ":" + status);
    await apiPatch(`/api/v1/board/requests/${id}`, { status });
    setActing(null);
    load();
  }

  async function setAutoDispatch(id: string, value: boolean) {
    setActing(id + ":auto-dispatch");
    await apiPatch(`/api/v1/board/requests/${id}`, { auto_dispatch_to_commons_crew: value });
    setActing(null);
    load();
  }

  async function runSimulation() {
    if (!simForm.scenario.trim()) return;
    setSimulating(true);
    const { data } = await apiPost<SimResult>("/api/v1/sim", {
      scenario: simForm.scenario.trim(),
      domain: simForm.domain,
      horizon_days: Number(simForm.horizon),
    });
    setSimulating(false);
    if (data) setSimResult(data);
  }

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 1000 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Board Requests</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px" }}>
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Open requests</p>
          <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{requests.filter(r => !["completed", "rejected"].includes(r.status)).length}</p>
        </div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px" }}>
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Total requests</p>
          <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{total}</p>
        </div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px" }}>
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Latest brief</p>
          <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{brief ? relativeTime(brief.generated_at) : "—"}</p>
        </div>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        {(["requests", "brief", "sim"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: tab === t ? 600 : 400,
            color: tab === t ? "var(--brand)" : "var(--text-secondary)",
            background: "none", borderBottom: tab === t ? "2px solid var(--brand)" : "2px solid transparent", marginBottom: -1,
          }}>
            {t === "requests" ? `Board Requests (${requests.length})` : t === "brief" ? "Latest Brief" : "Simulation"}
          </button>
        ))}
      </div>

      {tab === "requests" && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          {requests.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "24px 16px", margin: 0 }}>No board requests yet. Submit a request via the Board chat to route work to a chair.</p>
          ) : requests.map((r, i) => (
            <div key={r.id} style={{ borderBottom: i < requests.length - 1 ? "1px solid var(--border)" : "none" }}>
              <div onClick={() => setExpandedId(prev => prev === r.id ? null : r.id)} style={{ display: "flex", gap: 12, padding: "14px 16px", cursor: "pointer", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{r.title}</p>
                  <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text-muted)", margin: "3px 0 0" }}>
                    <span>{r.target_domain}</span>
                    <span>{r.priority}</span>
                    <span>{r.risk_level} risk</span>
                    <span>{relativeTime(r.created_at)}</span>
                  </div>
                </div>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "var(--surface-overlay)", fontWeight: 600 }}>{r.status}</span>
              </div>
              {expandedId === r.id && (
                <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "14px", fontSize: 13, lineHeight: 1.7, color: "var(--text-secondary)" }}>
                    {r.request}
                  </div>
                  {["submitted", "triaged", "planned"].includes(r.status) && (
                    <label onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)", cursor: acting !== null ? "default" : "pointer" }}>
                      <input
                        type="checkbox"
                        checked={r.auto_dispatch_to_commons_crew ?? false}
                        disabled={acting !== null}
                        onChange={e => setAutoDispatch(r.id, e.target.checked)}
                      />
                      Auto-propose commons-crew dispatch when approved
                    </label>
                  )}
                  {!["completed", "rejected"].includes(r.status) && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
                      {["submitted", "triaged", "planned"].includes(r.status) && (
                        <button
                          onClick={() => transitionRequest(r.id, "approved")}
                          disabled={acting !== null}
                          style={{ background: "#16a34a", color: "#fff", padding: "6px 16px", fontSize: 12, fontWeight: 700, borderRadius: "var(--radius)", border: "none", cursor: "pointer", opacity: acting !== null ? 0.6 : 1 }}
                        >
                          {acting === r.id + ":approved" ? "Approving…" : "Approve"}
                        </button>
                      )}
                      {r.status === "approved" && (
                        <button
                          onClick={() => transitionRequest(r.id, "executing")}
                          disabled={acting !== null}
                          style={{ background: "#2563eb", color: "#fff", padding: "6px 16px", fontSize: 12, fontWeight: 700, borderRadius: "var(--radius)", border: "none", cursor: "pointer", opacity: acting !== null ? 0.6 : 1 }}
                        >
                          {acting === r.id + ":executing" ? "Starting…" : "Begin Execution"}
                        </button>
                      )}
                      {r.status === "executing" && (
                        <button
                          onClick={() => transitionRequest(r.id, "completed")}
                          disabled={acting !== null}
                          style={{ background: "#16a34a", color: "#fff", padding: "6px 16px", fontSize: 12, fontWeight: 700, borderRadius: "var(--radius)", border: "none", cursor: "pointer", opacity: acting !== null ? 0.6 : 1 }}
                        >
                          {acting === r.id + ":completed" ? "Completing…" : "Mark Complete"}
                        </button>
                      )}
                      {r.status === "blocked" && (
                        <button
                          onClick={() => transitionRequest(r.id, "approved")}
                          disabled={acting !== null}
                          style={{ background: "#2563eb", color: "#fff", padding: "6px 16px", fontSize: 12, fontWeight: 700, borderRadius: "var(--radius)", border: "none", cursor: "pointer", opacity: acting !== null ? 0.6 : 1 }}
                        >
                          {acting === r.id + ":approved" ? "Resuming…" : "Resume"}
                        </button>
                      )}
                      <button
                        onClick={() => transitionRequest(r.id, "rejected")}
                        disabled={acting !== null}
                        style={{ background: "none", color: "#dc2626", padding: "6px 16px", fontSize: 12, fontWeight: 600, borderRadius: "var(--radius)", border: "1px solid #dc2626", cursor: "pointer", opacity: acting !== null ? 0.6 : 1 }}
                      >
                        {acting === r.id + ":rejected" ? "Rejecting…" : "Reject"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "brief" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {!brief ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>No brief generated yet. Run a cadence cycle via Schedule to generate the first brief.</p>
          ) : (
            <>
              {brief.daily && (
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px" }}>
                  <p style={{ fontWeight: 600, fontSize: 13, margin: "0 0 8px" }}>Daily Pulse — {relativeTime(brief.generated_at)}</p>
                  {brief.daily.headline && <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 6px" }}>{brief.daily.headline}</p>}
                  {brief.daily.text && <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 8px", lineHeight: 1.6 }}>{brief.daily.text}</p>}
                  {brief.daily.next_best_action && (
                    <div style={{ background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px 14px", fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>Next best action: </span>{brief.daily.next_best_action}
                    </div>
                  )}
                </div>
              )}
              {brief.weekly && (
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px" }}>
                  <p style={{ fontWeight: 600, fontSize: 13, margin: "0 0 8px" }}>Weekly Brief</p>
                  {brief.weekly.tldr && <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 8px", lineHeight: 1.6 }}>{brief.weekly.tldr}</p>}
                  {brief.weekly.decisions_needed && brief.weekly.decisions_needed.length > 0 && (
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", margin: "0 0 6px", textTransform: "uppercase" }}>Decisions needed</p>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {brief.weekly.decisions_needed.map((d, i) => <li key={i} style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>{d}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "sim" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px" }}>
            <p style={{ fontWeight: 600, fontSize: 13, margin: "0 0 12px" }}>Run Simulation</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <textarea value={simForm.scenario} onChange={e => setSimForm(f => ({ ...f, scenario: e.target.value }))} placeholder="Describe the scenario to simulate, e.g. 'What if we expand into a new market over 30 days?'" rows={3} style={{ resize: "vertical", padding: "9px 12px", fontSize: 13, width: "100%", boxSizing: "border-box" }} />
              <div style={{ display: "flex", gap: 8 }}>
                <select value={simForm.domain} onChange={e => setSimForm(f => ({ ...f, domain: e.target.value }))} style={{ padding: "7px 10px", fontSize: 13 }}>
                  {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="number" value={simForm.horizon} onChange={e => setSimForm(f => ({ ...f, horizon: e.target.value }))} min={1} max={365} style={{ width: 70, padding: "7px 10px", fontSize: 13 }} />
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>days</span>
                </div>
                <button onClick={runSimulation} disabled={simulating || !simForm.scenario.trim()} style={{ background: "var(--brand)", color: "#fff", padding: "7px 18px", fontSize: 13, fontWeight: 600 }}>
                  {simulating ? "Simulating…" : "Simulate"}
                </button>
              </div>
            </div>
          </div>

          {simResult && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <p style={{ fontWeight: 600, fontSize: 13, margin: 0 }}>{simResult.scenario}</p>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{relativeTime(simResult.run_at)}</span>
              </div>
              {simResult.outcome && <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 12px" }}>{simResult.outcome}</p>}
              {simResult.projected_metrics && Object.keys(simResult.projected_metrics).length > 0 && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                  {Object.entries(simResult.projected_metrics).map(([k, v]) => (
                    <div key={k} style={{ background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "8px 12px" }}>
                      <p style={{ fontSize: 10, color: "var(--text-muted)", margin: 0, textTransform: "uppercase" }}>{humanize(k)}</p>
                      <p style={{ fontSize: 14, fontWeight: 700, margin: "2px 0 0" }}>{String(v)}</p>
                    </div>
                  ))}
                </div>
              )}
              {simResult.recommendations && simResult.recommendations.length > 0 && (
                <div>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", margin: "0 0 6px", textTransform: "uppercase" }}>Recommendations</p>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {simResult.recommendations.map((r, i) => <li key={i} style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
