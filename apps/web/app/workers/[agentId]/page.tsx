"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, apiPost, relativeTime } from "../../../lib/api";

type WorkerAction = {
  id: string;
  type: string;
  description: string;
  status: "REQUESTED" | "SIMULATED" | "APPROVED" | "DENIED" | "EXECUTED";
  created_at: string;
  updated_at: string;
  completed_at?: string;
  result?: string;
};

type ChairInfo = {
  chair_id: string;
  name: string;
  domain: string;
  description: string;
  scope: { owns: string[] };
  approval_required_for: string[];
};

type WorkerDetail = {
  agent_id: string;
  name: string;
  task_scope: string[];
  labor_commons_ref: string | null;
  chair: ChairInfo;
  status: "active" | "pending" | "ready";
  current_task: WorkerAction | null;
  activity: WorkerAction[];
  pending_chair_approvals: unknown[];
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

function statusProps(status: WorkerAction["status"]) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    REQUESTED: { bg: "#2563eb18", color: "#2563eb",  label: "In progress" },
    APPROVED:  { bg: "#16a34a18", color: "#16a34a",  label: "Approved" },
    EXECUTED:  { bg: "#64748b18", color: "#64748b",  label: "Completed" },
    SIMULATED: { bg: "#4f46e518", color: "#4f46e5",  label: "Simulated" },
    DENIED:    { bg: "#dc262618", color: "#dc2626",  label: "Denied" },
  };
  return map[status] ?? map.REQUESTED;
}

function workerStatusProps(status: "active" | "pending" | "ready") {
  const map = {
    active:  { bg: "#16a34a18", color: "#16a34a", label: "Working" },
    pending: { bg: "#d9770618", color: "#d97706", label: "Needs input" },
    ready:   { bg: "var(--surface-overlay)", color: "var(--text-muted)", label: "Ready" },
  };
  return map[status];
}

export default function WorkerDetailPage() {
  const params = useParams();
  const agentId = params?.agentId as string;

  const [worker, setWorker] = useState<WorkerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [taskDesc, setTaskDesc] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [taskError, setTaskError] = useState("");

  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "board"; content: string; headline?: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const [tab, setTab] = useState<"overview" | "activity">("overview");

  const load = useCallback(async () => {
    const res = await apiFetch<WorkerDetail>(`/api/v1/workers/${agentId}`);
    if (!res) { setNotFound(true); setLoading(false); return; }
    setWorker(res);
    setLoading(false);
  }, [agentId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  async function assignTask() {
    if (!taskDesc.trim() || !worker) return;
    setSubmitting(true);
    setTaskError("");
    const { data, status } = await apiPost<WorkerAction>(`/api/v1/workers/${agentId}/task`, {
      description: taskDesc.trim(),
    });
    setSubmitting(false);
    if (status >= 400 || !data) {
      setTaskError("Failed to assign task. Please try again.");
      return;
    }
    setTaskDesc("");
    load();
  }

  async function sendMessage() {
    const text = chatInput.trim();
    if (!text || chatLoading || !worker) return;
    setChatMessages(p => [...p, { role: "user", content: text }]);
    setChatInput("");
    setChatLoading(true);
    const res = await apiFetch<ChatResponse>("/api/v1/board/chat", {
      method: "POST",
      body: JSON.stringify({
        message: `[Routing to ${worker.name} — ${worker.chair.domain} domain] ${text}`,
        thread_id: threadId,
        domain: worker.chair.domain,
      }),
    });
    if (res) {
      setThreadId(res.thread_id);
      setChatMessages(p => [...p, { role: "board", content: res.summary_markdown, headline: res.headline }]);
    } else {
      setChatMessages(p => [...p, { role: "board", content: "Unable to reach this worker. Please try again." }]);
    }
    setChatLoading(false);
  }

  if (loading) return <div style={{ padding: 32, fontSize: 13, color: "var(--text-muted)" }}>Loading…</div>;
  if (notFound || !worker) return (
    <div style={{ padding: 32 }}>
      <p style={{ fontSize: 14, color: "var(--text-muted)" }}>Worker not found. <Link href="/workers" style={{ color: "var(--brand)" }}>← All workers</Link></p>
    </div>
  );

  const color = DOMAIN_COLOR[worker.chair.domain] ?? "#64748b";
  const wStatus = workerStatusProps(worker.status);

  return (
    <div style={{ padding: 0, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{worker.name}</h2>
              <span style={{ fontSize: 11, fontWeight: 700, background: wStatus.bg, color: wStatus.color, padding: "2px 8px", borderRadius: 10 }}>
                {wStatus.label}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Reports to</span>
              <Link href={`/board/${worker.chair.chair_id}`} style={{
                fontSize: 12, fontWeight: 600, color, textDecoration: "none",
                background: color + "12", border: `1px solid ${color}30`, borderRadius: 10, padding: "1px 8px",
              }}>
                {worker.chair.name} ↗
              </Link>
              <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: 10, padding: "1px 7px" }}>
                {worker.chair.domain}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/workers" style={{ fontSize: 12, color: "var(--text-secondary)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "5px 12px" }}>
              ← All workers
            </Link>
          </div>
        </div>

        {/* Responsibilities */}
        {worker.task_scope && worker.task_scope.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {worker.task_scope.map(item => (
              <span key={item} style={{ fontSize: 11, background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: 10, padding: "2px 9px", color: "var(--text-secondary)" }}>
                {item}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 340px", overflow: "hidden", minHeight: 0 }}>

        {/* Left panel: current task + activity */}
        <div style={{ overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
            {(["overview", "activity"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: "7px 14px", fontSize: 13,
                fontWeight: tab === t ? 600 : 400,
                color: tab === t ? "var(--brand)" : "var(--text-secondary)",
                background: "none", border: "none", borderBottom: tab === t ? "2px solid var(--brand)" : "2px solid transparent",
                marginBottom: -1, cursor: "pointer", textTransform: "capitalize",
              }}>
                {t === "overview" ? "Overview" : `Activity (${worker.activity.length})`}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <>
              {/* Current task */}
              {worker.current_task ? (
                <div style={{ background: "#16a34a0a", border: "1px solid #16a34a30", borderRadius: "var(--radius-lg)", padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#16a34a", flexShrink: 0, animation: "pulse 2s ease-in-out infinite" }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.05em" }}>Currently working on</span>
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 6px", color: "var(--text-primary)", lineHeight: 1.45 }}>
                    {worker.current_task.description}
                  </p>
                  <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-muted)" }}>
                    <span>Started {relativeTime(worker.current_task.created_at)}</span>
                    <span style={{ ...(() => { const s = statusProps(worker.current_task.status); return { color: s.color, fontWeight: 600 }; })() }}>
                      {statusProps(worker.current_task.status).label}
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px" }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 2px", color: "var(--text-secondary)" }}>No active task</p>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>{worker.name} is ready to be assigned work.</p>
                </div>
              )}

              {/* Assign task form */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px" }}>
                <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 10px" }}>Assign a task to {worker.name}</p>
                <textarea
                  value={taskDesc}
                  onChange={e => setTaskDesc(e.target.value)}
                  placeholder={`Describe what you need ${worker.name} to do…`}
                  rows={3}
                  style={{ width: "100%", resize: "vertical", padding: "9px 12px", fontSize: 13, lineHeight: 1.5, borderRadius: "var(--radius)", border: "1px solid var(--border)", boxSizing: "border-box" }}
                />
                {taskError && <p style={{ fontSize: 12, color: "var(--error)", margin: "6px 0 0" }}>{taskError}</p>}
                <button
                  onClick={assignTask}
                  disabled={submitting || !taskDesc.trim()}
                  style={{ marginTop: 10, background: "var(--brand)", color: "#fff", padding: "8px 18px", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius)", border: "none", cursor: submitting || !taskDesc.trim() ? "default" : "pointer", opacity: submitting || !taskDesc.trim() ? 0.65 : 1 }}
                >
                  {submitting ? "Assigning…" : "Assign task"}
                </button>
              </div>

              {/* Sign-off note */}
              {worker.chair.approval_required_for && worker.chair.approval_required_for.length > 0 && (
                <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: "var(--radius-lg)", padding: "12px 14px" }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "#92400e", margin: "0 0 4px" }}>
                    {worker.chair.name} needs your approval for:
                  </p>
                  <p style={{ fontSize: 12, color: "#92400e", margin: 0, lineHeight: 1.5 }}>
                    {worker.chair.approval_required_for.map(r => r.replace(/_/g, " ")).join(", ")}
                  </p>
                </div>
              )}
            </>
          )}

          {tab === "activity" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {worker.activity.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>No activity yet. Assign a task above to get started.</p>
              ) : worker.activity.map((action, i) => {
                const s = statusProps(action.status);
                return (
                  <div key={action.id} style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: i < worker.activity.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0, marginTop: 5 }} />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 3px", lineHeight: 1.4 }}>{action.description}</p>
                      <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text-muted)", flexWrap: "wrap" }}>
                        <span style={{ color: s.color, fontWeight: 600 }}>{s.label}</span>
                        <span>{action.type}</span>
                        <span>{relativeTime(action.created_at)}</span>
                        {action.completed_at && <span>completed {relativeTime(action.completed_at)}</span>}
                      </div>
                      {action.result && (
                        <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "5px 0 0", background: "var(--surface-overlay)", padding: "6px 9px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                          {action.result}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: chat with this worker (routes through their chair domain) */}
        <div style={{ borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--surface-raised)" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Talk to {worker.name}</p>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0" }}>
              Routed through {worker.chair.name} · {worker.chair.domain} domain
            </p>
          </div>
          {(worker.chair.domain === "legal" || worker.chair.domain === "finance") && (
            <div style={{ padding: "8px 14px", background: "#fefce8", borderBottom: "1px solid #fde68a", flexShrink: 0 }}>
              <p style={{ fontSize: 11, color: "#92400e", margin: 0, lineHeight: 1.5 }}>
                <strong>Advisory only.</strong> This worker&apos;s outputs are research and analysis, not {worker.chair.domain === "legal" ? "legal advice" : "financial advice"}. Review and professional sign-off required before any reliance.
              </p>
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {chatMessages.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  `What is ${worker.name} currently working on?`,
                  `Ask ${worker.name} for a status update.`,
                  `What does ${worker.name} need from me to proceed?`,
                ].map(s => (
                  <button key={s} onClick={() => { setChatInput(s); chatInputRef.current?.focus(); }}
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
                  maxWidth: "92%", padding: "8px 11px", fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word",
                  background: m.role === "user" ? "var(--brand)" : "var(--surface)",
                  color: m.role === "user" ? "#fff" : "var(--text-primary)",
                  borderRadius: m.role === "user" ? "11px 11px 3px 11px" : "3px 11px 11px 11px",
                  border: m.role === "board" ? "1px solid var(--border)" : "none",
                  boxShadow: "var(--shadow-sm)",
                }}>
                  {m.content}
                </div>
              </div>
            ))}
            {chatLoading && <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "6px 0" }}>Thinking…</div>}
            <div ref={chatEndRef} />
          </div>

          <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
            {threadId && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Continuing thread</span>
                <button onClick={() => { setChatMessages([]); setThreadId(null); }} style={{ fontSize: 10, color: "var(--text-muted)", background: "none", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 6px", cursor: "pointer" }}>
                  New
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <textarea
                ref={chatInputRef}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={`Message ${worker.name}…`}
                rows={2}
                style={{ flex: 1, resize: "none", padding: "7px 9px", fontSize: 12, lineHeight: 1.4, borderRadius: "var(--radius)", border: "1px solid var(--border)", boxSizing: "border-box" }}
                disabled={chatLoading}
              />
              <button onClick={sendMessage} disabled={!chatInput.trim() || chatLoading}
                style={{ background: "var(--brand)", color: "#fff", padding: "0 12px", fontSize: 12, fontWeight: 600, flexShrink: 0, borderRadius: "var(--radius)", border: "none", cursor: !chatInput.trim() || chatLoading ? "default" : "pointer", opacity: !chatInput.trim() || chatLoading ? 0.65 : 1 }}>
                Send
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,80%,100%{opacity:.4} 40%{opacity:1} }`}</style>
    </div>
  );
}
