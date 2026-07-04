"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { apiFetch, relativeTime } from "../../lib/api";

// ── types ─────────────────────────────────────────────────────────────────────

type ChatMessage = {
  role: "user" | "board" | "chair";
  content: string;
  headline?: string;
  chair_id?: string | null;
  chair_name?: string;
  chair_domain?: string;
  thinking?: string | null;
};

type BoardJobSubmit = {
  job_id: string;
  thread_id: string;
  status: string;
};

type ChairPartial = {
  chair_id: string;
  chair_name: string;
  domain: string;
  thinking: string | null;
  answer: string;
  completed_at: string;
};

type BoardJobPoll = {
  job_id: string;
  status: "pending" | "running" | "done" | "error";
  partial_results?: ChairPartial[] | null;
  result?: {
    thread_id: string;
    headline: string;
    summary_markdown: string;
    recommended_workflows: string[];
    meta: Record<string, unknown>;
  } | null;
  error?: string | null;
};

type ThreadJob = {
  job_id: string;
  thread_id: string;
  message: string;
  status: "pending" | "running" | "done" | "error";
  partial_results: ChairPartial[] | null;
  result: {
    thread_id: string;
    headline: string;
    summary_markdown: string;
    recommended_workflows: string[];
    meta: Record<string, unknown>;
  } | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

type ThreadSummary = {
  thread_id: string;
  first_message: string;
  created_at: string;
  last_activity: string;
  job_count: number;
  last_headline: string | null;
};

type BoardArtifact = { artifact_id: string };

// ── helpers ───────────────────────────────────────────────────────────────────

const DOMAIN_COLOR: Record<string, string> = {
  finance: "#16a34a", ops: "#2563eb", legal: "#7c3aed", hr: "#d97706",
  strategy: "#4f46e5", product: "#0891b2", security: "#dc2626",
  rnd: "#ca8a04", it: "#0284c7", sales: "#db2777", growth: "#65a30d", custom: "#64748b",
};

function domainColor(domain: string) { return DOMAIN_COLOR[domain] ?? "#64748b"; }

function truncateMsg(msg: string, len = 68): string {
  const oneLine = msg.replace(/\s+/g, " ").trim();
  if (oneLine.length <= len) return oneLine;
  return oneLine.slice(0, len).trimEnd() + "…";
}

// ── components ────────────────────────────────────────────────────────────────

function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ marginBottom: 5 }}>
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: 11, color: "var(--text-muted)", background: "none",
          border: "1px solid var(--border)", borderRadius: 4,
          padding: "2px 8px", cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 9 }}>{expanded ? "▾" : "▸"}</span>
        chain of thought
        <span style={{ fontSize: 10, opacity: 0.7 }}>({thinking.length.toLocaleString()} chars)</span>
      </button>
      {expanded && (
        <div style={{
          marginTop: 5, padding: "10px 12px",
          background: "var(--surface-overlay)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", fontSize: 11, fontFamily: "monospace",
          color: "var(--text-muted)", whiteSpace: "pre-wrap", lineHeight: 1.5,
          maxHeight: 280, overflowY: "auto",
        }}>
          {thinking}
        </div>
      )}
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [loading, setLoading] = useState(true);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shownChairsRef = useRef(0);

  const loadData = useCallback(async () => {
    const bp = await apiFetch<BoardArtifact>("/api/v1/artifacts/business_profile/latest");
    setBoardReady(!!bp?.artifact_id);
    setLoading(false);
  }, []);

  const loadThreads = useCallback(async () => {
    const res = await apiFetch<{ threads: ThreadSummary[] }>("/api/v1/board/chat/threads");
    setThreads(res?.threads ?? []);
  }, []);

  const loadThread = useCallback(async (tid: string) => {
    const res = await apiFetch<{ jobs: ThreadJob[] }>(`/api/v1/board/chat/threads/${tid}/jobs`);
    if (!res?.jobs?.length) return;
    const msgs: ChatMessage[] = [];
    for (const job of res.jobs) {
      msgs.push({ role: "user", content: job.message });
      for (const p of job.partial_results ?? []) {
        msgs.push({
          role: "chair",
          content: p.answer,
          chair_id: p.chair_id,
          chair_name: p.chair_name,
          chair_domain: p.domain,
          thinking: p.thinking,
        });
      }
      if (job.result) {
        msgs.push({ role: "board", content: job.result.summary_markdown, headline: job.result.headline, chair_id: null });
      } else if (job.status === "error") {
        msgs.push({ role: "board", content: `Board deliberation failed: ${job.error ?? "unknown error"}` });
      }
    }
    setMessages(msgs);
    setThreadId(tid);
    window.history.replaceState(null, "", `?t=${tid}`);
  }, []);

  useEffect(() => {
    loadData();
    loadThreads();
    const iv = setInterval(() => { void loadData(); void loadThreads(); }, 30000);
    return () => clearInterval(iv);
  }, [loadData, loadThreads]);

  // On mount: restore in-flight job (priority), then URL thread, then ?ask= prefill
  useEffect(() => {
    const saved = localStorage.getItem("cb-pending-job");
    if (saved) {
      try {
        const { job_id, thread_id: tid, userMessage } = JSON.parse(saved) as {
          job_id: string; thread_id: string; userMessage: string;
        };
        shownChairsRef.current = 0;
        setThreadId(tid);
        setMessages([{ role: "user", content: userMessage }]);
        setChatLoading(true);
        setLoadingSeconds(0);
        setPendingJobId(job_id);
        window.history.replaceState(null, "", `?t=${tid}`);
        return;
      } catch {
        localStorage.removeItem("cb-pending-job");
      }
    }
    const params = new URLSearchParams(window.location.search);
    const tid = params.get("t");
    if (tid) { void loadThread(tid); return; }
    const ask = params.get("ask");
    if (ask) {
      setChatInput(`I have a question for the ${ask}: `);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [loadThread]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll the board chat job until done or error
  useEffect(() => {
    if (!pendingJobId) return;
    let cancelled = false;
    const POLL_MS = 2000;
    // Only idle-timeout when the job is still pending (never started executing).
    // Once running, each Featherless call is bounded by a 120s HTTP abort in
    // the provider adapter — so a slow chair is not a stuck job.
    const PENDING_IDLE_MS = 60 * 1000;
    let lastActivity = Date.now();
    let prevStatus = "pending";

    async function poll() {
      while (!cancelled) {
        if (prevStatus !== "running" && Date.now() - lastActivity > PENDING_IDLE_MS) break;

        await new Promise<void>((r) => setTimeout(r, POLL_MS));
        if (cancelled) return;
        const job = await apiFetch<BoardJobPoll>(`/api/v1/board/chat/jobs/${pendingJobId}`);
        if (!job || cancelled) break;

        const partials = job.partial_results ?? [];

        // Reveal each chair's result as it arrives; each arrival resets the idle timer
        if (partials.length > shownChairsRef.current) {
          const newChairs = partials.slice(shownChairsRef.current);
          setMessages((p) => [
            ...p,
            ...newChairs.map((r) => ({
              role: "chair" as const,
              content: r.answer,
              headline: r.chair_name,
              chair_id: r.chair_id,
              chair_name: r.chair_name,
              chair_domain: r.domain,
              thinking: r.thinking,
            })),
          ]);
          shownChairsRef.current = partials.length;
          lastActivity = Date.now();
        }

        // Status change (e.g. pending → running) also counts as activity
        if (job.status !== prevStatus) {
          lastActivity = Date.now();
          prevStatus = job.status;
        }

        if (job.status === "done" && job.result) {
          setMessages((p) => [...p, {
            role: "board",
            content: job.result!.summary_markdown,
            headline: job.result!.headline,
            chair_id: null,
          }]);
          setThreadId(job.result.thread_id);
          localStorage.removeItem("cb-pending-job");
          setChatLoading(false);
          setPendingJobId(null);
          void loadThreads();
          return;
        }
        if (job.status === "error") {
          setMessages((p) => [...p, {
            role: "board",
            content: `Board deliberation failed: ${job.error ?? "unknown error"}`,
          }]);
          localStorage.removeItem("cb-pending-job");
          setChatLoading(false);
          setPendingJobId(null);
          void loadThreads();
          return;
        }
      }
      if (!cancelled) {
        setMessages((p) => [...p, {
          role: "board",
          content: "Board job did not start within 60 seconds — the API may be unavailable. Please try again.",
        }]);
        localStorage.removeItem("cb-pending-job");
        setChatLoading(false);
        setPendingJobId(null);
      }
    }

    void poll();
    return () => { cancelled = true; };
  }, [pendingJobId, loadThreads]);

  // Elapsed-time counter shown while the board is deliberating
  useEffect(() => {
    if (!chatLoading) { setLoadingSeconds(0); return; }
    setLoadingSeconds(0);
    const iv = setInterval(() => setLoadingSeconds((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [chatLoading]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendMessage() {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    setMessages((p) => [...p, { role: "user", content: text }]);
    setChatInput("");
    setChatLoading(true);
    setLoadingSeconds(0);

    const res = await apiFetch<BoardJobSubmit>("/api/v1/board/chat", {
      method: "POST",
      body: JSON.stringify({ message: text, thread_id: threadId }),
    });

    if (!res?.job_id) {
      setMessages((p) => [...p, { role: "board", content: "Unable to reach the board. Please try again." }]);
      setChatLoading(false);
      return;
    }

    setThreadId(res.thread_id);
    window.history.replaceState(null, "", `?t=${res.thread_id}`);
    shownChairsRef.current = 0;
    // Persist so a page refresh can resume the in-flight deliberation
    localStorage.setItem("cb-pending-job", JSON.stringify({
      job_id: res.job_id, thread_id: res.thread_id, userMessage: text,
    }));
    setPendingJobId(res.job_id);
  }

  function startNewThread() {
    setMessages([]);
    setThreadId(null);
    window.history.replaceState(null, "", window.location.pathname);
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
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "220px 1fr", overflow: "hidden", minHeight: 0 }}>

        {/* Thread list sidebar */}
        <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", background: "var(--surface-raised)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>Conversations</span>
            <button
              onClick={startNewThread}
              style={{ fontSize: 11, fontWeight: 600, color: "var(--brand)", background: "none", border: "1px solid var(--brand)", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}
            >
              New +
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {threads.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "24px 12px", margin: 0 }}>
                No conversations yet
              </p>
            ) : (
              threads.map((t) => {
                const active = t.thread_id === threadId;
                return (
                  <button
                    key={t.thread_id}
                    onClick={() => void loadThread(t.thread_id)}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "9px 12px", border: "none",
                      borderBottom: "1px solid var(--border)",
                      background: active ? "var(--brand-light)" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <p style={{
                      fontSize: 12, fontWeight: active ? 600 : 400, margin: "0 0 2px",
                      color: active ? "var(--brand)" : "var(--text-primary)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {truncateMsg(t.first_message)}
                    </p>
                    <p style={{ fontSize: 10, color: "var(--text-muted)", margin: 0 }}>
                      {relativeTime(t.last_activity)}
                      {t.job_count > 1 && <span style={{ marginLeft: 5, opacity: 0.7 }}>· {t.job_count} msgs</span>}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Chat panel */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
            {messages.length === 0 ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", margin: "0 0 4px" }}>Ask your board:</p>
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
              messages.map((msg, i) => {
                if (msg.role === "chair") {
                  const color = domainColor(msg.chair_domain ?? "ops");
                  return (
                    <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: "85%", alignSelf: "flex-start" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        {msg.chair_name}
                        <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 5 }}>{msg.chair_domain}</span>
                      </span>
                      {msg.thinking && <ThinkingBlock thinking={msg.thinking} />}
                      <div style={{
                        background: "var(--surface)", color: "var(--text-primary)",
                        padding: "9px 13px", borderRadius: "4px 13px 13px 13px",
                        border: `1px solid ${color}30`,
                        fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap",
                        wordBreak: "break-word", boxShadow: "var(--shadow-sm)",
                      }}>
                        {msg.content}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start", gap: 4, maxWidth: "80%", alignSelf: msg.role === "user" ? "flex-end" : "flex-start" }}>
                    {msg.role === "board" && msg.headline && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {msg.headline}
                      </span>
                    )}
                    <div style={{
                      background: msg.role === "user" ? "var(--brand)" : "var(--surface)",
                      color: msg.role === "user" ? "#fff" : "var(--text-primary)",
                      padding: "9px 13px",
                      borderRadius: msg.role === "user" ? "13px 13px 4px 13px" : "4px 13px 13px 13px",
                      border: msg.role === "board" ? "1px solid var(--border)" : "none",
                      fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap",
                      wordBreak: "break-word", boxShadow: "var(--shadow-sm)",
                    }}>
                      {msg.content}
                    </div>
                  </div>
                );
              })
            )}
            {chatLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13 }}>
                <span style={{ display: "flex", gap: 3 }}>
                  {[0,1,2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-muted)", animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
                </span>
                Board deliberating…
                {loadingSeconds > 0 && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                    ({loadingSeconds}s)
                  </span>
                )}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input */}
          <div style={{ padding: "10px 20px 14px", borderTop: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
            {threadId && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Continuing conversation</span>
                <button onClick={startNewThread} style={{ fontSize: 11, color: "var(--text-muted)", background: "none", padding: "2px 6px", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}>New thread</button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                ref={inputRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
                placeholder="Message the board… (Enter to send)"
                rows={1}
                style={{ flex: 1, resize: "none", padding: "8px 11px", fontSize: 14, minHeight: 38, maxHeight: 140, lineHeight: 1.4, overflow: "auto" }}
                onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 140) + "px"; }}
              />
              <button onClick={() => void sendMessage()} disabled={!chatInput.trim() || chatLoading} style={{ background: "var(--brand)", color: "#fff", padding: "8px 14px", fontWeight: 600, fontSize: 13, flexShrink: 0, height: 38 }}>
                Send
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,80%,100%{opacity:.2;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  );
}
