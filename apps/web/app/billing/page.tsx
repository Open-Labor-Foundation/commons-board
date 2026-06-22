"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPost, formatCurrency, relativeTime } from "../../lib/api";

type Metrics = { totalRevenue: number; mrr: number; arr: number; activeCustomers: number; trialCustomers: number; churnedCustomers: number; eventCounts: Record<string, number>; currency: string };
type BillingEvent = { id: string; eventName: string; customerId?: string; amount?: number; currency?: string; createdAt: string; metadata?: Record<string, unknown> };
type Customer = { id: string; name?: string; email?: string; mrr?: number; status: string; startedAt: string; currency?: string };

const EVENT_NAMES = ["checkout_completed", "payment_received", "invoice_paid", "subscription_started", "subscription_cancelled", "refund_issued"];

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px 20px" }}>
      <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: "4px 0 0" }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "3px 0 0" }}>{sub}</p>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
      </div>
      <div style={{ padding: "12px 16px" }}>{children}</div>
    </div>
  );
}

export default function BillingPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"events" | "customers">("events");
  const [form, setForm] = useState({ eventName: "payment_received", customerId: "", amount: "", currency: "USD" });
  const [custForm, setCustForm] = useState({ id: "", name: "", email: "", mrr: "", status: "active" });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const [m, e, c] = await Promise.all([
      apiFetch<Metrics>("/api/v1/billing/metrics"),
      apiFetch<{ events: BillingEvent[] }>("/api/v1/billing/events"),
      apiFetch<{ customers: Customer[] }>("/api/v1/billing/customers"),
    ]);
    if (m) setMetrics(m);
    setEvents(e?.events ?? []);
    setCustomers(c?.customers ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addEvent() {
    setSubmitting(true);
    await apiPost("/api/v1/billing/events", {
      eventName: form.eventName,
      customerId: form.customerId || undefined,
      amount: form.amount ? Number(form.amount) : undefined,
      currency: form.currency,
      metadata: {},
    });
    setForm(f => ({ ...f, customerId: "", amount: "" }));
    setSubmitting(false);
    load();
  }

  async function addCustomer() {
    setSubmitting(true);
    await apiPost("/api/v1/billing/customers", {
      id: custForm.id || undefined,
      name: custForm.name || undefined,
      email: custForm.email || undefined,
      mrr: custForm.mrr ? Number(custForm.mrr) : undefined,
      status: custForm.status,
    });
    setCustForm({ id: "", name: "", email: "", mrr: "", status: "active" });
    setSubmitting(false);
    load();
  }

  const cur = metrics?.currency ?? "USD";

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 960 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Billing</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
        <StatBox label="MRR" value={formatCurrency(metrics?.mrr ?? 0, cur)} />
        <StatBox label="ARR" value={formatCurrency(metrics?.arr ?? 0, cur)} />
        <StatBox label="Total revenue" value={formatCurrency(metrics?.totalRevenue ?? 0, cur)} />
        <StatBox label="Active" value={String(metrics?.activeCustomers ?? 0)} sub="customers" />
        <StatBox label="Trial" value={String(metrics?.trialCustomers ?? 0)} sub="customers" />
        <StatBox label="Churned" value={String(metrics?.churnedCustomers ?? 0)} sub="customers" />
      </div>

      {metrics && Object.keys(metrics.eventCounts).length > 0 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {Object.entries(metrics.eventCounts).map(([k, v]) => (
            <div key={k} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "6px 14px", fontSize: 12 }}>
              <span style={{ color: "var(--text-muted)" }}>{k.replace(/_/g, " ")}</span>
              <span style={{ fontWeight: 700, marginLeft: 8 }}>{v}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        {(["events", "customers"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: tab === t ? 600 : 400,
            color: tab === t ? "var(--brand)" : "var(--text-secondary)",
            background: "none", borderBottom: tab === t ? "2px solid var(--brand)" : "2px solid transparent", marginBottom: -1, textTransform: "capitalize",
          }}>
            {t === "events" ? `Events (${events.length})` : `Customers (${customers.length})`}
          </button>
        ))}
      </div>

      {tab === "events" && (
        <Card title="Billing events">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Event type</label>
                <select value={form.eventName} onChange={e => setForm(f => ({ ...f, eventName: e.target.value }))} style={{ width: "100%", padding: "7px 10px", fontSize: 13 }}>
                  {EVENT_NAMES.map(n => <option key={n} value={n}>{n.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Customer ID</label>
                <input value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))} placeholder="Optional" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Amount ({cur})</label>
                <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <button onClick={addEvent} disabled={submitting} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                {submitting ? "Adding…" : "Add event"}
              </button>
            </div>
            {events.length === 0 ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No billing events yet.</p> : (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 80px 120px", gap: 8, padding: "5px 0", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)" }}>
                  <span>Event</span><span>Customer</span><span style={{ textAlign: "right" }}>Amount</span><span style={{ textAlign: "right" }}>Date</span>
                </div>
                {events.map(e => (
                  <div key={e.id} style={{ display: "grid", gridTemplateColumns: "1fr 100px 80px 120px", gap: 8, padding: "9px 0", borderBottom: "1px solid var(--border)", alignItems: "center", fontSize: 13 }}>
                    <span style={{ textTransform: "capitalize" }}>{e.eventName.replace(/_/g, " ")}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.customerId ?? "—"}</span>
                    <span style={{ textAlign: "right", fontWeight: 600 }}>{e.amount != null ? formatCurrency(e.amount, e.currency ?? cur) : "—"}</span>
                    <span style={{ textAlign: "right", fontSize: 11, color: "var(--text-muted)" }}>{relativeTime(e.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {tab === "customers" && (
        <Card title="Customers">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Name</label>
                <input value={custForm.name} onChange={e => setCustForm(f => ({ ...f, name: e.target.value }))} placeholder="Customer name" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Email</label>
                <input type="email" value={custForm.email} onChange={e => setCustForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div style={{ width: 100 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>MRR ({cur})</label>
                <input type="number" value={custForm.mrr} onChange={e => setCustForm(f => ({ ...f, mrr: e.target.value }))} placeholder="0" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div style={{ width: 100 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Status</label>
                <select value={custForm.status} onChange={e => setCustForm(f => ({ ...f, status: e.target.value }))} style={{ width: "100%", padding: "7px 10px", fontSize: 13 }}>
                  <option value="active">Active</option>
                  <option value="trial">Trial</option>
                  <option value="churned">Churned</option>
                </select>
              </div>
              <button onClick={addCustomer} disabled={submitting} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                {submitting ? "Adding…" : "Add"}
              </button>
            </div>
            {customers.length === 0 ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No customers yet.</p> : customers.map(c => (
              <div key={c.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{c.name ?? c.id}</p>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0" }}>{c.email ?? ""} · since {relativeTime(c.startedAt)}</p>
                </div>
                {c.mrr != null && <span style={{ fontWeight: 700, fontSize: 13 }}>{formatCurrency(c.mrr, c.currency ?? cur)}/mo</span>}
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: c.status === "active" ? "#dcfce7" : c.status === "trial" ? "#fef9c3" : "#fee2e2", color: c.status === "active" ? "#16a34a" : c.status === "trial" ? "#d97706" : "#dc2626" }}>{c.status}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
