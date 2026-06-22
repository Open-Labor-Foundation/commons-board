"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPost, apiDelete, relativeTime } from "../../lib/api";

type FedLink = { link_id: string; peer_board_url: string; peer_name?: string; status: string; established_at?: string };
type CrewBridgeStatus = { connected: boolean; crew_endpoint?: string; last_ping?: string; readiness?: string };
type WebhookSub = { subscription_id: string; event_name: string; target_url: string; signing_secret_env?: string; created_at: string; active: boolean };

const WEBHOOK_EVENTS = [
  "governance.decision_made", "governance.approval_required", "treasury.income_recorded",
  "treasury.distribution_executed", "level4.action_created", "org.specialist_confirmed",
];

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

export default function FederationPage() {
  const [links, setLinks] = useState<FedLink[]>([]);
  const [bridge, setBridge] = useState<CrewBridgeStatus | null>(null);
  const [subs, setSubs] = useState<WebhookSub[]>([]);
  const [loading, setLoading] = useState(true);

  const [linkForm, setLinkForm] = useState({ peer_board_url: "", peer_name: "" });
  const [bridgeForm, setBridgeForm] = useState({ crew_endpoint: "" });
  const [subForm, setSubForm] = useState({ event_name: WEBHOOK_EVENTS[0], target_url: "", signing_secret_env: "" });
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [bridgeSaved, setBridgeSaved] = useState(false);

  const load = useCallback(async () => {
    const [l, b, s] = await Promise.all([
      apiFetch<{ links: FedLink[] }>("/api/v1/federation/links"),
      apiFetch<CrewBridgeStatus>("/api/v1/crew-bridge/status"),
      apiFetch<{ subscriptions: WebhookSub[] }>("/api/v1/webhooks/subscriptions"),
    ]);
    setLinks(l?.links ?? []);
    if (b) { setBridge(b); setBridgeForm({ crew_endpoint: b.crew_endpoint ?? "" }); }
    setSubs(s?.subscriptions ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addLink() {
    if (!linkForm.peer_board_url.trim()) return;
    setSubmitting("link");
    await apiPost("/api/v1/federation/links", { peer_board_url: linkForm.peer_board_url.trim(), peer_name: linkForm.peer_name.trim() || undefined });
    setLinkForm({ peer_board_url: "", peer_name: "" });
    setSubmitting(null);
    load();
  }

  async function removeLink(link_id: string) {
    await apiDelete(`/api/v1/federation/links/${link_id}`);
    load();
  }

  async function connectBridge() {
    if (!bridgeForm.crew_endpoint.trim()) return;
    setSubmitting("bridge");
    await apiPost("/api/v1/crew-bridge/connect", { crew_endpoint: bridgeForm.crew_endpoint.trim() });
    setSubmitting(null);
    setBridgeSaved(true);
    setTimeout(() => setBridgeSaved(false), 2000);
    load();
  }

  async function addSub() {
    if (!subForm.target_url.trim()) return;
    setSubmitting("sub");
    await apiPost("/api/v1/webhooks/subscriptions", {
      event_name: subForm.event_name,
      target_url: subForm.target_url.trim(),
      signing_secret_env: subForm.signing_secret_env.trim() || undefined,
    });
    setSubForm(f => ({ ...f, target_url: "", signing_secret_env: "" }));
    setSubmitting(null);
    load();
  }

  async function deleteSub(id: string) {
    await apiDelete(`/api/v1/webhooks/subscriptions/${id}`);
    load();
  }

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 960 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Federation</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>Peer board links, crew-bridge connection, and outbound webhook subscriptions.</p>
      </div>

      {/* Crew bridge */}
      <Card
        title="Crew Bridge"
        action={
          bridge?.connected
            ? <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#dcfce7", color: "#16a34a" }}>Connected</span>
            : <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#fee2e2", color: "#dc2626" }}>Not connected</span>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {bridge?.connected && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 16 }}>
              <span>Endpoint: <strong>{bridge.crew_endpoint}</strong></span>
              {bridge.last_ping && <span>Last ping: <strong>{relativeTime(bridge.last_ping)}</strong></span>}
              {bridge.readiness && <span>Readiness: <strong>{bridge.readiness}</strong></span>}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Crew API endpoint</label>
              <input
                type="text"
                value={bridgeForm.crew_endpoint}
                onChange={e => setBridgeForm({ crew_endpoint: e.target.value })}
                placeholder="http://crew-api:4000"
                style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }}
              />
            </div>
            <button onClick={connectBridge} disabled={submitting === "bridge" || !bridgeForm.crew_endpoint.trim()} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>
              {submitting === "bridge" ? "Connecting…" : bridge?.connected ? "Reconnect" : "Connect"}
            </button>
            {bridgeSaved && <span style={{ fontSize: 12, color: "#16a34a" }}>Saved.</span>}
          </div>
        </div>
      </Card>

      {/* Federation links */}
      <Card title={`Peer board links (${links.length})`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
            <div style={{ flex: 2 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Board URL</label>
              <input value={linkForm.peer_board_url} onChange={e => setLinkForm(f => ({ ...f, peer_board_url: e.target.value }))} placeholder="https://board.example.coop" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Name (optional)</label>
              <input value={linkForm.peer_name} onChange={e => setLinkForm(f => ({ ...f, peer_name: e.target.value }))} placeholder="Partner Board" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <button onClick={addLink} disabled={submitting === "link" || !linkForm.peer_board_url.trim()} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>
              {submitting === "link" ? "Adding…" : "Add link"}
            </button>
          </div>
          {links.length === 0 ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No peer boards linked yet.</p> : links.map(l => (
            <div key={l.link_id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{l.peer_name ?? l.peer_board_url}</p>
                {l.peer_name && <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0" }}>{l.peer_board_url}</p>}
                {l.established_at && <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0" }}>Since {relativeTime(l.established_at)}</p>}
              </div>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: l.status === "active" ? "#dcfce7" : "#fef3c7", color: l.status === "active" ? "#16a34a" : "#d97706" }}>{l.status}</span>
              <button onClick={() => removeLink(l.link_id)} style={{ fontSize: 11, color: "#dc2626", background: "none", padding: "3px 8px", border: "1px solid #fecaca", borderRadius: 4 }}>Remove</button>
            </div>
          ))}
        </div>
      </Card>

      {/* Webhook subscriptions */}
      <Card title={`Webhook subscriptions (${subs.length})`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ padding: "12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Event</label>
                <select value={subForm.event_name} onChange={e => setSubForm(f => ({ ...f, event_name: e.target.value }))} style={{ width: "100%", padding: "7px 10px", fontSize: 13 }}>
                  {WEBHOOK_EVENTS.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Target URL</label>
                <input value={subForm.target_url} onChange={e => setSubForm(f => ({ ...f, target_url: e.target.value }))} placeholder="https://hooks.example.com/cb" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Signing secret env var (optional)</label>
                <input value={subForm.signing_secret_env} onChange={e => setSubForm(f => ({ ...f, signing_secret_env: e.target.value }))} placeholder="WEBHOOK_SIGNING_SECRET" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <button onClick={addSub} disabled={submitting === "sub" || !subForm.target_url.trim()} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                {submitting === "sub" ? "Adding…" : "Subscribe"}
              </button>
            </div>
          </div>
          {subs.length === 0 ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No webhook subscriptions.</p> : (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr 80px 80px", gap: 8, padding: "5px 0", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)" }}>
                <span>Event</span><span>Target</span><span>Status</span><span></span>
              </div>
              {subs.map(s => (
                <div key={s.subscription_id} style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr 80px 80px", gap: 8, padding: "9px 0", borderBottom: "1px solid var(--border)", alignItems: "center", fontSize: 12 }}>
                  <span style={{ color: "var(--text-muted)" }}>{s.event_name}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.target_url}</span>
                  <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 10, background: s.active ? "#dcfce7" : "#f1f5f9", color: s.active ? "#16a34a" : "#64748b", width: "fit-content" }}>{s.active ? "active" : "inactive"}</span>
                  <button onClick={() => deleteSub(s.subscription_id)} style={{ fontSize: 11, color: "#dc2626", background: "none", padding: "3px 8px", border: "1px solid #fecaca", borderRadius: 4, justifySelf: "end" }}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
