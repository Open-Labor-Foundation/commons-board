"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPost, formatCurrency, relativeTime } from "../../lib/api";

type Balance = { totalIncome: number; totalDistributed: number; totalContributions: number; reserveBalance: number; availableForDistribution: number; currency: string; lastDistributionAt: string | null };
type IncomeRecord = { id: string; amount: number; currency: string; description: string; source: string; period: string; createdAt: string };
type Distribution = { id: string; amount: number; currency: string; description: string; status: string; createdAt: string; executedAt?: string };
type Contribution = { id: string; contributor: string; amount: number; currency: string; description: string; createdAt: string };

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

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px 20px" }}>
      <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: "4px 0 0" }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "3px 0 0" }}>{sub}</p>}
    </div>
  );
}

export default function TreasuryPage() {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [income, setIncome] = useState<IncomeRecord[]>([]);
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [loading, setLoading] = useState(true);

  const [incomeForm, setIncomeForm] = useState({ amount: "", description: "", source: "direct" });
  const [distForm, setDistForm] = useState({ amount: "", description: "", recipient: "" });
  const [contribForm, setContribForm] = useState({ contributor: "", amount: "", description: "" });
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [tab, setTab] = useState<"income" | "distributions" | "contributions">("income");

  const load = useCallback(async () => {
    const [b, i, d, c] = await Promise.all([
      apiFetch<Balance>("/api/v1/treasury/balance"),
      apiFetch<{ records: IncomeRecord[] }>("/api/v1/treasury/income"),
      apiFetch<{ distributions: Distribution[] }>("/api/v1/treasury/distributions"),
      apiFetch<{ contributions: Contribution[] }>("/api/v1/treasury/contributions"),
    ]);
    if (b) setBalance(b);
    setIncome(i?.records ?? []);
    setDistributions(d?.distributions ?? []);
    setContributions(c?.contributions ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function recordIncome() {
    if (!incomeForm.amount || !incomeForm.description) return;
    setSubmitting("income");
    await apiPost("/api/v1/treasury/income", { amount: Number(incomeForm.amount), description: incomeForm.description, source: incomeForm.source, currency: balance?.currency ?? "USD" });
    setIncomeForm({ amount: "", description: "", source: "direct" });
    setSubmitting(null);
    load();
  }

  async function createDistribution() {
    if (!distForm.amount || !distForm.description) return;
    setSubmitting("dist");
    await apiPost("/api/v1/treasury/distributions", { amount: Number(distForm.amount), description: distForm.description, recipient: distForm.recipient, currency: balance?.currency ?? "USD" });
    setDistForm({ amount: "", description: "", recipient: "" });
    setSubmitting(null);
    load();
  }

  async function executeDistribution(id: string) {
    await apiFetch(`/api/v1/treasury/distributions/${id}/execute`, { method: "POST" });
    load();
  }

  async function recordContribution() {
    if (!contribForm.contributor || !contribForm.amount) return;
    setSubmitting("contrib");
    await apiPost("/api/v1/treasury/contributions", { contributor: contribForm.contributor, amount: Number(contribForm.amount), description: contribForm.description, currency: balance?.currency ?? "USD" });
    setContribForm({ contributor: "", amount: "", description: "" });
    setSubmitting(null);
    load();
  }

  const cur = balance?.currency ?? "USD";

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 960 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Finances</h2>

      {/* Balance overview */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
        <StatBox label="Total income" value={formatCurrency(balance?.totalIncome ?? 0, cur)} />
        <StatBox label="Available" value={formatCurrency(balance?.availableForDistribution ?? 0, cur)} />
        <StatBox label="Distributed" value={formatCurrency(balance?.totalDistributed ?? 0, cur)} />
        <StatBox label="Contributions" value={formatCurrency(balance?.totalContributions ?? 0, cur)} />
        <StatBox label="Reserve" value={formatCurrency(balance?.reserveBalance ?? 0, cur)} sub={balance?.lastDistributionAt ? `Last dist. ${relativeTime(balance.lastDistributionAt)}` : undefined} />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", gap: 0 }}>
        {(["income", "distributions", "contributions"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: tab === t ? 600 : 400,
            color: tab === t ? "var(--brand)" : "var(--text-secondary)",
            background: "none", borderBottom: tab === t ? "2px solid var(--brand)" : "2px solid transparent",
            marginBottom: -1, textTransform: "capitalize",
          }}>
            {t === "distributions" ? `Distributions (${distributions.length})` : t === "income" ? `Income (${income.length})` : `Contributions (${contributions.length})`}
          </button>
        ))}
      </div>

      {tab === "income" && (
        <Card title="Income records" action={<span style={{ fontSize: 11, color: "var(--text-muted)" }}>{income.length} records</span>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Add income form */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
              <div style={{ flex: 2 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Description</label>
                <input value={incomeForm.description} onChange={e => setIncomeForm(f => ({ ...f, description: e.target.value }))} placeholder="Membership dues, grant, service fee…" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Amount ({cur})</label>
                <input type="number" value={incomeForm.amount} onChange={e => setIncomeForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Source</label>
                <select value={incomeForm.source} onChange={e => setIncomeForm(f => ({ ...f, source: e.target.value }))} style={{ width: "100%", padding: "7px 10px", fontSize: 13 }}>
                  <option value="direct">Direct</option>
                  <option value="grant">Grant</option>
                  <option value="service">Service fee</option>
                  <option value="membership">Membership</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <button onClick={recordIncome} disabled={submitting === "income"} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                {submitting === "income" ? "Saving…" : "Record"}
              </button>
            </div>

            {income.length === 0 ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No income recorded yet.</p> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 120px", gap: 8, padding: "5px 0", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)" }}>
                  <span>Description</span><span>Source</span><span style={{ textAlign: "right" }}>Amount</span><span style={{ textAlign: "right" }}>Date</span>
                </div>
                {income.map(r => (
                  <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 120px", gap: 8, padding: "9px 0", borderBottom: "1px solid var(--border)", alignItems: "center", fontSize: 13 }}>
                    <span>{r.description}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "capitalize" }}>{r.source}</span>
                    <span style={{ textAlign: "right", fontWeight: 600 }}>{formatCurrency(r.amount, r.currency)}</span>
                    <span style={{ textAlign: "right", fontSize: 11, color: "var(--text-muted)" }}>{relativeTime(r.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {tab === "distributions" && (
        <Card title="Distributions">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
              <div style={{ flex: 2 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Description</label>
                <input value={distForm.description} onChange={e => setDistForm(f => ({ ...f, description: e.target.value }))} placeholder="Worker stipend, equipment, etc." style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Amount ({cur})</label>
                <input type="number" value={distForm.amount} onChange={e => setDistForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Recipient</label>
                <input value={distForm.recipient} onChange={e => setDistForm(f => ({ ...f, recipient: e.target.value }))} placeholder="Name or ID" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <button onClick={createDistribution} disabled={submitting === "dist"} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                {submitting === "dist" ? "Saving…" : "Create"}
              </button>
            </div>
            {distributions.length === 0 ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No distributions yet.</p> : distributions.map(d => (
              <div key={d.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{d.description}</p>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0" }}>{relativeTime(d.createdAt)}</p>
                </div>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{formatCurrency(d.amount, d.currency)}</span>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: d.status === "executed" ? "#dcfce7" : "#fef9c3", color: d.status === "executed" ? "#16a34a" : "#d97706" }}>{d.status}</span>
                {d.status !== "executed" && (
                  <button onClick={() => executeDistribution(d.id)} style={{ fontSize: 11, fontWeight: 600, background: "var(--success)", color: "#fff", padding: "4px 10px" }}>Execute</button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "contributions" && (
        <Card title="Member contributions">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Contributor</label>
                <input value={contribForm.contributor} onChange={e => setContribForm(f => ({ ...f, contributor: e.target.value }))} placeholder="Member name or ID" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Amount ({cur})</label>
                <input type="number" value={contribForm.amount} onChange={e => setContribForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Description</label>
                <input value={contribForm.description} onChange={e => setContribForm(f => ({ ...f, description: e.target.value }))} placeholder="Labor hours, capital, etc." style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <button onClick={recordContribution} disabled={submitting === "contrib"} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                {submitting === "contrib" ? "Saving…" : "Record"}
              </button>
            </div>
            {contributions.length === 0 ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No contributions recorded yet.</p> : contributions.map(c => (
              <div key={c.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{c.contributor}</p>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0" }}>{c.description} · {relativeTime(c.createdAt)}</p>
                </div>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{formatCurrency(c.amount, c.currency)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
