"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { apiFetch, relativeTime, formatCurrency, statusColor, humanize } from "../../lib/api";

type ChatMessage = {
  role: "user" | "board";
  content: string;
  headline?: string;
  chair_id?: string | null;
};

type ChatResponse = {
  thread_id: string;
  headline: string;
  summary_markdown: string;
  meta: { domain: string | null; chair_id: string | null };
};

type ApprovalRecord = {
  approval_id: string;
  action_id: string;
  status: string;
  created_at: string;
};

type Level4Action = { id: string; type: string; status: string; createdAt: string };
type GovernanceEvent = { event_id: string; event_type: string; actor: string; at: string };
type TreasuryBalance = { totalIncome: number; availableForDistribution: number; currency: string };
type BillingMetrics = { mrr: number; arr: number; activeCustomers: number; currency: string };
type Level4Dashboard = {
  metrics: {
    actions: { total: number; pending: number };
    outreach: { prospects: number };
  };
};

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 500, background: color + "18", color }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--surface-overlay)" }}>
        <span style={{ fontWeight: 600, fontSize: 12, color: "var(--text-primary)" }}>{title}</span>
        {action}
      </div>
      <div style={{ padding: "10px 14px" }}>{children}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: "12px 0", margin: 0 }}>{text}</p>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, flexShrink: 0 }}>
      <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

export default function DashboardPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRecord[]>([]);
  const [pendingActions, setPendingActions] = useState<Level4Action[]>([]);
  const [recentEvents, setRecentEvents] = useState<GovernanceEvent[]>([]);
  const [treasury, setTreasury] = useState<TreasuryBalance | null>(null);
  const [billing, setBilling] = useState<BillingMetrics | null>(null);
  const [level4dash, setLevel4dash] = useState<Level4Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadData = useCallback(async () => {
    const [approvalsRes, actionsRes, eventsRes, treas, bill, l4dash] = await Promise.all([
      apiFetch<{ approvals: ApprovalRecord[] }>("/api/v1/approvals?status=pending&limit=20"),
      apiFetch<{ actions: Level4Action[] }>("/api/v1/level4/actions?status=pending&limit=20"),
      apiFetch<{ entries: Array<{ event: GovernanceEvent }> }>("/api/v1/decision-log?limit=12"),
      apiFetch<TreasuryBalance>("/api/v1/treasury/balance"),
      apiFetch<BillingMetrics>("/api/v1/billing/metrics"),
      apiFetch<Level4Dashboard>("/api/v1/level4/dashboard"),
    ]);
    setPendingApprovals(approvalsRes?.approvals?.filter((a) => a.status === "pending") ?? []);
    setPendingActions(actionsRes?.actions?.filter((a) => a.status === "pending") ?? []);
    setRecentEvents((eventsRes?.entries ?? []).map((e) => e.event).reverse());
    if (treas) setTreasury(treas);
    if (bill) setBilling(bill);
    if (l4dash) setLevel4dash(l4dash);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 30000);
    return () => clearInterval(iv);
  }, [loadData]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendMessage() {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    setMessages((p) => [...p, { role: "user", content: text }]);
    setChatInput("");
    setChatLoading(true);
    const res = await apiFetch<ChatResponse>("/api/v1/board/chat", {
      method: "POST",
      body: JSON.stringify({ message: text, thread_id: threadId }),
    });
    if (res) {
      setThreadId(res.thread_id);
      setMessages((p) => [...p, { role: "board", content: res.summary_markdown, headline: res.headline, chair_id: res.meta.chair_id }]);
    } else {
      setMessages((p) => [...p, { role: "board", content: "Unable to reach the board. Please try again." }]);
    }
    setChatLoading(false);
  }

  async function approveAction(approvalId: string) {
    const a = pendingApprovals.find((x) => x.approval_id === approvalId);
    if (!a) return;
    await apiFetch(`/api/v1/level4/actions/${a.action_id}/approve-execute`, { method: "POST" });
    loadData();
  }

  if (loading) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
      <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</span>
    </div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Metrics strip */}
      {(billing?.mrr || treasury?.totalIncome || level4dash) && (
        <div style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", padding: "8px 20px", display: "flex", gap: 28, alignItems: "center", flexShrink: 0, overflowX: "auto" }}>
          {billing && billing.mrr > 0 && <>
            <Metric label="MRR" value={formatCurrency(billing.mrr, billing.currency)} />
            <Metric label="ARR" value={formatCurrency(billing.arr, billing.currency)} />
            <Metric label="Customers" value={String(billing.activeCustomers)} />
          </>}
          {treasury && treasury.totalIncome > 0 && <>
            <Metric label="Treasury" value={formatCurrency(treasury.totalIncome, treasury.currency)} />
            <Metric label="Available" value={formatCurrency(treasury.availableForDistribution, treasury.currency)} />
          </>}
          {level4dash?.metrics?.actions && <>
            <Metric label="L4 actions" value={String(level4dash.metrics.actions.total)} />
            <Metric label="Prospects" value={String(level4dash.metrics.outreach?.prospects ?? 0)} />
          </>}
        </div>
      )}

      {/* Main body */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 300px", overflow: "hidden", minHeight: 0 }}>
        {/* Chat */}
        <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
            {messages.length === 0 && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "var(--text-muted)", paddingBottom: 60 }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--brand-light)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>◎</div>
                <p style={{ fontSize: 15, fontWeight: 500, color: "var(--text-secondary)", margin: 0 }}>Ask the board anything</p>
                <p style={{ fontSize: 13, maxWidth: 340, textAlign: "center", margin: 0 }}>Route a question, request a brief, propose a directive, or check on a running initiative.</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start", gap: 4, maxWidth: "80%", alignSelf: msg.role === "user" ? "flex-end" : "flex-start" }}>
                {msg.role === "board" && msg.headline && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {msg.headline}{msg.chair_id && <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 6 }}>via {msg.chair_id}</span>}
                  </span>
                )}
                <div style={{
                  background: msg.role === "user" ? "var(--brand)" : "var(--surface)",
                  color: msg.role === "user" ? "#fff" : "var(--text-primary)",
                  padding: "9px 13px",
                  borderRadius: msg.role === "user" ? "13px 13px 4px 13px" : "4px 13px 13px 13px",
                  border: msg.role === "board" ? "1px solid var(--border)" : "none",
                  fontSize: 14,
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  boxShadow: "var(--shadow-sm)",
                }}>
                  {msg.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13 }}>
                <span style={{ display: "flex", gap: 3 }}>
                  {[0,1,2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-muted)", animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
                </span>
                Board is thinking…
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div style={{ padding: "10px 20px 14px", borderTop: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
            {threadId && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Thread {threadId.slice(0,8)}</span>
                <button onClick={() => { setMessages([]); setThreadId(null); inputRef.current?.focus(); }} style={{ fontSize: 11, color: "var(--text-muted)", background: "none", padding: "2px 6px", border: "1px solid var(--border)", borderRadius: 4 }}>New thread</button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                ref={inputRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Message the board… (Enter to send)"
                rows={1}
                style={{ flex: 1, resize: "none", padding: "8px 11px", fontSize: 14, minHeight: 38, maxHeight: 140, lineHeight: 1.4, overflow: "auto" }}
                onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 140) + "px"; }}
              />
              <button onClick={sendMessage} disabled={!chatInput.trim() || chatLoading} style={{ background: "var(--brand)", color: "#fff", padding: "8px 14px", fontWeight: 600, fontSize: 13, flexShrink: 0, height: 38 }}>Send</button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, overflowY: "auto", background: "var(--surface-raised)" }}>
          <Card title={`Approvals${pendingApprovals.length > 0 ? ` (${pendingApprovals.length})` : ""}`}>
            {pendingApprovals.length === 0 ? <Empty text="No pending approvals" /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {pendingApprovals.slice(0,6).map(a => (
                  <div key={a.approval_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", background: "var(--warning-bg)", borderRadius: "var(--radius)", border: "1px solid #fde68a" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>Action {a.action_id?.slice(0,8)}</p>
                      <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "1px 0 0" }}>{relativeTime(a.created_at)}</p>
                    </div>
                    <button onClick={() => approveAction(a.approval_id)} style={{ fontSize: 10, fontWeight: 600, background: "var(--success)", color: "#fff", padding: "3px 8px", flexShrink: 0 }}>Approve</button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title={`Level 4${pendingActions.length > 0 ? ` (${pendingActions.length})` : ""}`}>
            {pendingActions.length === 0 ? <Empty text="No pending actions" /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {pendingActions.slice(0,6).map(a => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{humanize(a.type ?? "")}</p>
                      <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "1px 0 0" }}>{relativeTime(a.createdAt)}</p>
                    </div>
                    <StatusBadge label={a.status} color={statusColor(a.status)} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Recent decisions">
            {recentEvents.length === 0 ? <Empty text="No governance events yet" /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {recentEvents.slice(0,10).map(e => (
                  <div key={e.event_id} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 7 }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--brand)", flexShrink: 0, marginTop: 5 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{humanize(e.event_type)}</p>
                      <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "1px 0 0" }}>{e.actor} · {relativeTime(e.at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
      <style>{`@keyframes pulse { 0%,80%,100%{opacity:.2;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  );
}
