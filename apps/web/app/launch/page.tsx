"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, apiFetch } from "../../lib/api";

type LaunchSession = {
  session_id?: string;
  status?: string;
  current_section?: string;
  sections_complete?: string[];
  prompt?: string;
  complete?: boolean;
};

type ExistingSession = {
  session_id: string;
  status: string;
  started_at: string;
};

export default function LaunchPage() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<LaunchSession | null>(null);
  const [messages, setMessages] = useState<Array<{ role: "system" | "user"; text: string }>>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [existing, setExisting] = useState<ExistingSession | null>(null);
  const [checked, setChecked] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch<{ session: ExistingSession | null }>("/api/v1/launch/current").then(d => {
      setExisting(d?.session ?? null);
      setChecked(true);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const resumeSession = useCallback(async (id: string) => {
    const { data } = await apiPost<LaunchSession>(`/api/v1/launch/${id}/status`, {});
    if (data) {
      setSessionId(id);
      setState(data);
      if (data.prompt) setMessages([{ role: "system", text: data.prompt }]);
    }
  }, []);

  async function startSession() {
    setStarting(true);
    setError("");
    const { data } = await apiPost<LaunchSession>("/api/v1/launch/start", {});
    setStarting(false);
    if (!data?.session_id) { setError("Failed to start launch session."); return; }
    setSessionId(data.session_id);
    setState(data);
    if (data.prompt) setMessages([{ role: "system", text: data.prompt }]);
    setExisting(null);
  }

  async function send() {
    if (!input.trim() || !sessionId || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);
    setError("");
    setMessages(prev => [...prev, { role: "user", text }]);
    const { data } = await apiPost<LaunchSession>(`/api/v1/launch/${sessionId}/respond`, { message: text });
    setSending(false);
    if (!data) { setError("No response from server."); return; }
    setState(data);
    if (data.prompt) setMessages(prev => [...prev, { role: "system", text: data.prompt }]);
    if (data.complete) setMessages(prev => [...prev, { role: "system", text: "All sections complete. Ready to finalize your board setup." }]);
  }

  async function confirm() {
    if (!sessionId || confirming) return;
    setConfirming(true);
    const { data, status } = await apiPost(`/api/v1/launch/${sessionId}/confirm`, {});
    setConfirming(false);
    if (status >= 400 || !data) { setError("Failed to confirm launch."); return; }
    setDone(true);
    setTimeout(() => router.replace("/dashboard"), 2000);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  if (!checked) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  if (!sessionId) {
    return (
      <div style={{ padding: 32, maxWidth: 600 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>Board Setup</h2>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 24px" }}>
          The launch flow guides you through defining your organization&apos;s board configuration in a structured interview. At the end, your board is activated.
        </p>
        {error && <p style={{ fontSize: 12, color: "var(--error)", marginBottom: 16 }}>{error}</p>}
        {existing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px" }}>
              <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>Resume existing session</p>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>Session started and is in progress.</p>
              <button onClick={() => resumeSession(existing.session_id)} style={{ background: "var(--brand)", color: "#fff", padding: "8px 20px", fontSize: 13, fontWeight: 600 }}>Resume</button>
            </div>
            <button onClick={startSession} disabled={starting} style={{ padding: "8px 20px", fontSize: 13, background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>Start new session</button>
          </div>
        ) : (
          <button onClick={startSession} disabled={starting} style={{ background: "var(--brand)", color: "#fff", padding: "10px 24px", fontSize: 14, fontWeight: 600 }}>
            {starting ? "Starting…" : "Begin board setup"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ height: "calc(100vh - 48px)", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Board Setup Interview</h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "3px 0 0" }}>
          Answer questions to configure your board.
          {state?.sections_complete?.length ? ` Sections done: ${state.sections_complete.join(", ")}.` : ""}
        </p>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "70%", padding: "10px 14px",
              borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              background: m.role === "user" ? "var(--brand)" : "var(--surface)",
              color: m.role === "user" ? "#fff" : "var(--text-primary)",
              border: m.role === "user" ? "none" : "1px solid var(--border)",
              fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap",
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

      {done ? (
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", textAlign: "center", fontSize: 13, color: "#16a34a" }}>
          Board activated. Redirecting to dashboard…
        </div>
      ) : state?.complete ? (
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 12, justifyContent: "center" }}>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>All sections complete.</p>
          <button onClick={confirm} disabled={confirming} style={{ background: "var(--brand)", color: "#fff", padding: "8px 20px", fontSize: 14, fontWeight: 600 }}>
            {confirming ? "Activating…" : "Activate board"}
          </button>
        </div>
      ) : (
        <div style={{ padding: "12px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 10 }}>
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey} placeholder="Type your response… (Enter to send)" rows={2}
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
