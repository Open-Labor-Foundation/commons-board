"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPost, apiPut, humanize, statusColor, relativeTime } from "../../lib/api";

type L4Action = { action_id: string; title?: string; description?: string; action_type: string; status: string; created_at: string; assigned_to?: string };
type L4Dashboard = { status: string; provisioning_complete: boolean; actions_pending: number; outreach_active: boolean; crm_pipeline_count: number };
type OutreachConfig = { enabled: boolean; channels?: string[]; message_template?: string; auto_followup?: boolean; delay_days?: number };
type CRMEntry = { id: string; name: string; stage: string; value?: number; contact?: string; last_activity?: string };

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
        {action}
      </div>
      <div style={{ padding: "12px 16px" }}>{children}</div>
    </div>
  );
}

function StatusBadge({ label }: { label: string }) {
  const color = statusColor(label);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 500, background: color + "18", color }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}

const STAGES = ["prospect", "qualified", "proposal", "negotiation", "closed_won", "closed_lost"];

export default function Level4Page() {
  const [dashboard, setDashboard] = useState<L4Dashboard | null>(null);
  const [actions, setActions] = useState<L4Action[]>([]);
  const [outreach, setOutreach] = useState<OutreachConfig | null>(null);
  const [pipeline, setPipeline] = useState<CRMEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"actions" | "outreach" | "crm">("actions");

  const [actionForm, setActionForm] = useState({ title: "", description: "", action_type: "outreach" });
  const [crmForm, setCrmForm] = useState({ name: "", stage: "prospect", value: "", contact: "" });
  const [outreachForm, setOutreachForm] = useState({ enabled: false, message_template: "", auto_followup: false, delay_days: "3" });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const [d, a, o, p] = await Promise.all([
      apiFetch<L4Dashboard>("/api/v1/level4/dashboard"),
      apiFetch<{ actions: L4Action[] }>("/api/v1/level4/actions"),
      apiFetch<OutreachConfig>("/api/v1/level4/outreach/config"),
      apiFetch<{ pipeline: CRMEntry[] }>("/api/v1/level4/crm/pipeline"),
    ]);
    if (d) setDashboard(d);
    setActions(a?.actions ?? []);
    if (o) { setOutreach(o); setOutreachForm({ enabled: o.enabled, message_template: o.message_template ?? "", auto_followup: o.auto_followup ?? false, delay_days: String(o.delay_days ?? 3) }); }
    setPipeline(p?.pipeline ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createAction() {
    if (!actionForm.title.trim()) return;
    setSubmitting(true);
    await apiPost("/api/v1/level4/actions", { ...actionForm, title: actionForm.title.trim(), description: actionForm.description.trim() || undefined });
    setActionForm(f => ({ ...f, title: "", description: "" }));
    setSubmitting(false);
    load();
  }

  async function saveOutreach() {
    setSubmitting(true);
    await apiPut("/api/v1/level4/outreach/config", { ...outreachForm, delay_days: Number(outreachForm.delay_days) });
    setSubmitting(false);
    load();
  }

  async function addCRMEntry() {
    if (!crmForm.name.trim()) return;
    setSubmitting(true);
    await apiPost("/api/v1/level4/crm/pipeline", { name: crmForm.name.trim(), stage: crmForm.stage, value: crmForm.value ? Number(crmForm.value) : undefined, contact: crmForm.contact || undefined });
    setCrmForm({ name: "", stage: "prospect", value: "", contact: "" });
    setSubmitting(false);
    load();
  }

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 960 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Level 4 — Autonomous Outreach</h2>
        {dashboard && (
          <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Status: <strong>{dashboard.status}</strong></span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Provisioning: <strong>{dashboard.provisioning_complete ? "complete" : "pending"}</strong></span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Pending actions: <strong>{dashboard.actions_pending}</strong></span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Outreach: <strong>{dashboard.outreach_active ? "active" : "inactive"}</strong></span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Pipeline: <strong>{dashboard.crm_pipeline_count}</strong></span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        {(["actions", "outreach", "crm"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: tab === t ? 600 : 400,
            color: tab === t ? "var(--brand)" : "var(--text-secondary)",
            background: "none", borderBottom: tab === t ? "2px solid var(--brand)" : "2px solid transparent", marginBottom: -1, textTransform: "capitalize",
          }}>
            {t === "actions" ? `Actions (${actions.length})` : t === "crm" ? `CRM Pipeline (${pipeline.length})` : "Outreach Config"}
          </button>
        ))}
      </div>

      {tab === "actions" && (
        <Card title="Actions">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ padding: "12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 2 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Title</label>
                  <input value={actionForm.title} onChange={e => setActionForm(f => ({ ...f, title: e.target.value }))} placeholder="Action title" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Type</label>
                  <select value={actionForm.action_type} onChange={e => setActionForm(f => ({ ...f, action_type: e.target.value }))} style={{ width: "100%", padding: "7px 10px", fontSize: 13 }}>
                    {["outreach", "research", "proposal", "follow_up", "schedule", "report"].map(t => <option key={t} value={t}>{humanize(t)}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button onClick={createAction} disabled={submitting || !actionForm.title.trim()} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>
                    {submitting ? "Adding…" : "Add"}
                  </button>
                </div>
              </div>
              <textarea value={actionForm.description} onChange={e => setActionForm(f => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" rows={2} style={{ resize: "vertical", padding: "8px 10px", fontSize: 13, width: "100%", boxSizing: "border-box" }} />
            </div>
            {actions.length === 0 ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No actions yet.</p> : (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 80px 100px", gap: 8, padding: "5px 0", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)" }}>
                  <span>Action</span><span>Type</span><span>Status</span><span style={{ textAlign: "right" }}>Created</span>
                </div>
                {actions.map(a => (
                  <div key={a.action_id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 80px 100px", gap: 8, padding: "10px 0", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{a.title ?? a.action_id}</p>
                      {a.description && <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.description}</p>}
                    </div>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{humanize(a.action_type)}</span>
                    <StatusBadge label={a.status} />
                    <span style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right" }}>{relativeTime(a.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {tab === "outreach" && (
        <Card title="Outreach configuration">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <input type="checkbox" checked={outreachForm.enabled} onChange={e => setOutreachForm(f => ({ ...f, enabled: e.target.checked }))} />
              <span>Outreach enabled</span>
            </label>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Message template</label>
              <textarea value={outreachForm.message_template} onChange={e => setOutreachForm(f => ({ ...f, message_template: e.target.value }))} rows={4} placeholder="Template for outreach messages…" style={{ resize: "vertical", padding: "8px 10px", fontSize: 13, width: "100%", boxSizing: "border-box" }} />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <input type="checkbox" checked={outreachForm.auto_followup} onChange={e => setOutreachForm(f => ({ ...f, auto_followup: e.target.checked }))} />
              <span>Auto follow-up</span>
            </label>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Follow-up delay (days)</label>
                <input type="number" value={outreachForm.delay_days} onChange={e => setOutreachForm(f => ({ ...f, delay_days: e.target.value }))} style={{ width: 80, padding: "7px 10px", fontSize: 13 }} />
              </div>
              <button onClick={saveOutreach} disabled={submitting} style={{ background: "var(--brand)", color: "#fff", padding: "8px 16px", fontSize: 13, fontWeight: 600 }}>
                {submitting ? "Saving…" : "Save config"}
              </button>
            </div>
          </div>
        </Card>
      )}

      {tab === "crm" && (
        <Card title="CRM Pipeline">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ padding: "12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div style={{ flex: 2 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Name</label>
                <input value={crmForm.name} onChange={e => setCrmForm(f => ({ ...f, name: e.target.value }))} placeholder="Lead or company name" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Stage</label>
                <select value={crmForm.stage} onChange={e => setCrmForm(f => ({ ...f, stage: e.target.value }))} style={{ width: "100%", padding: "7px 10px", fontSize: 13 }}>
                  {STAGES.map(s => <option key={s} value={s}>{humanize(s)}</option>)}
                </select>
              </div>
              <div style={{ width: 90 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Value ($)</label>
                <input type="number" value={crmForm.value} onChange={e => setCrmForm(f => ({ ...f, value: e.target.value }))} placeholder="0" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Contact</label>
                <input value={crmForm.contact} onChange={e => setCrmForm(f => ({ ...f, contact: e.target.value }))} placeholder="email / name" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <button onClick={addCRMEntry} disabled={submitting || !crmForm.name.trim()} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                {submitting ? "Adding…" : "Add"}
              </button>
            </div>
            {pipeline.length === 0 ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No pipeline entries yet.</p> : (
              <div>
                {STAGES.filter(s => pipeline.some(e => e.stage === s)).map(stage => (
                  <div key={stage} style={{ marginBottom: 16 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 6px" }}>{humanize(stage)}</p>
                    {pipeline.filter(e => e.stage === stage).map(entry => (
                      <div key={entry.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "9px 12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)", marginBottom: 6 }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{entry.name}</p>
                          {entry.contact && <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0" }}>{entry.contact}</p>}
                        </div>
                        {entry.value != null && <span style={{ fontSize: 13, fontWeight: 700 }}>${entry.value.toLocaleString()}</span>}
                        {entry.last_activity && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{relativeTime(entry.last_activity)}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
