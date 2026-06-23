"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, apiPost } from "../../lib/api";

type SessionState = {
  session_id?: string;
  status?: string;
  current_section?: string;
  sections_complete?: string[];
  prompt?: string;
  complete?: boolean;
  artifacts?: unknown[];
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

  const startSession = useCallback(async () => {
    const { data } = await apiPost<SessionState>("/api/v1/interview/start", {});
    if (!data?.session_id) { setError("Failed to start interview session."); return; }
    setSessionId(data.session_id);
    setState(data);
    if (data.prompt) setMessages([{ role: "system", text: data.prompt }]);
  }, []);

  useEffect(() => { startSession(); }, [startSession]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    if (data.complete) setMessages(prev => [...prev, { role: "system" as const, text: "Interview complete. Ready to generate your board artifacts." }]);
  }

  async function confirm() {
    if (!sessionId || confirming) return;
    setConfirming(true);
    const { data, status } = await apiPost<{ artifacts: unknown[] }>(`/api/v1/interview/${sessionId}/confirm`, {});
    setConfirming(false);
    if (status >= 400 || !data) { setError("Failed to confirm interview."); return; }
    setDone(true);
    setTimeout(() => router.replace("/artifacts"), 1500);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div style={{ height: "calc(100vh - 48px)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Onboarding Interview</h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "3px 0 0" }}>
          Answer questions about your organization. Your responses generate the 6 governing artifacts that power the board.
          {state?.sections_complete?.length ? ` Sections complete: ${state.sections_complete.join(", ")}.` : ""}
        </p>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            display: "flex",
            justifyContent: m.role === "user" ? "flex-end" : "flex-start"
          }}>
            <div style={{
              maxWidth: "70%",
              padding: "10px 14px",
              borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              background: m.role === "user" ? "var(--brand)" : "var(--surface)",
              color: m.role === "user" ? "#fff" : "var(--text-primary)",
              border: m.role === "user" ? "none" : "1px solid var(--border)",
              fontSize: 13,
              lineHeight: 1.5,
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
        {error && <p style={{ fontSize: 12, color: "var(--error)", textAlign: "center" }}>{error}</p>}
        <div ref={bottomRef} />
      </div>

      {/* Input or confirm */}
      {done ? (
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", textAlign: "center", fontSize: 13, color: "#16a34a" }}>
          Artifacts generated. Redirecting to artifacts…
        </div>
      ) : state?.complete ? (
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 12, justifyContent: "center" }}>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>Ready to generate artifacts.</p>
          <button onClick={confirm} disabled={confirming} style={{ background: "var(--brand)", color: "#fff", padding: "8px 20px", fontSize: 14, fontWeight: 600 }}>
            {confirming ? "Generating…" : "Generate artifacts"}
          </button>
        </div>
      ) : (
        <div style={{ padding: "12px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 10 }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Type your response… (Enter to send)"
            rows={2}
            style={{ flex: 1, resize: "none", padding: "9px 12px", fontSize: 13, borderRadius: "var(--radius)", boxSizing: "border-box" }}
            disabled={sending || !sessionId}
          />
          <button onClick={send} disabled={sending || !input.trim() || !sessionId} style={{ background: "var(--brand)", color: "#fff", padding: "0 18px", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius)" }}>
            Send
          </button>
        </div>
      )}
    </div>
  );
}
