"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, apiPost, relativeTime } from "../../../lib/api";

type WorkerAgent = {
  agent_id: string;
  name: string;
  task_scope: string[];
  status: "active" | "pending" | "ready";
  current_task: { id: string; description: string; type: string; status: string; created_at: string } | null;
};

type Chair = {
  chair_id: string;
  name: string;
  domain: string;
  description: string;
  scope: { owns: string[]; refuses: string[]; escalates_to: string[] };
  approval_required_for: string[];
};

type ApprovalRecord = {
  approval_id: string;
  action_id: string;
  status: string;
  details?: Record<string, unknown>;
  created_at: string;
};

type ChairData = {
  chair: Chair;
  workers: WorkerAgent[];
  pending_approvals: ApprovalRecord[];
  total_workers: number;
  active_count: number;
};

type ChatResponse = {
  thread_id: string;
  headline: string;
  summary_markdown: string;
  meta: { domain: string | null; chair_id: string | null };
};

const DOMAIN_COLOR: Record<string, string> = {
  finance: "#16a34a", ops: "#2563eb", legal: "#7c3aed", hr: "#d97706",
  strategy: "#4f46e5", product: "#0891b2", security: "#dc2626",
  rnd: "#ca8a04", it: "#0284c7", sales: "#db2777", growth: "#65a30d", custom: "#64748b",
};

function domainColor(domain: string) { return DOMAIN_COLOR[domain] ?? "#64748b"; }

function statusBadge(status: "active" | "pending" | "ready") {
  const map = {
    active:  { bg: "#16a34a18", color: "#16a34a", label: "Working" },
    pending: { bg: "#d9770618", color: "#d97706", label: "Needs input" },
    ready:   { bg: "#2563eb18", color: "#2563eb", label: "Ready" },
  };
  const s = map[status];
  return (
    <span style={{ fontSize: 10, fontWeight: 700, background: s.bg, color: s.color, padding: "2px 7px", borderRadius: 10 }}>
      {s.label}
    </span>
  );
}

export default function ChairDetailPage() {
  const params = useParams();
  const chairId = params?.chairId as string;

  const [data, setData] = useState<ChairData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "board"; content: string; headline?: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<ChairData>(`/api/v1/workers/by-chair/${chairId}`);
    if (!res) { setNotFound(true); setLoading(false); return; }
    setData(res);
    setLoading(false);
  }, [chairId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  async function sendMessage() {
    const text = chatInput.trim();
    if (!text || chatLoading || !data) return;
    setChatMessages(p => [...p, { role: "user", content: text }]);
    setChatInput("");
    setChatLoading(true);
    const res = await apiFetch<ChatResponse>("/api/v1/board/chat", {
      method: "POST",
      body: JSON.stringify({ message: text, thread_id: threadId, domain: data.chair.domain }),
    });
    if (res) {
      setThreadId(res.thread_id);
      setChatMessages(p => [...p, { role: "board", content: res.summary_markdown, headline: res.headline }]);
    } else {
      setChatMessages(p => [...p, { role: "board", content: "Unable to reach this chair. Please try again." }]);
    }
    setChatLoading(false);
  }

  if (loading) return <div style={{ padding: 32, fontSize: 13, color: "var(--text-muted)" }}>Loading…</div>;
  if (notFound || !data) return (
    <div style={{ padding: 32 }}>
      <p style={{ fontSize: 14, color: "var(--text-muted)" }}>Chair not found. <Link href="/org" style={{ color: "var(--brand)" }}>View board roster →</Link></p>
    </div>
  );

  const { chair, workers, pending_approvals, active_count } = data;
  const color = domainColor(chair.domain);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 4 }}>
          <div style={{ width: 38, height: 38, borderRadius: "50%", background: color + "18", border: `2px solid ${color}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color }}>{chair.domain.slice(0, 2).toUpperCase()}</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{chair.name}</h2>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: color + "18", color, fontWeight: 600 }}>{chair.domain}</span>
            </div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "3px 0 0", lineHeight: 1.5 }}>{chair.description}</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)", background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "4px 10px" }}>
              {workers.length} worker{workers.length !== 1 ? "s" : ""} · {active_count} active
            </span>
            <Link href="/org" style={{ fontSize: 12, color: "var(--brand)", textDecoration: "none", background: "var(--brand-light)", border: "1px solid var(--brand)", borderRadius: "var(--radius)", padding: "4px 10px", fontWeight: 500 }}>
              ← Board roster
            </Link>
          </div>
        </div>

        {/* Scope pills */}
        {chair.scope?.owns && chair.scope.owns.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {chair.scope.owns.map(item => (
              <span key={item} style={{ fontSize: 11, background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: 10, padding: "2px 9px", color: "var(--text-secondary)" }}>
                {item.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 320px", overflow: "hidden", minHeight: 0 }}>

        {/* Left: workers + pending */}
        <div style={{ overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

          {/* Workers */}
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 12px" }}>
              Workers on this team
            </p>
            {workers.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>No workers assigned to this chair yet.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
                {workers.map(worker => (
                  <Link
                    key={worker.agent_id}
                    href={`/workers/${worker.agent_id}`}
                    style={{
                      display: "block",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-lg)",
                      padding: "13px 15px",
                      textDecoration: "none",
                      boxShadow: "var(--shadow-sm)",
                      transition: "border-color 0.15s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{worker.name}</span>
                      {statusBadge(worker.status)}
                    </div>
                    {worker.task_scope && worker.task_scope.length > 0 && (
                      <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 6px", lineHeight: 1.4 }}>
                        {worker.task_scope.slice(0, 2).join(" · ")}
                      </p>
                    )}
                    {worker.current_task ? (
                      <div style={{ background: "#16a34a10", border: "1px solid #16a34a30", borderRadius: "var(--radius)", padding: "6px 9px", marginTop: 6 }}>
                        <p style={{ fontSize: 10, fontWeight: 600, color: "#16a34a", margin: "0 0 2px", textTransform: "uppercase" }}>Current task</p>
                        <p style={{ fontSize: 11, color: "var(--text-primary)", margin: 0, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
                          {worker.current_task.description}
                        </p>
                      </div>
                    ) : (
                      <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "6px 0 0" }}>
                        Ready for work · <span style={{ color: "var(--brand)" }}>Assign task →</span>
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Pending decisions */}
          {pending_approvals.length > 0 && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 12px" }}>
                Pending decisions for this team ({pending_approvals.length})
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pending_approvals.map(a => (
                  <div key={a.approval_id} style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: "var(--radius-lg)", padding: "11px 14px" }}>
                    <p style={{ fontSize: 12, color: "#92400e", margin: "0 0 4px" }}>
                      {String(a.details?.action_type ?? "Approval needed")}
                    </p>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{relativeTime(a.created_at)}</span>
                      <Link href="/approvals" style={{ fontSize: 11, fontWeight: 600, color: "#92400e", textDecoration: "none" }}>Review →</Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chair detail: what requires approval */}
          {chair.approval_required_for && chair.approval_required_for.length > 0 && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 10px" }}>
                Needs your sign-off for
              </p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {chair.approval_required_for.map(item => (
                  <span key={item} style={{ fontSize: 11, background: "#fefce8", border: "1px solid #fde68a", borderRadius: 10, padding: "3px 10px", color: "#92400e" }}>
                    {item.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: chat with this chair */}
        <div style={{ borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--surface-overlay)", flexShrink: 0 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Ask {chair.name}</p>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0" }}>Replies route to the {chair.domain} domain</p>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {chatMessages.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                {[
                  `What is ${chair.name} currently working on?`,
                  `What decisions does ${chair.name} need from me?`,
                  `Summarize recent ${chair.domain} activity.`,
                ].map(s => (
                  <button key={s} onClick={() => { setChatInput(s); inputRef.current?.focus(); }}
                    style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "8px 11px", fontSize: 12, color: "var(--text-secondary)", textAlign: "left", cursor: "pointer" }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {chatMessages.map((m, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", gap: 2 }}>
                {m.role === "board" && m.headline && (
                  <span style={{ fontSize: 9, fontWeight: 600, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.headline}</span>
                )}
                <div style={{
                  maxWidth: "90%", padding: "8px 11px", fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word",
                  background: m.role === "user" ? "var(--brand)" : "var(--surface)",
                  color: m.role === "user" ? "#fff" : "var(--text-primary)",
                  borderRadius: m.role === "user" ? "11px 11px 3px 11px" : "3px 11px 11px 11px",
                  border: m.role === "board" ? "1px solid var(--border)" : "none",
                }}>
                  {m.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "6px 0" }}>Thinking…</div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
            {threadId && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Continuing thread</span>
                <button onClick={() => { setChatMessages([]); setThreadId(null); }} style={{ fontSize: 10, color: "var(--text-muted)", background: "none", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 6px" }}>
                  New
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <textarea
                ref={inputRef}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={`Ask ${chair.name}…`}
                rows={2}
                style={{ flex: 1, resize: "none", padding: "7px 9px", fontSize: 12, lineHeight: 1.4 }}
                disabled={chatLoading}
              />
              <button onClick={sendMessage} disabled={!chatInput.trim() || chatLoading}
                style={{ background: "var(--brand)", color: "#fff", padding: "0 12px", fontSize: 12, fontWeight: 600, flexShrink: 0, borderRadius: "var(--radius)", border: "none", cursor: "pointer" }}>
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
