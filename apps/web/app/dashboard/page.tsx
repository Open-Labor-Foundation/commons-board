"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { apiFetch, apiPost, relativeTime, formatCurrency } from "../../lib/api";

// ── types ─────────────────────────────────────────────────────────────────────

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

type Chair = {
  chair_id: string;
  name: string;
  domain: string;
  description: string;
  scope: { owns: string[] };
};

type Approval = { approval_id: string; action_id: string; action_type: string; summary: string; status: string; created_at: string };
type GovernanceEvent = { event_id: string; event_type: string; actor: string; at: string; details?: Record<string, unknown> };
type TreasuryBalance = { totalIncome: number; availableForDistribution: number; currency: string };
type BillingMetrics = { mrr: number; activeCustomers: number; currency: string };
type BoardArtifact = { artifact_id: string; payload?: { chairs?: Chair[] } };

// ── helpers ───────────────────────────────────────────────────────────────────

const DOMAIN_COLOR: Record<string, string> = {
  finance: "#16a34a", ops: "#2563eb", legal: "#7c3aed", hr: "#d97706",
  strategy: "#4f46e5", product: "#0891b2", security: "#dc2626",
  rnd: "#ca8a04", it: "#0284c7", sales: "#db2777", growth: "#65a30d", custom: "#64748b",
};

function domainColor(domain: string) { return DOMAIN_COLOR[domain] ?? "#64748b"; }

function humanizeEvent(eventType: string): string {
  const map: Record<string, string> = {
    artifact_written: "Board document updated",
    action_proposed: "Decision requested",
    approval_recorded: "Vote recorded",
    org_activated: "Board activated",
    action_executed: "Action completed",
    setting_updated: "Settings updated",
    artifact_created: "Document created",
  };
  return map[eventType] ?? eventType.replace(/_/g, " ");
}

function humanizeActionType(raw: string): string {
  const map: Record<string, string> = {
    budget_approval: "Budget approval",
    member_admission: "New member admission",
    contract_approval: "Contract approval",
    policy_change: "Policy change",
    compensation_change: "Compensation change",
    vendor_approval: "Vendor approval",
  };
  return map[raw] ?? raw.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── components ─────────────────────────────────────────────────────────────────

function ChairCard({ chair, onAsk }: { chair: Chair; onAsk: (name: string) => void }) {
  const color = domainColor(chair.domain);
  const owns = chair.scope?.owns?.slice(0, 3) ?? [];
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      padding: "14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      boxShadow: "var(--shadow-sm)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: color + "18", border: `2px solid ${color}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color }}>{chair.domain.slice(0, 2).toUpperCase()}</span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{chair.name}</span>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.45 }}>{chair.description}</p>
      {owns.length > 0 && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
          Handles: {owns.map(o => o.replace(/_/g, " ")).join(", ")}
        </p>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
        <button
          onClick={() => onAsk(chair.name)}
          style={{ background: "none", border: `1px solid ${color}`, color, borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          Ask →
        </button>
        <Link
          href={`/board/${chair.chair_id}`}
          style={{ background: color + "12", border: `1px solid ${color}40`, color, borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 12, fontWeight: 600, textDecoration: "none" }}
        >
          View team →
        </Link>
      </div>
    </div>
  );
}

function BoardNotReady() {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div style={{ maxWidth: 520, width: "100%" }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px", color: "var(--text-primary)" }}>
          Your board isn't set up yet
        </h2>
        <p style={{ fontSize: 14, color: "var(--text-muted)", margin: "0 0 24px", lineHeight: 1.6 }}>
          Answer a few questions about your business and we'll configure a full board of advisors — Finance, Legal, HR, Operations, Strategy, and more — ready to help you run every part of your business.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 28 }}>
          {[
            { done: true,  label: "Workspace created", sub: "Your workspace is ready" },
            { done: false, label: "Tell us about your business", sub: "A short interview sets up your board" },
            { done: false, label: "Meet your board", sub: "Your advisors are ready to work" },
          ].map((step, i) => (
            <div key={i} style={{ display: "flex", gap: 14, padding: "14px 16px", background: "var(--surface)", borderRadius: "var(--radius-lg)", border: `1px solid ${step.done ? "var(--border)" : "var(--brand)"}` }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: step.done ? "var(--success)" : "var(--brand-light)", color: step.done ? "#fff" : "var(--brand)", border: step.done ? "none" : "1.5px solid var(--brand)" }}>
                {step.done ? "✓" : i + 1}
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: step.done ? "var(--text-muted)" : "var(--text-primary)" }}>{step.label}</p>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "3px 0 0" }}>{step.sub}</p>
              </div>
            </div>
          ))}
        </div>
        <Link href="/onboarding" style={{ display: "inline-block", background: "var(--brand)", color: "#fff", padding: "12px 28px", borderRadius: "var(--radius)", fontWeight: 600, fontSize: 14, textDecoration: "none" }}>
          Set up my board →
        </Link>
      </div>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [boardReady, setBoardReady] = useState<boolean | null>(null);
  const [chairs, setChairs] = useState<Chair[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<Approval[]>([]);
  const [recentEvents, setRecentEvents] = useState<GovernanceEvent[]>([]);
  const [treasury, setTreasury] = useState<TreasuryBalance | null>(null);
  const [billing, setBilling] = useState<BillingMetrics | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadData = useCallback(async () => {
    const bp = await apiFetch<BoardArtifact>("/api/v1/artifacts/business_profile/latest");
    const ready = !!bp?.artifact_id;
    setBoardReady(ready);
    if (!ready) { setLoading(false); return; }

    const [blueprint, approvalsRes, eventsRes, treas, bill] = await Promise.all([
      apiFetch<BoardArtifact>("/api/v1/artifacts/agent_blueprint/latest"),
      apiFetch<{ approvals: Approval[] }>("/api/v1/approvals?status=pending&limit=20"),
      apiFetch<{ entries: Array<{ event: GovernanceEvent }> }>("/api/v1/decision-log?limit=10"),
      apiFetch<TreasuryBalance>("/api/v1/treasury/balance"),
      apiFetch<BillingMetrics>("/api/v1/billing/metrics"),
    ]);

    setChairs((blueprint?.payload as { chairs?: Chair[] })?.chairs ?? []);
    setPendingApprovals(approvalsRes?.approvals?.filter((a) => a.status === "pending") ?? []);
    setRecentEvents((eventsRes?.entries ?? []).map((e) => e.event).reverse());
    if (treas) setTreasury(treas);
    if (bill) setBilling(bill);
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

  async function approveDecision(approvalId: string) {
    setApproving(approvalId);
    await apiPost(`/api/v1/approvals/${approvalId}/approve`, {});
    setApproving(null);
    loadData();
  }

  function askChair(chairName: string) {
    setChatInput(`I have a question for the ${chairName}: `);
    inputRef.current?.focus();
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading your board…</span>
      </div>
    );
  }

  if (boardReady === false) return <BoardNotReady />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Financial snapshot strip */}
      {(billing?.mrr || treasury?.totalIncome) && (
        <div style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", padding: "7px 20px", display: "flex", gap: 28, alignItems: "center", flexShrink: 0 }}>
          {billing && billing.mrr > 0 && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>Monthly Revenue</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{formatCurrency(billing.mrr, billing.currency)}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>Active Clients</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{billing.activeCustomers}</span>
              </div>
            </>
          )}
          {treasury && treasury.totalIncome > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>Available to Distribute</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{formatCurrency(treasury.availableForDistribution, treasury.currency)}</span>
            </div>
          )}
        </div>
      )}

      {/* Main body */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 300px", overflow: "hidden", minHeight: 0 }}>
        {/* Chat + chairs panel */}
        <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
            {messages.length === 0 ? (
              <>
                {/* Chair cards — the hero content when board is ready but no conversation yet */}
                {chairs.length > 0 && (
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 12px" }}>
                      Your Board
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10, marginBottom: 24 }}>
                      {chairs.map((chair) => (
                        <ChairCard key={chair.chair_id} chair={chair} onAsk={askChair} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Suggestions */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", margin: "0 0 4px" }}>Or ask your board directly:</p>
                  {[
                    "What should I be focusing on this week?",
                    "Are there any decisions I need to make right now?",
                    "Give me a quick financial health check.",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => { setChatInput(suggestion); inputRef.current?.focus(); }}
                      style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "9px 14px", fontSize: 13, color: "var(--text-secondary)", textAlign: "left", cursor: "pointer" }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              messages.map((msg, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start", gap: 4, maxWidth: "80%", alignSelf: msg.role === "user" ? "flex-end" : "flex-start" }}>
                  {msg.role === "board" && msg.headline && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {msg.headline}
                      {msg.chair_id && <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 6 }}>via {msg.chair_id} chair</span>}
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
              ))
            )}
            {chatLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13 }}>
                <span style={{ display: "flex", gap: 3 }}>
                  {[0,1,2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-muted)", animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
                </span>
                Your board is reviewing this…
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input */}
          <div style={{ padding: "10px 20px 14px", borderTop: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
            {threadId && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Continuing conversation</span>
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
              <button onClick={sendMessage} disabled={!chatInput.trim() || chatLoading} style={{ background: "var(--brand)", color: "#fff", padding: "8px 14px", fontWeight: 600, fontSize: 13, flexShrink: 0, height: 38 }}>
                Send
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, overflowY: "auto", background: "var(--surface-raised)" }}>

          {/* Decisions Needed */}
          <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--surface-overlay)" }}>
              <span style={{ fontWeight: 600, fontSize: 12 }}>
                Decisions Needed{pendingApprovals.length > 0 ? ` (${pendingApprovals.length})` : ""}
              </span>
              {pendingApprovals.length > 0 && (
                <Link href="/approvals" style={{ fontSize: 11, color: "var(--brand)", textDecoration: "none" }}>View all</Link>
              )}
            </div>
            <div style={{ padding: "10px 14px" }}>
              {pendingApprovals.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: "12px 0", margin: 0 }}>No decisions pending</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {pendingApprovals.slice(0, 4).map(a => (
                    <div key={a.approval_id} style={{ background: "#fefce8", borderRadius: "var(--radius)", border: "1px solid #fde68a", padding: "9px 11px" }}>
                      <p style={{ fontSize: 11, fontWeight: 600, color: "#92400e", margin: "0 0 3px" }}>{humanizeActionType(a.action_type || "")}</p>
                      <p style={{ fontSize: 12, color: "var(--text-primary)", margin: "0 0 8px", lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const }}>
                        {a.summary}
                      </p>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{relativeTime(a.created_at)}</span>
                        <button
                          onClick={() => approveDecision(a.approval_id)}
                          disabled={approving === a.approval_id}
                          style={{ fontSize: 11, fontWeight: 600, background: "var(--success)", color: "#fff", padding: "3px 10px", borderRadius: "var(--radius)", border: "none", cursor: "pointer", opacity: approving === a.approval_id ? 0.7 : 1 }}
                        >
                          {approving === a.approval_id ? "…" : "Approve"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent Board Activity */}
          <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--surface-overlay)" }}>
              <span style={{ fontWeight: 600, fontSize: 12 }}>Recent Board Activity</span>
              <Link href="/governance" style={{ fontSize: 11, color: "var(--brand)", textDecoration: "none" }}>Board minutes</Link>
            </div>
            <div style={{ padding: "10px 14px" }}>
              {recentEvents.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: "12px 0", margin: 0 }}>No activity yet</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {recentEvents.slice(0, 8).map(e => (
                    <div key={e.event_id} style={{ padding: "7px 0", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 7 }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--brand)", flexShrink: 0, marginTop: 5 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>
                          {humanizeEvent(e.event_type)}
                        </p>
                        <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "1px 0 0" }}>{relativeTime(e.at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,80%,100%{opacity:.2;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  );
}
