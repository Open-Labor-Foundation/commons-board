"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPost, relativeTime, humanize, statusColor } from "../../lib/api";

type ExecutionRun = {
  run_id: string;
  title?: string;
  action_type?: string;
  domain?: string;
  status: string;
  result?: string;
  error?: string;
  started_at: string;
  completed_at?: string;
};

type ExecutionState = {
  active_runs?: number;
  total_runs?: number;
  recent_runs?: ExecutionRun[];
};

export default function ExecutionPage() {
  const [state, setState] = useState<ExecutionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", action_type: "task", domain: "ops", payload: "" });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const DOMAINS = ["ops", "it", "security", "hr", "rnd", "finance", "growth", "sales", "legal", "product", "strategy"];
  const ACTION_TYPES = ["task", "workflow", "batch", "scheduled", "triggered"];

  const load = useCallback(async () => {
    const data = await apiFetch<ExecutionState>("/api/v1/execution");
    setState(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function executeRun() {
    if (!form.title.trim()) return;
    setRunning(true);
    setError("");
    let payload: Record<string, unknown> | undefined;
    if (form.payload.trim()) {
      try { payload = JSON.parse(form.payload); } catch { setError("Payload must be valid JSON."); setRunning(false); return; }
    }
    const { status } = await apiPost("/api/v1/execution/run", {
      title: form.title.trim(),
      action_type: form.action_type,
      domain: form.domain,
      payload,
    });
    setRunning(false);
    if (status >= 400) { setError("Execution failed to start."); return; }
    setForm(f => ({ ...f, title: "", payload: "" }));
    load();
  }

  const runs = state?.recent_runs ?? [];
  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Execution Runtime</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        {[
          { label: "Active runs", value: String(state?.active_runs ?? 0) },
          { label: "Total runs", value: String(state?.total_runs ?? 0) },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px" }}>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</p>
            <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{value}</p>
          </div>
        ))}
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>Run Execution</div>
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 2 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Title</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Generate weekly finance report" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Type</label>
              <select value={form.action_type} onChange={e => setForm(f => ({ ...f, action_type: e.target.value }))} style={{ padding: "7px 10px", fontSize: 13 }}>
                {ACTION_TYPES.map(t => <option key={t} value={t}>{humanize(t)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Domain</label>
              <select value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} style={{ padding: "7px 10px", fontSize: 13 }}>
                {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Payload (JSON, optional)</label>
            <textarea value={form.payload} onChange={e => setForm(f => ({ ...f, payload: e.target.value }))} placeholder='{"key": "value"}' rows={3} style={{ width: "100%", resize: "vertical", padding: "8px 10px", fontSize: 12, fontFamily: "monospace", boxSizing: "border-box" }} />
          </div>
          {error && <p style={{ fontSize: 12, color: "var(--error)", margin: 0 }}>{error}</p>}
          <div>
            <button onClick={executeRun} disabled={running || !form.title.trim()} style={{ background: "var(--brand)", color: "#fff", padding: "8px 18px", fontSize: 13, fontWeight: 600 }}>
              {running ? "Dispatching…" : "Execute"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>Recent Runs</div>
        {runs.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "24px 16px", margin: 0 }}>No execution runs yet.</p>
        ) : runs.map((r, i) => (
          <div key={r.run_id} style={{ borderBottom: i < runs.length - 1 ? "1px solid var(--border)" : "none" }}>
            <div onClick={() => setExpandedId(prev => prev === r.run_id ? null : r.run_id)} style={{ display: "flex", gap: 12, padding: "12px 16px", cursor: "pointer", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{r.title ?? humanize(r.action_type ?? "run")}</p>
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "3px 0 0" }}>
                  {r.domain && <>{r.domain} · </>}{relativeTime(r.started_at)}{r.completed_at ? ` → ${relativeTime(r.completed_at)}` : ""}
                </p>
              </div>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: statusColor(r.status) + "18", color: statusColor(r.status), fontWeight: 600 }}>{r.status}</span>
            </div>
            {expandedId === r.run_id && (
              <div style={{ padding: "0 16px 12px" }}>
                <div style={{ background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px 14px", fontSize: 12, fontFamily: "monospace" }}>
                  <p style={{ margin: 0 }}>run_id: {r.run_id}</p>
                  {r.result && <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>result: {r.result}</p>}
                  {r.error && <p style={{ margin: "4px 0 0", color: "var(--error)" }}>error: {r.error}</p>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
