"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPost, relativeTime, humanize, statusColor } from "../../lib/api";

type DevTask = {
  task_id: string;
  title: string;
  type?: string;
  domain?: string;
  status: string;
  priority?: number;
  assigned_to?: string;
  notes?: string;
  created_at: string;
  updated_at?: string;
};

type DevloopState = {
  tasks?: DevTask[];
  total?: number;
  active?: number;
  completed?: number;
};

export default function DevloopPage() {
  const [state, setState] = useState<DevloopState | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("active");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", type: "feature", domain: "rnd", priority: "50", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const TASK_TYPES = ["feature", "bug", "refactor", "spike", "infra", "docs", "review"];
  const DOMAINS = ["ops", "it", "security", "hr", "rnd", "finance", "growth", "sales", "legal", "product", "strategy"];

  const load = useCallback(async () => {
    const data = await apiFetch<DevloopState>("/api/v1/devloop");
    setState(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createTask() {
    if (!form.title.trim()) return;
    setSubmitting(true);
    await apiPost("/api/v1/devloop", {
      title: form.title.trim(),
      type: form.type,
      domain: form.domain,
      priority: Number(form.priority),
      notes: form.notes.trim() || undefined,
    });
    setForm(f => ({ ...f, title: "", notes: "" }));
    setShowForm(false);
    setSubmitting(false);
    load();
  }

  const allTasks = state?.tasks ?? [];
  const visible = filter === "all" ? allTasks : filter === "active"
    ? allTasks.filter(t => !["completed", "done", "cancelled"].includes(t.status))
    : allTasks.filter(t => ["completed", "done"].includes(t.status));

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, flex: 1 }}>Dev Loop</h2>
        <button onClick={() => setShowForm(f => !f)} style={{ background: "var(--brand)", color: "#fff", padding: "7px 16px", fontSize: 13, fontWeight: 600 }}>+ Task</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {[
          { label: "Total", value: String(state?.total ?? allTasks.length) },
          { label: "Active", value: String(state?.active ?? allTasks.filter(t => !["completed", "done", "cancelled"].includes(t.status)).length) },
          { label: "Completed", value: String(state?.completed ?? allTasks.filter(t => ["completed", "done"].includes(t.status)).length) },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px" }}>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</p>
            <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{value}</p>
          </div>
        ))}
      </div>

      {showForm && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 2 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Title</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Task title" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={{ padding: "7px 10px", fontSize: 13 }}>
                {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Domain</label>
              <select value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} style={{ padding: "7px 10px", fontSize: 13 }}>
                {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div style={{ width: 70 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Priority</label>
              <input type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} min={0} max={100} style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
            </div>
          </div>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes (optional)" rows={2} style={{ resize: "vertical", padding: "8px 10px", fontSize: 13, width: "100%", boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={createTask} disabled={submitting || !form.title.trim()} style={{ background: "var(--brand)", color: "#fff", padding: "7px 18px", fontSize: 13, fontWeight: 600 }}>
              {submitting ? "Creating…" : "Create"}
            </button>
            <button onClick={() => setShowForm(false)} style={{ padding: "7px 14px", fontSize: 13 }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        {(["active", "all", "completed"] as const).map(t => (
          <button key={t} onClick={() => setFilter(t)} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: filter === t ? 600 : 400,
            color: filter === t ? "var(--brand)" : "var(--text-secondary)",
            background: "none", borderBottom: filter === t ? "2px solid var(--brand)" : "2px solid transparent", marginBottom: -1, textTransform: "capitalize",
          }}>
            {humanize(t)}
          </button>
        ))}
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        {visible.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "24px 16px", margin: 0 }}>No tasks.</p>
        ) : visible.map((t, i) => (
          <div key={t.task_id} style={{ borderBottom: i < visible.length - 1 ? "1px solid var(--border)" : "none" }}>
            <div onClick={() => setExpandedId(prev => prev === t.task_id ? null : t.task_id)} style={{ display: "flex", gap: 12, padding: "12px 16px", cursor: "pointer", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{t.title}</p>
                <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text-muted)", margin: "3px 0 0" }}>
                  {t.type && <span>{t.type}</span>}
                  {t.domain && <span>{t.domain}</span>}
                  {t.priority != null && <span>p{t.priority}</span>}
                  <span>{relativeTime(t.created_at)}</span>
                </div>
              </div>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: statusColor(t.status) + "18", color: statusColor(t.status), fontWeight: 600 }}>{t.status}</span>
            </div>
            {expandedId === t.task_id && t.notes && (
              <div style={{ padding: "0 16px 12px", fontSize: 12, color: "var(--text-secondary)" }}>
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>{t.notes}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
