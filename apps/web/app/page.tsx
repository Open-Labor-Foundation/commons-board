"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

type BoardSettings = {
  org_name: string;
  governance_mode: "business" | "collective";
  autonomy_mode: string;
  workspace_id: string;
};

type ChatMessage = {
  role: "user" | "board";
  content: string;
  headline?: string;
  domain?: string | null;
  chair_id?: string | null;
};

type ChatResponse = {
  thread_id: string;
  headline: string;
  summary_markdown: string;
  recommended_workflows: Array<{ label: string; action: string; route?: string }>;
  meta: {
    routing: string;
    reasoning: string;
    loop: string;
    domain: string | null;
    chair_id: string | null;
    specialist_slug: string | null;
  };
};

type ApprovalRecord = {
  approval_id: string;
  action_id: string;
  status: string;
  created_at: string;
  required_approvers?: string[];
};

type Level4Action = {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  payload?: Record<string, unknown>;
};

type GovernanceEvent = {
  event_id: string;
  event_type: string;
  actor: string;
  at: string;
  details?: Record<string, unknown>;
};

type TreasuryBalance = {
  totalIncome: number;
  availableForDistribution: number;
  currency: string;
  lastDistributionAt: string | null;
};

type BillingMetrics = {
  mrr: number;
  arr: number;
  totalRevenue: number;
  activeCustomers: number;
  currency: string;
};

type Level4Dashboard = {
  actions: { total: number; pending: number; executing: number; completed: number; failed: number };
  outreach: { prospects: number; campaigns: number; sentTotal: number; interestedCount: number };
  provisioning: { status: string };
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function apiHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-workspace-id": process.env.NEXT_PUBLIC_COMMONS_WORKSPACE_ID ?? "default",
    "x-user-id": process.env.NEXT_PUBLIC_COMMONS_USER_ID ?? "web-operator",
    "x-user-role": process.env.NEXT_PUBLIC_COMMONS_USER_ROLE ?? "admin"
  };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(path, { ...init, headers: { ...apiHeaders(), ...(init?.headers ?? {}) } });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

function humanizeEventType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusColor(status: string): string {
  const colors: Record<string, string> = {
    pending: "#d97706",
    executing: "#0369a1",
    completed: "#16a34a",
    executed: "#16a34a",
    failed: "#dc2626",
    blocked: "#7c3aed",
    active: "#16a34a",
    submitted: "#0369a1",
    triaged: "#7c3aed"
  };
  return colors[status] ?? "#64748b";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 500,
        backgroundColor: color + "18",
        color
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: color, display: "inline-block" }} />
      {label}
    </span>
  );
}

function Card({
  title,
  children,
  action
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-sm)",
        overflow: "hidden"
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-overlay)"
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>{title}</span>
        {action}
      </div>
      <div style={{ padding: "12px 16px" }}>{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: "16px 0" }}>{text}</p>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [settings, setSettings] = useState<BoardSettings | null>(null);
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
    const [s, approvalsRes, actionsRes, eventsRes, treas, bill, l4dash] = await Promise.all([
      apiFetch<BoardSettings>("/api/v1/settings"),
      apiFetch<{ approvals: ApprovalRecord[] }>("/api/v1/approvals?status=pending&limit=20"),
      apiFetch<{ actions: Level4Action[] }>("/api/v1/level4/actions?status=pending&limit=20"),
      apiFetch<{ events: GovernanceEvent[] }>("/api/v1/decision-log?limit=15"),
      apiFetch<TreasuryBalance>("/api/v1/treasury/balance"),
      apiFetch<BillingMetrics>("/api/v1/billing/metrics"),
      apiFetch<Level4Dashboard>("/api/v1/level4/dashboard")
    ]);

    if (s) setSettings(s);
    setPendingApprovals(approvalsRes?.approvals?.filter((a) => a.status === "pending") ?? []);
    setPendingActions(actionsRes?.actions?.filter((a) => a.status === "pending") ?? []);
    setRecentEvents(eventsRes?.events?.slice().reverse() ?? []);
    if (treas) setTreasury(treas);
    if (bill) setBilling(bill);
    if (l4dash) setLevel4dash(l4dash);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const text = chatInput.trim();
    if (!text || chatLoading) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);

    const res = await apiFetch<ChatResponse>("/api/v1/board/chat", {
      method: "POST",
      body: JSON.stringify({ message: text, thread_id: threadId })
    });

    if (res) {
      setThreadId(res.thread_id);
      const boardMsg: ChatMessage = {
        role: "board",
        content: res.summary_markdown,
        headline: res.headline,
        domain: res.meta.domain,
        chair_id: res.meta.chair_id
      };
      setMessages((prev) => [...prev, boardMsg]);
    } else {
      setMessages((prev) => [
        ...prev,
        { role: "board", content: "Unable to reach the board. Please try again." }
      ]);
    }
    setChatLoading(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearThread() {
    setMessages([]);
    setThreadId(null);
    inputRef.current?.focus();
  }

  async function approveAction(approvalId: string) {
    const approval = pendingApprovals.find((a) => a.approval_id === approvalId);
    if (!approval) return;
    await apiFetch(`/api/v1/level4/actions/${approval.action_id}/approve-execute`, { method: "POST" });
    loadData();
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 14 }}>Loading commons-board…</span>
      </div>
    );
  }

  const urgentCount = pendingApprovals.length + pendingActions.length;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* ── Top nav ── */}
      <header
        style={{
          background: "var(--brand)",
          color: "#fff",
          padding: "0 24px",
          height: 52,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          boxShadow: "0 1px 3px rgb(0 0 0 / 0.2)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>commons-board</span>
          {settings && (
            <span
              style={{
                fontSize: 12,
                opacity: 0.8,
                background: "rgba(255,255,255,0.15)",
                padding: "2px 8px",
                borderRadius: 10
              }}
            >
              {settings.org_name}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {settings && (
            <StatusBadge
              label={settings.governance_mode}
              color="#86efac"
            />
          )}
          {urgentCount > 0 && (
            <span
              style={{
                background: "#ef4444",
                color: "#fff",
                borderRadius: 12,
                padding: "2px 8px",
                fontSize: 12,
                fontWeight: 600
              }}
            >
              {urgentCount} pending
            </span>
          )}
        </div>
      </header>

      {/* ── Metrics strip ── */}
      {(billing || treasury || level4dash) && (
        <div
          style={{
            background: "var(--surface)",
            borderBottom: "1px solid var(--border)",
            padding: "10px 24px",
            display: "flex",
            gap: 32,
            alignItems: "center",
            flexShrink: 0,
            overflowX: "auto"
          }}
        >
          {billing && billing.mrr > 0 && (
            <>
              <Metric label="MRR" value={formatCurrency(billing.mrr, billing.currency)} />
              <Metric label="ARR" value={formatCurrency(billing.arr, billing.currency)} />
              <Metric label="Active customers" value={String(billing.activeCustomers)} />
            </>
          )}
          {treasury && treasury.totalIncome > 0 && (
            <>
              <Metric label="Treasury income" value={formatCurrency(treasury.totalIncome, treasury.currency)} />
              <Metric
                label="Available"
                value={formatCurrency(treasury.availableForDistribution, treasury.currency)}
              />
            </>
          )}
          {level4dash && (
            <>
              <Metric label="Actions total" value={String(level4dash.actions.total)} />
              <Metric label="Prospects" value={String(level4dash.outreach.prospects)} />
            </>
          )}
        </div>
      )}

      {/* ── Main body ── */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: 0,
          overflow: "hidden",
          minHeight: 0
        }}
      >
        {/* ── Chat panel ── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid var(--border)",
            overflow: "hidden"
          }}
        >
          {/* chat history */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "20px 24px",
              display: "flex",
              flexDirection: "column",
              gap: 16
            }}
          >
            {messages.length === 0 && (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  color: "var(--text-muted)",
                  paddingBottom: 60
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: "var(--brand-light)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22
                  }}
                >
                  ◎
                </div>
                <p style={{ fontSize: 15, fontWeight: 500, color: "var(--text-secondary)" }}>
                  Ask the board anything
                </p>
                <p style={{ fontSize: 13, maxWidth: 360, textAlign: "center" }}>
                  Route a question, request a brief, propose a directive, or check on a running initiative.
                </p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                  gap: 4,
                  maxWidth: "80%",
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start"
                }}
              >
                {msg.role === "board" && msg.headline && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--brand)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      marginBottom: 2
                    }}
                  >
                    {msg.headline}
                    {msg.chair_id && (
                      <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 6 }}>
                        via {msg.chair_id}
                      </span>
                    )}
                  </span>
                )}
                <div
                  style={{
                    background: msg.role === "user" ? "var(--brand)" : "var(--surface)",
                    color: msg.role === "user" ? "#fff" : "var(--text-primary)",
                    padding: "10px 14px",
                    borderRadius:
                      msg.role === "user" ? "14px 14px 4px 14px" : "4px 14px 14px 14px",
                    border: msg.role === "board" ? "1px solid var(--border)" : "none",
                    fontSize: 14,
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    boxShadow: "var(--shadow-sm)"
                  }}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13 }}>
                <span style={{ display: "flex", gap: 3 }}>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "var(--text-muted)",
                        animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`
                      }}
                    />
                  ))}
                </span>
                Board is thinking…
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* chat input */}
          <div
            style={{
              padding: "12px 24px 16px",
              borderTop: "1px solid var(--border)",
              background: "var(--surface)",
              flexShrink: 0
            }}
          >
            {threadId && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8
                }}
              >
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Thread {threadId.slice(0, 8)}
                </span>
                <button
                  onClick={clearThread}
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    background: "none",
                    padding: "2px 6px",
                    border: "1px solid var(--border)",
                    borderRadius: 4
                  }}
                >
                  New thread
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <textarea
                ref={inputRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message the board… (Enter to send, Shift+Enter for newline)"
                rows={1}
                style={{
                  flex: 1,
                  resize: "none",
                  padding: "9px 12px",
                  fontSize: 14,
                  minHeight: 40,
                  maxHeight: 160,
                  lineHeight: 1.4,
                  overflow: "auto"
                }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 160) + "px";
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!chatInput.trim() || chatLoading}
                style={{
                  background: "var(--brand)",
                  color: "#fff",
                  padding: "9px 16px",
                  fontWeight: 600,
                  fontSize: 14,
                  flexShrink: 0,
                  height: 40
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: 16,
            overflowY: "auto",
            background: "var(--surface-raised)"
          }}
        >
          {/* Pending approvals */}
          <Card
            title={`Approvals${pendingApprovals.length > 0 ? ` (${pendingApprovals.length})` : ""}`}
            action={
              <button
                onClick={loadData}
                style={{ fontSize: 11, color: "var(--text-muted)", background: "none", padding: "2px 6px" }}
              >
                Refresh
              </button>
            }
          >
            {pendingApprovals.length === 0 ? (
              <EmptyState text="No pending approvals" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pendingApprovals.slice(0, 8).map((a) => (
                  <div
                    key={a.approval_id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "8px 10px",
                      background: "var(--warning-bg)",
                      borderRadius: "var(--radius)",
                      border: "1px solid #fde68a"
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Action {a.action_id?.slice(0, 8)}
                      </p>
                      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {relativeTime(a.created_at)}
                      </p>
                    </div>
                    <button
                      onClick={() => approveAction(a.approval_id)}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        background: "var(--success)",
                        color: "#fff",
                        padding: "4px 10px",
                        flexShrink: 0
                      }}
                    >
                      Approve
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Pending Level4 actions */}
          <Card title={`Level 4 Actions${pendingActions.length > 0 ? ` (${pendingActions.length})` : ""}`}>
            {pendingActions.length === 0 ? (
              <EmptyState text="No pending actions" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {pendingActions.slice(0, 8).map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      background: "var(--surface-overlay)",
                      borderRadius: "var(--radius)",
                      border: "1px solid var(--border)"
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.type?.replace(/_/g, " ")}
                      </p>
                      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                        {relativeTime(a.createdAt)}
                      </p>
                    </div>
                    <StatusBadge label={a.status} color={statusColor(a.status)} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Recent governance events */}
          <Card title="Decision Log">
            {recentEvents.length === 0 ? (
              <EmptyState text="No governance events yet" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {recentEvents.slice(0, 12).map((e) => (
                  <div
                    key={e.event_id}
                    style={{
                      padding: "7px 0",
                      borderBottom: "1px solid var(--border)",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "var(--brand)",
                        flexShrink: 0,
                        marginTop: 5
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {humanizeEventType(e.event_type)}
                      </p>
                      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                        {e.actor} · {relativeTime(e.at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric pill
// ---------------------------------------------------------------------------

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, flexShrink: 0 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}
