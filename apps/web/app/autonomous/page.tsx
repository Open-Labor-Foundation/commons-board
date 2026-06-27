"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPost, relativeTime, humanize, statusColor } from "../../lib/api";

type CycleRun = {
  cycle_id: string;
  status: string;
  domains_run?: string[];
  actions_taken?: number;
  briefs_generated?: number;
  started_at: string;
  completed_at?: string;
};

type Experiment = {
  experiment_id: string;
  name: string;
  hypothesis?: string;
  status: string;
  variant?: string;
  domain?: string;
  started_at: string;
  concluded_at?: string;
  result?: string;
};

type Signal = {
  name: string;
  value: string | number;
  domain?: string;
  source?: string;
};

export default function AutonomousPage() {
  const [cycles, setCycles] = useState<CycleRun[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"cycles" | "experiments" | "signals">("cycles");
  const [running, setRunning] = useState(false);
  const [expForm, setExpForm] = useState({ name: "", hypothesis: "", domain: "ops", variant: "A/B" });
  const [signalForm, setSignalForm] = useState({ name: "", value: "", domain: "ops", source: "" });
  const [submitting, setSubmitting] = useState(false);
  const [signalSent, setSignalSent] = useState(false);

  const DOMAINS = ["ops", "it", "security", "hr", "rnd", "finance", "growth", "sales", "legal", "product", "strategy"];

  const load = useCallback(async () => {
    const [a, e] = await Promise.all([
      apiFetch<{ cycles: CycleRun[] }>("/api/v1/autonomous/cycles"),
      apiFetch<{ experiments: Experiment[] }>("/api/v1/autonomous/experiments"),
    ]);
    setCycles(a?.cycles ?? []);
    setExperiments(e?.experiments ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runCycle() {
    setRunning(true);
    await apiPost("/api/v1/autonomous/cycle/run", { trigger: "manual" });
    setRunning(false);
    load();
  }

  async function createExperiment() {
    if (!expForm.name.trim()) return;
    setSubmitting(true);
    await apiPost("/api/v1/autonomous/experiments", {
      name: expForm.name.trim(),
      hypothesis: expForm.hypothesis.trim() || undefined,
      domain: expForm.domain,
      variant: expForm.variant.trim() || undefined,
    });
    setExpForm(f => ({ ...f, name: "", hypothesis: "" }));
    setSubmitting(false);
    load();
  }

  async function sendSignal() {
    if (!signalForm.name.trim() || !signalForm.value.trim()) return;
    setSubmitting(true);
    await apiPost("/api/v1/autonomous/signals", {
      name: signalForm.name.trim(),
      value: signalForm.value.trim(),
      domain: signalForm.domain,
      source: signalForm.source.trim() || undefined,
    });
    setSignalForm(f => ({ ...f, name: "", value: "", source: "" }));
    setSubmitting(false);
    setSignalSent(true);
    setTimeout(() => setSignalSent(false), 3000);
  }

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, flex: 1 }}>Autonomous Evolution</h2>
        <button onClick={runCycle} disabled={running} style={{ background: "var(--brand)", color: "#fff", padding: "7px 16px", fontSize: 13, fontWeight: 600 }}>
          {running ? "Running cycle…" : "Run cycle"}
        </button>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        {(["cycles", "experiments", "signals"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: tab === t ? 600 : 400,
            color: tab === t ? "var(--brand)" : "var(--text-secondary)",
            background: "none", borderBottom: tab === t ? "2px solid var(--brand)" : "2px solid transparent", marginBottom: -1, textTransform: "capitalize",
          }}>
            {t === "cycles" ? `Evolution Cycles (${cycles.length})` : t === "experiments" ? `Experiments (${experiments.length})` : "Signals"}
          </button>
        ))}
      </div>

      {tab === "cycles" && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          {cycles.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "24px 16px", margin: 0 }}>
              No evolution cycles run yet. Click &quot;Run cycle&quot; to trigger the autonomous evolution engine.
            </p>
          ) : cycles.map((c, i) => (
            <div key={c.cycle_id} style={{ display: "flex", gap: 12, padding: "14px 16px", borderBottom: i < cycles.length - 1 ? "1px solid var(--border)" : "none", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 10, fontSize: 13, fontWeight: 500, margin: 0, alignItems: "center" }}>
                  <span>Cycle</span>
                  {c.domains_run && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.domains_run.join(", ")}</span>}
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-muted)", margin: "3px 0 0" }}>
                  <span>{relativeTime(c.started_at)}</span>
                  {c.actions_taken != null && <span>{c.actions_taken} actions</span>}
                  {c.briefs_generated != null && <span>{c.briefs_generated} briefs</span>}
                  {c.completed_at && <span>done {relativeTime(c.completed_at)}</span>}
                </div>
              </div>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: statusColor(c.status) + "18", color: statusColor(c.status), fontWeight: 600 }}>{c.status}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "experiments" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ fontWeight: 600, fontSize: 13, margin: 0 }}>Create Experiment</p>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 2 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Name</label>
                <input value={expForm.name} onChange={e => setExpForm(f => ({ ...f, name: e.target.value }))} placeholder="Experiment name" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Domain</label>
                <select value={expForm.domain} onChange={e => setExpForm(f => ({ ...f, domain: e.target.value }))} style={{ padding: "7px 10px", fontSize: 13 }}>
                  {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div style={{ width: 80 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Variant</label>
                <input value={expForm.variant} onChange={e => setExpForm(f => ({ ...f, variant: e.target.value }))} placeholder="A/B" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button onClick={createExperiment} disabled={submitting || !expForm.name.trim()} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>
                  Create
                </button>
              </div>
            </div>
            <textarea value={expForm.hypothesis} onChange={e => setExpForm(f => ({ ...f, hypothesis: e.target.value }))} placeholder="Hypothesis (optional)" rows={2} style={{ resize: "vertical", padding: "8px 10px", fontSize: 13, width: "100%", boxSizing: "border-box" }} />
          </div>

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
            {experiments.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "24px 16px", margin: 0 }}>No experiments yet.</p>
            ) : experiments.map((e, i) => (
              <div key={e.experiment_id} style={{ display: "flex", gap: 12, padding: "12px 16px", borderBottom: i < experiments.length - 1 ? "1px solid var(--border)" : "none", alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{e.name}</p>
                  {e.hypothesis && <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "3px 0 0" }}>{e.hypothesis}</p>}
                  <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text-muted)", margin: "3px 0 0" }}>
                    {e.domain && <span>{e.domain}</span>}
                    {e.variant && <span>variant: {e.variant}</span>}
                    <span>{relativeTime(e.started_at)}</span>
                    {e.result && <span>→ {e.result}</span>}
                  </div>
                </div>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: statusColor(e.status) + "18", color: statusColor(e.status), fontWeight: 600 }}>{humanize(e.status)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "signals" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ fontWeight: 600, fontSize: 13, margin: 0 }}>Inject Signal</p>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>External signals inform the autonomous evolution engine and influence the next cycle&apos;s direction.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ flex: 2, minWidth: 150 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Signal name</label>
                <input value={signalForm.name} onChange={e => setSignalForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. customer_churn_rate" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1, minWidth: 100 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Value</label>
                <input value={signalForm.value} onChange={e => setSignalForm(f => ({ ...f, value: e.target.value }))} placeholder="e.g. 12.5" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Domain</label>
                <select value={signalForm.domain} onChange={e => setSignalForm(f => ({ ...f, domain: e.target.value }))} style={{ padding: "7px 10px", fontSize: 13 }}>
                  {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 100 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Source (optional)</label>
                <input value={signalForm.source} onChange={e => setSignalForm(f => ({ ...f, source: e.target.value }))} placeholder="e.g. crm" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button onClick={sendSignal} disabled={submitting || !signalForm.name.trim() || !signalForm.value.trim()} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>
                  {submitting ? "Sending…" : "Inject"}
                </button>
              </div>
            </div>
            {signalSent && <p style={{ fontSize: 12, color: "#16a34a", margin: 0 }}>Signal injected successfully.</p>}
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
            Signal history is maintained in the decision log. View recent signals on the Governance page.
          </p>
        </div>
      )}
    </div>
  );
}
