"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPost, apiPut, relativeTime, humanize } from "../../lib/api";

type CadenceState = {
  last_run_at?: string;
  next_run_at?: string;
  run_count?: number;
  status?: string;
  brief_count?: number;
};

type BriefRun = {
  run_id: string;
  status: string;
  brief_type?: string;
  domain?: string;
  started_at: string;
  completed_at?: string;
};

type BriefTemplate = {
  template_id: string;
  name: string;
  brief_type: string;
  domain?: string;
  schedule?: string;
  enabled: boolean;
};

export default function CadencePage() {
  const [state, setState] = useState<CadenceState | null>(null);
  const [runs, setRuns] = useState<BriefRun[]>([]);
  const [templates, setTemplates] = useState<BriefTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "templates">("overview");
  const [running, setRunning] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: "", brief_type: "executive", domain: "ops", schedule: "0 9 * * 1", enabled: true });
  const [addingTemplate, setAddingTemplate] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    const [c, t] = await Promise.all([
      apiFetch<{ cadence: CadenceState; runs?: BriefRun[] }>("/api/v1/cadence"),
      apiFetch<{ templates: BriefTemplate[] }>("/api/v1/brief-templates"),
    ]);
    setState(c?.cadence ?? null);
    setRuns(c?.runs ?? []);
    setTemplates(t?.templates ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runCadence() {
    setRunning(true);
    await apiPost("/api/v1/cadence/run", { trigger: "manual" });
    setRunning(false);
    load();
  }

  async function addTemplate() {
    if (!templateForm.name.trim()) return;
    setAddingTemplate(true);
    await apiPost("/api/v1/brief-templates", {
      name: templateForm.name.trim(),
      brief_type: templateForm.brief_type,
      domain: templateForm.domain,
      schedule: templateForm.schedule.trim() || undefined,
      enabled: templateForm.enabled,
    });
    setTemplateForm({ name: "", brief_type: "executive", domain: "ops", schedule: "0 9 * * 1", enabled: true });
    setShowForm(false);
    setAddingTemplate(false);
    load();
  }

  async function toggleTemplate(id: string, enabled: boolean) {
    await apiPut(`/api/v1/brief-templates/${id}`, { enabled: !enabled });
    load();
  }

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  const DOMAINS = ["ops", "it", "security", "hr", "rnd", "finance", "growth", "sales", "legal", "product", "strategy"];
  const BRIEF_TYPES = ["executive", "domain", "collective", "tactical", "strategic"];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, flex: 1 }}>Briefing Schedule</h2>
        <button onClick={runCadence} disabled={running} style={{ background: "var(--brand)", color: "#fff", padding: "7px 16px", fontSize: 13, fontWeight: 600 }}>
          {running ? "Running…" : "Run now"}
        </button>
      </div>

      {state && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[
            { label: "Last run", value: state.last_run_at ? relativeTime(state.last_run_at) : "Never" },
            { label: "Next run", value: state.next_run_at ? relativeTime(state.next_run_at) : "—" },
            { label: "Total runs", value: String(state.run_count ?? 0) },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px" }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</p>
              <p style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{value}</p>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        {(["overview", "templates"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: tab === t ? 600 : 400,
            color: tab === t ? "var(--brand)" : "var(--text-secondary)",
            background: "none", borderBottom: tab === t ? "2px solid var(--brand)" : "2px solid transparent", marginBottom: -1, textTransform: "capitalize",
          }}>
            {t === "overview" ? `Recent Runs (${runs.length})` : `Templates (${templates.length})`}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
          {runs.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "24px 16px", margin: 0 }}>No runs yet. Click "Run now" to trigger the cadence.</p>
          ) : runs.map((r, i) => (
            <div key={r.run_id} style={{ display: "flex", gap: 12, padding: "12px 16px", borderBottom: i < runs.length - 1 ? "1px solid var(--border)" : "none", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{r.brief_type ? humanize(r.brief_type) : "Cadence run"}{r.domain ? ` · ${r.domain}` : ""}</p>
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "3px 0 0" }}>Started {relativeTime(r.started_at)}{r.completed_at ? ` · completed ${relativeTime(r.completed_at)}` : ""}</p>
              </div>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: r.status === "completed" ? "#16a34a18" : r.status === "failed" ? "#dc262618" : "#d9770618", color: r.status === "completed" ? "#16a34a" : r.status === "failed" ? "#dc2626" : "#d97706", fontWeight: 600 }}>{r.status}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "templates" && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Brief Templates</span>
            <button onClick={() => setShowForm(f => !f)} style={{ fontSize: 12, padding: "4px 12px", background: "var(--brand)", color: "#fff", fontWeight: 600 }}>+ Add</button>
          </div>
          {showForm && (
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, flexWrap: "wrap", background: "var(--surface-overlay)" }}>
              <input value={templateForm.name} onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))} placeholder="Template name" style={{ flex: 2, minWidth: 160, padding: "7px 10px", fontSize: 13 }} />
              <select value={templateForm.brief_type} onChange={e => setTemplateForm(f => ({ ...f, brief_type: e.target.value }))} style={{ padding: "7px 10px", fontSize: 13 }}>
                {BRIEF_TYPES.map(t => <option key={t} value={t}>{humanize(t)}</option>)}
              </select>
              <select value={templateForm.domain} onChange={e => setTemplateForm(f => ({ ...f, domain: e.target.value }))} style={{ padding: "7px 10px", fontSize: 13 }}>
                {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input value={templateForm.schedule} onChange={e => setTemplateForm(f => ({ ...f, schedule: e.target.value }))} placeholder="Cron (optional)" style={{ width: 130, padding: "7px 10px", fontSize: 13 }} />
              <button onClick={addTemplate} disabled={addingTemplate || !templateForm.name.trim()} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>Save</button>
            </div>
          )}
          {templates.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "24px 16px", margin: 0 }}>No brief templates configured.</p>
          ) : templates.map((t, i) => (
            <div key={t.template_id} style={{ display: "flex", gap: 12, padding: "12px 16px", borderBottom: i < templates.length - 1 ? "1px solid var(--border)" : "none", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{t.name}</p>
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "3px 0 0" }}>{humanize(t.brief_type)} · {t.domain}{t.schedule ? ` · ${t.schedule}` : ""}</p>
              </div>
              <button onClick={() => toggleTemplate(t.template_id, t.enabled)} style={{ fontSize: 11, padding: "3px 10px", background: t.enabled ? "#16a34a18" : "var(--surface-overlay)", color: t.enabled ? "#16a34a" : "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 4, fontWeight: 600 }}>
                {t.enabled ? "Enabled" : "Disabled"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
