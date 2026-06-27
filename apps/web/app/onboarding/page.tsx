"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "../../lib/api";

// Interview sections in order — mirrors the API's section sequence.
const SECTIONS = [
  { id: "business_profile",  label: "About your org" },
  { id: "objective_config",  label: "Goals & KPIs" },
  { id: "autonomy_policy",   label: "Autonomy & approvals" },
  { id: "cadence_protocol",  label: "Meeting cadence" },
  { id: "agent_blueprint",   label: "Board chairs" },
];

type SessionState = {
  session_id?: string;
  status?: string;
  current_section?: string;
  sections_complete?: string[];
  prompt?: string;
  complete?: boolean;
};

export default function OnboardingPage() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: "system" | "user"; text: string }>>([]);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startSession = useCallback(async () => {
    const { data } = await apiPost<SessionState>("/api/v1/interview/start", {});
    if (!data?.session_id) { setError("Failed to start interview session. Is the API reachable?"); return; }
    setSessionId(data.session_id);
    setState(data);
    if (data.prompt) setMessages([{ role: "system", text: data.prompt }]);
  }, []);

  useEffect(() => { startSession(); }, [startSession]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    if (!input.trim() || !sessionId || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);
    setError("");
    setMessages(prev => [...prev, { role: "user", text }]);
    const { data } = await apiPost<SessionState>(`/api/v1/interview/${sessionId}/respond`, { message: text });
    setSending(false);
    if (!data) { setError("No response from server."); return; }
    setState(data);
    if (data.prompt) setMessages(prev => [...prev, { role: "system" as const, text: data.prompt! }]);
    if (data.complete) {
      setMessages(prev => [...prev, { role: "system" as const, text: "All sections complete. Review your responses above and click Generate Board to activate." }]);
    }
  }

  async function confirm() {
    if (!sessionId || confirming) return;
    setConfirming(true);
    const { data, status } = await apiPost<{ artifacts: unknown[] }>(`/api/v1/interview/${sessionId}/confirm`, {});
    setConfirming(false);
    if (status >= 400 || !data) { setError("Failed to generate artifacts. Please try again."); return; }
    setDone(true);
    setTimeout(() => router.replace("/dashboard"), 2000);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  // Section progress derived from API state
  const completedSections = new Set(state?.sections_complete ?? []);
  const currentSection = state?.current_section ?? null;
  const completedCount = completedSections.size;
  const totalCount = SECTIONS.length;
  const progressPct = Math.round((completedCount / totalCount) * 100);

  return (
    <div style={{ height: "calc(100vh - 52px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header with progress */}
      <div style={{ padding: "14px 24px 0", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Board Interview</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 0" }}>
              Answer questions about your organization to configure the board.
            </p>
          </div>
          {completedCount > 0 && (
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
              {completedCount} of {totalCount} sections
            </span>
          )}
        </div>

        {/* Section progress pills */}
        <div style={{ display: "flex", gap: 6, paddingBottom: 12 }}>
          {SECTIONS.map((s) => {
            const isDone = completedSections.has(s.id);
            const isCurrent = currentSection === s.id && !isDone;
            return (
              <div
                key={s.id}
                title={s.label}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  background: isDone ? "var(--success)" : isCurrent ? "var(--brand)" : "var(--border)",
                  transition: "background 0.3s",
                  position: "relative",
                }}
              />
            );
          })}
        </div>

        {/* Section label row */}
        {currentSection && (
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {SECTIONS.map((s) => {
              const isDone = completedSections.has(s.id);
              const isCurrent = currentSection === s.id && !isDone;
              if (!isDone && !isCurrent) return null;
              return (
                <span key={s.id} style={{ fontSize: 10, fontWeight: 600, color: isDone ? "var(--success)" : "var(--brand)", display: "flex", alignItems: "center", gap: 3 }}>
                  {isDone ? "✓" : "●"} {s.label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Message thread */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "75%",
              padding: "10px 14px",
              borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              background: m.role === "user" ? "var(--brand)" : "var(--surface)",
              color: m.role === "user" ? "#fff" : "var(--text-primary)",
              border: m.role === "user" ? "none" : "1px solid var(--border)",
              fontSize: 13,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
            }}>
              {m.text}
            </div>
          </div>
        ))}
        {sending && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{ padding: "10px 14px", borderRadius: "16px 16px 16px 4px", background: "var(--surface)", border: "1px solid var(--border)", fontSize: 13, color: "var(--text-muted)" }}>
              Thinking…
            </div>
          </div>
        )}
        {error && (
          <p style={{ fontSize: 12, color: "var(--error)", textAlign: "center", padding: "6px 12px", background: "#fee2e218", borderRadius: "var(--radius)", margin: 0 }}>{error}</p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer — input or confirm or done */}
      {done ? (
        <div style={{ padding: "20px 24px", borderTop: "1px solid var(--border)", background: "var(--surface)", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--success)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>✓</div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--success)", margin: 0 }}>Board artifacts generated</p>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 0" }}>Taking you to the dashboard…</p>
          </div>
        </div>
      ) : state?.complete ? (
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", background: "var(--surface)", display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Interview complete</p>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 0" }}>All {totalCount} sections answered. Ready to activate your board.</p>
          </div>
          <button
            onClick={confirm}
            disabled={confirming}
            style={{ background: "var(--brand)", color: "#fff", padding: "10px 24px", fontSize: 14, fontWeight: 600, borderRadius: "var(--radius)", border: "none", cursor: confirming ? "default" : "pointer", flexShrink: 0, opacity: confirming ? 0.7 : 1 }}
          >
            {confirming ? "Generating…" : "Generate Board →"}
          </button>
        </div>
      ) : (
        <div style={{ padding: "12px 24px", borderTop: "1px solid var(--border)", background: "var(--surface)", display: "flex", gap: 10 }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={sessionId ? "Type your response… (Enter to send)" : "Starting session…"}
            rows={2}
            style={{ flex: 1, resize: "none", padding: "9px 12px", fontSize: 13, borderRadius: "var(--radius)", boxSizing: "border-box", lineHeight: 1.4 }}
            disabled={sending || !sessionId}
          />
          <button
            onClick={send}
            disabled={sending || !input.trim() || !sessionId}
            style={{ background: "var(--brand)", color: "#fff", padding: "0 20px", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius)", border: "none", cursor: "pointer", flexShrink: 0 }}
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
      )}
    </div>
  );
}
