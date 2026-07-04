"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, apiHeaders, relativeTime } from "../../lib/api";

// ── types ─────────────────────────────────────────────────────────────────────

type Message = {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
};

type StreamChunk =
  | { token: string }
  | { done: true; session_id: string; model: string }
  | { error: string };

type SessionSummary = {
  session_id: string;
  title: string;
  message_count: number;
  model: string | null;
  created_at: string;
  updated_at: string;
};

type Session = {
  session_id: string;
  title: string;
  messages: Array<{ role: "user" | "assistant"; content: string; thinking?: string; created_at: string }>;
  model: string | null;
};

// ── helpers ───────────────────────────────────────────────────────────────────

function truncateTitle(t: string, len = 68): string {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length <= len ? s : s.slice(0, len).trimEnd() + "…";
}

/**
 * Splits a raw streamed buffer into thinking and answer parts.
 * Models like Qwen3 emit <think>...</think> before the final answer.
 */
function parseRaw(raw: string): { thinking: string; answer: string; inThinking: boolean } {
  if (!raw.startsWith("<think>")) return { thinking: "", answer: raw, inThinking: false };
  const end = raw.indexOf("</think>");
  if (end === -1) return { thinking: raw.slice(6), answer: "", inThinking: true };
  return {
    thinking: raw.slice(6, end).trim(),
    answer: raw.slice(end + 8).trimStart(),
    inThinking: false,
  };
}

// ── sub-components ────────────────────────────────────────────────────────────

function ThinkingBlock({ thinking, defaultOpen = false }: { thinking: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: 11, color: "var(--text-muted)", background: "none",
          border: "1px solid var(--border)", borderRadius: 4,
          padding: "2px 8px", cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 9 }}>{open ? "▾" : "▸"}</span>
        chain of thought
        <span style={{ fontSize: 10, opacity: 0.7 }}>({thinking.length.toLocaleString()} chars)</span>
      </button>
      {open && (
        <div style={{
          marginTop: 5, padding: "10px 12px",
          background: "var(--surface-overlay)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", fontSize: 11, fontFamily: "monospace",
          color: "var(--text-muted)", whiteSpace: "pre-wrap", lineHeight: 1.5,
          maxHeight: 320, overflowY: "auto",
        }}>
          {thinking}
        </div>
      )}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Live streaming state: null = not streaming, string = accumulated raw buffer
  const [streamRaw, setStreamRaw] = useState<string | null>(null);
  const streamBufRef = useRef(""); // sync ref so we can read final value after setState batching

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadSessions = useCallback(async () => {
    const res = await apiFetch<{ sessions: SessionSummary[] }>("/api/v1/ai/chat/sessions");
    setSessions(res?.sessions ?? []);
  }, []);

  const loadSession = useCallback(async (sid: string) => {
    const res = await apiFetch<Session>(`/api/v1/ai/chat/sessions/${sid}`);
    if (!res) return;
    setMessages(res.messages.map((m) => ({ role: m.role, content: m.content, thinking: m.thinking })));
    setSessionId(sid);
    setActiveModel(res.model);
    window.history.replaceState(null, "", `?s=${sid}`);
  }, []);

  function startNew() {
    setMessages([]);
    setSessionId(null);
    setActiveModel(null);
    setStreamRaw(null);
    window.history.replaceState(null, "", window.location.pathname);
    inputRef.current?.focus();
  }

  // Restore URL session on mount
  useEffect(() => {
    const sid = new URLSearchParams(window.location.search).get("s");
    if (sid) void loadSession(sid);
  }, [loadSession]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamRaw]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setMessages((p) => [...p, { role: "user", content: text }]);
    setLoading(true);
    streamBufRef.current = "";
    setStreamRaw(""); // start live display

    let finalSessionId = sessionId;
    let finalModel: string | null = activeModel;

    try {
      const res = await fetch("/api/v1/ai/chat/stream", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ message: text, session_id: sessionId ?? undefined }),
      });

      if (!res.ok || !res.body) {
        throw new Error(res.ok ? "no stream body" : `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuf = "";

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuf += decoder.decode(value, { stream: true });
        const lines = sseBuf.split("\n");
        sseBuf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          let chunk: StreamChunk;
          try { chunk = JSON.parse(raw) as StreamChunk; } catch { continue; }

          if ("error" in chunk) throw new Error(chunk.error);

          if ("token" in chunk) {
            streamBufRef.current += chunk.token;
            setStreamRaw(streamBufRef.current);
          }

          if ("done" in chunk) {
            finalSessionId = chunk.session_id;
            finalModel = chunk.model;
            break outer;
          }
        }
      }
    } catch (err) {
      setStreamRaw(null);
      setMessages((p) => [
        ...p,
        { role: "assistant", content: `_Could not reach the AI: ${err instanceof Error ? err.message : "unknown error"}_` },
      ]);
      setLoading(false);
      return;
    }

    // Move streamed content into the permanent messages list
    const { thinking, answer } = parseRaw(streamBufRef.current);
    setStreamRaw(null);
    setMessages((p) => [
      ...p,
      { role: "assistant", content: answer || streamBufRef.current, thinking: thinking || undefined },
    ]);
    setSessionId(finalSessionId);
    setActiveModel(finalModel);
    if (finalSessionId) window.history.replaceState(null, "", `?s=${finalSessionId}`);
    setLoading(false);
    void loadSessions();
  }

  // Live parse for display during streaming
  const live = streamRaw !== null ? parseRaw(streamRaw) : null;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* Session sidebar */}
      <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", background: "var(--surface-raised)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>Sessions</span>
          <button
            onClick={startNew}
            style={{ fontSize: 11, fontWeight: 600, color: "var(--brand)", background: "none", border: "1px solid var(--brand)", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}
          >
            New +
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {sessions.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "24px 12px", margin: 0 }}>No sessions yet</p>
          ) : (
            sessions.map((s) => {
              const active = s.session_id === sessionId;
              return (
                <button
                  key={s.session_id}
                  onClick={() => void loadSession(s.session_id)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "9px 12px", border: "none", borderBottom: "1px solid var(--border)",
                    background: active ? "var(--brand-light)" : "transparent", cursor: "pointer",
                  }}
                >
                  <p style={{ fontSize: 12, fontWeight: active ? 600 : 400, margin: "0 0 2px", color: active ? "var(--brand)" : "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {truncateTitle(s.title)}
                  </p>
                  <p style={{ fontSize: 10, color: "var(--text-muted)", margin: 0 }}>
                    {relativeTime(s.updated_at)}
                    {s.message_count > 1 && <span style={{ marginLeft: 5, opacity: 0.7 }}>· {Math.floor(s.message_count / 2)} turn{Math.floor(s.message_count / 2) !== 1 ? "s" : ""}</span>}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Chat panel */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Model bar */}
        <div style={{ padding: "7px 20px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0, display: "flex", alignItems: "center", gap: 10, minHeight: 36 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {activeModel
              ? <>Model: <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{activeModel}</span></>
              : <span style={{ opacity: 0.6 }}>Direct AI — uses provider from Settings</span>}
          </span>
          {sessionId && (
            <button onClick={startNew} style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)", background: "none", padding: "2px 8px", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}>
              New session
            </button>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
          {messages.length === 0 && live === null && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 500, margin: "40px auto 0" }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", margin: 0, textAlign: "center" }}>Direct AI Chat</p>
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, textAlign: "center", lineHeight: 1.6 }}>
                Talk directly to the board's AI model — no routing, no committees. Ask anything.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 16 }}>
                {[
                  "What's the most important thing I should be working on right now?",
                  "Help me think through a decision I'm facing.",
                  "What questions should I be asking about my business?",
                ].map((s) => (
                  <button key={s} onClick={() => { setInput(s); inputRef.current?.focus(); }}
                    style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "9px 14px", fontSize: 13, color: "var(--text-secondary)", textAlign: "left", cursor: "pointer" }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Completed messages */}
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "82%", alignSelf: m.role === "user" ? "flex-end" : "flex-start", gap: 4 }}>
              {m.role === "assistant" && m.thinking && (
                <ThinkingBlock thinking={m.thinking} />
              )}
              <div style={{
                background: m.role === "user" ? "var(--brand)" : "var(--surface)",
                color: m.role === "user" ? "#fff" : "var(--text-primary)",
                padding: "9px 13px",
                borderRadius: m.role === "user" ? "13px 13px 4px 13px" : "4px 13px 13px 13px",
                border: m.role === "assistant" ? "1px solid var(--border)" : "none",
                fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap",
                wordBreak: "break-word", boxShadow: "var(--shadow-sm)",
              }}>
                {m.content}
              </div>
            </div>
          ))}

          {/* Live streaming message */}
          {live !== null && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", maxWidth: "82%", alignSelf: "flex-start", gap: 4 }}>
              {/* Thinking section — visible and growing while model thinks */}
              {(live.thinking || live.inThinking) && (
                <div style={{
                  padding: "8px 12px",
                  background: "var(--surface-overlay)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius)", fontSize: 11, fontFamily: "monospace",
                  color: "var(--text-muted)", whiteSpace: "pre-wrap", lineHeight: 1.5,
                  maxHeight: 240, overflowY: "auto", width: "100%",
                }}>
                  <span style={{ fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {live.inThinking
                      ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          Thinking
                          <span style={{ display: "inline-flex", gap: 2 }}>
                            {[0, 1, 2].map((i) => (
                              <span key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--text-muted)", animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                            ))}
                          </span>
                        </span>
                      : "Thought process"}
                  </span>
                  {live.thinking}
                </div>
              )}
              {/* Answer section */}
              {(!live.inThinking) && (
                <div style={{
                  background: "var(--surface)", color: "var(--text-primary)",
                  padding: "9px 13px", borderRadius: "4px 13px 13px 13px",
                  border: "1px solid var(--border)",
                  fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap",
                  wordBreak: "break-word", boxShadow: "var(--shadow-sm)",
                }}>
                  {live.answer}
                  <span style={{ display: "inline-block", width: 2, height: 14, background: "var(--brand)", marginLeft: 2, verticalAlign: "text-bottom", animation: "blink 1s step-end infinite" }} />
                </div>
              )}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{ padding: "10px 20px 14px", borderTop: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder="Message the AI… (Enter to send, Shift+Enter for newline)"
              rows={1}
              disabled={loading}
              style={{ flex: 1, resize: "none", padding: "8px 11px", fontSize: 14, minHeight: 38, maxHeight: 160, lineHeight: 1.4, overflow: "auto", opacity: loading ? 0.6 : 1 }}
              onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; }}
            />
            <button
              onClick={() => void send()}
              disabled={!input.trim() || loading}
              style={{ background: "var(--brand)", color: "#fff", padding: "8px 14px", fontWeight: 600, fontSize: 13, flexShrink: 0, height: 38, borderRadius: "var(--radius)", border: "none", cursor: "pointer", opacity: !input.trim() || loading ? 0.5 : 1 }}
            >
              {loading ? "…" : "Send"}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,80%,100%{opacity:.2;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>
    </div>
  );
}
