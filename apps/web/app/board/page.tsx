"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPost, relativeTime, humanize } from "../../lib/api";

type BoardBrief = {
  brief_id: string;
  brief_type: string;
  domain?: string;
  title?: string;
  content?: string;
  generated_at: string;
};

type BoardState = {
  briefs?: BoardBrief[];
  latest_brief?: BoardBrief;
  board_status?: string;
  active_domains?: string[];
  next_cadence?: string;
};

type SimResult = {
  scenario: string;
  outcome?: string;
  projected_metrics?: Record<string, string | number>;
  recommendations?: string[];
  run_at: string;
};

export default function BoardPage() {
  const [board, setBoard] = useState<BoardState | null>(null);
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"briefs" | "sim">("briefs");
  const [simForm, setSimForm] = useState({ scenario: "", domain: "ops", horizon: "30" });
  const [simulating, setSimulating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const DOMAINS = ["ops", "it", "security", "hr", "rnd", "finance", "growth", "sales", "legal", "product", "strategy"];

  const load = useCallback(async () => {
    const data = await apiFetch<BoardState>("/api/v1/board");
    setBoard(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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

  const briefs = board?.briefs ?? [];
  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 1000 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Board</h2>

      {board && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px" }}>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Board status</p>
            <p style={{ fontSize: 16, fontWeight: 700, margin: 0, color: board.board_status === "active" ? "#16a34a" : "var(--text-primary)" }}>{board.board_status ?? "—"}</p>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px" }}>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Active domains</p>
            <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{board.active_domains?.join(", ") ?? "—"}</p>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px" }}>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Next cadence</p>
            <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{board.next_cadence ? relativeTime(board.next_cadence) : "—"}</p>
          </div>
        </div>
      )}

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        {(["briefs", "sim"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: tab === t ? 600 : 400,
            color: tab === t ? "var(--brand)" : "var(--text-secondary)",
            background: "none", borderBottom: tab === t ? "2px solid var(--brand)" : "2px solid transparent", marginBottom: -1,
          }}>
            {t === "briefs" ? `Board Briefs (${briefs.length})` : "Simulation"}
          </button>
        ))}
      </div>

      {tab === "briefs" && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          {briefs.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "24px 16px", margin: 0 }}>No board briefs generated yet. Run a cadence cycle to generate briefs.</p>
          ) : briefs.map((b, i) => (
            <div key={b.brief_id} style={{ borderBottom: i < briefs.length - 1 ? "1px solid var(--border)" : "none" }}>
              <div onClick={() => setExpandedId(prev => prev === b.brief_id ? null : b.brief_id)} style={{ display: "flex", gap: 12, padding: "14px 16px", cursor: "pointer", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{b.title ?? humanize(b.brief_type)}</p>
                  <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text-muted)", margin: "3px 0 0" }}>
                    <span>{humanize(b.brief_type)}</span>
                    {b.domain && <span>{b.domain}</span>}
                    <span>{relativeTime(b.generated_at)}</span>
                  </div>
                </div>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{expandedId === b.brief_id ? "▲" : "▼"}</span>
              </div>
              {expandedId === b.brief_id && b.content && (
                <div style={{ padding: "0 16px 16px" }}>
                  <div style={{ background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "14px", fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--text-secondary)" }}>
                    {b.content}
                  </div>
                </div>
              )}
            </div>
          ))}
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
