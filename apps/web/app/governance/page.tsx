"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, relativeTime } from "../../lib/api";

// ── types ─────────────────────────────────────────────────────────────────────

type ThreadSummary = {
  thread_id: string;
  first_message: string;
  created_at: string;
  last_activity: string;
  job_count: number;
  last_headline: string | null;
};

type GovernanceEvent = {
  event_id?: string;
  event_type?: string;
  actor?: string;
  details?: Record<string, unknown>;
  at?: string;
};

type DecisionEntry = {
  entry_id: string;
  event: GovernanceEvent;
  signed?: { sig: string; key_id: string; alg: string };
  sequence?: number;
};

// ── helpers ───────────────────────────────────────────────────────────────────

const EVENT_COLORS: Record<string, string> = {
  artifact_written: "#2563eb",
  artifact_created: "#2563eb",
  action_proposed: "#d97706",
  action_proposed_autonomous: "#d97706",
  approval_recorded: "#16a34a",
  action_executed: "#16a34a",
  org_activated: "#7c3aed",
  setting_updated: "#64748b",
};

function eventColor(t?: string) { return EVENT_COLORS[t ?? ""] ?? "#64748b"; }

function eventLabel(event: GovernanceEvent): string {
  const d = event.details ?? {};
  switch (event.event_type) {
    case "artifact_written": {
      const kind = (d.artifact_type ?? d.type ?? "document") as string;
      const ver = d.version ? ` v${d.version}` : "";
      return `Updated ${kind.replace(/_/g, " ")}${ver}`;
    }
    case "artifact_created": {
      const kind = (d.artifact_type ?? d.type ?? "document") as string;
      return `Created ${kind.replace(/_/g, " ")}`;
    }
    case "action_proposed":
    case "action_proposed_autonomous": {
      const at = d.action_type as string | undefined;
      const label = at ? at.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "Action";
      const autonomous = event.event_type === "action_proposed_autonomous" ? " (autonomous)" : "";
      return `Approval requested: ${label}${autonomous}`;
    }
    case "approval_recorded": {
      const decision = d.decision === "approve" ? "Approved" : "Declined";
      const summary = d.summary ? `: ${String(d.summary).slice(0, 80)}` : "";
      return `${decision}${summary}`;
    }
    case "action_executed":
      return `Action completed${d.action_type ? `: ${String(d.action_type).replace(/_/g, " ")}` : ""}`;
    case "org_activated":
      return "Board activated";
    case "setting_updated": {
      const key = d.key ?? d.field ?? d.setting;
      return key ? `Setting updated: ${String(key).replace(/_/g, " ")}` : "Settings updated";
    }
    default:
      return (event.event_type ?? "Board activity").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }
}

function truncate(s: string, n: number) {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length <= n ? line : line.slice(0, n).trimEnd() + "…";
}

const LOG_PAGE = 15;

// ── page ──────────────────────────────────────────────────────────────────────

export default function BoardMinutesPage() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);

  const [entries, setEntries] = useState<DecisionEntry[]>([]);
  const [logLoading, setLogLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ threads: ThreadSummary[] }>("/api/v1/board/chat/threads").then((r) => {
      setThreads(r?.threads ?? []);
      setThreadsLoading(false);
    });
  }, []);

  const loadLog = useCallback(async (p: number) => {
    setLogLoading(true);
    const data = await apiFetch<{ entries: DecisionEntry[]; total?: number }>(
      `/api/v1/decision-log?limit=${LOG_PAGE}&offset=${p * LOG_PAGE}`
    );
    const items = data?.entries ?? [];
    setEntries(items);
    setHasMore(items.length === LOG_PAGE);
    if (data?.total != null) setTotal(data.total);
    setLogLoading(false);
  }, []);

  useEffect(() => { void loadLog(page); }, [page, loadLog]);

  return (
    <div style={{ padding: "24px 28px", maxWidth: 820, overflowY: "auto", height: "100%" }}>

      {/* ── Board Conversations ──────────────────────────────────────── */}
      <section style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px", color: "var(--text-primary)" }}>
          Board Conversations
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px" }}>
          Questions brought to the board and what was decided.
        </p>

        {threadsLoading && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>
        )}

        {!threadsLoading && threads.length === 0 && (
          <div style={{ padding: "28px 20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", textAlign: "center" }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
              No board conversations yet. <Link href="/dashboard" style={{ color: "var(--brand)", textDecoration: "none" }}>Ask the board something →</Link>
            </p>
          </div>
        )}

        {!threadsLoading && threads.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {threads.map((t) => (
              <Link
                key={t.thread_id}
                href={`/dashboard?t=${t.thread_id}`}
                style={{ textDecoration: "none" }}
              >
                <div style={{
                  background: "var(--surface)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-lg)", padding: "13px 16px",
                  display: "flex", flexDirection: "column", gap: 5,
                  boxShadow: "var(--shadow-sm)",
                  transition: "border-color 0.1s",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", margin: 0, lineHeight: 1.4 }}>
                      {truncate(t.first_message, 100)}
                    </p>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0, marginTop: 2 }}>
                      {relativeTime(t.last_activity)}
                    </span>
                  </div>
                  {t.last_headline && (
                    <p style={{ fontSize: 12, color: "var(--brand)", margin: 0, lineHeight: 1.4, fontWeight: 500 }}>
                      → {truncate(t.last_headline, 120)}
                    </p>
                  )}
                  {t.job_count > 1 && (
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
                      {t.job_count} exchanges
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Governance Log ───────────────────────────────────────────── */}
      <section>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px", color: "var(--text-primary)" }}>
          Governance Log
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px" }}>
          Tamper-evident record of every board action and document change.
          {total != null && ` ${total.toLocaleString()} entries total.`}
        </p>

        {logLoading && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>}

        {!logLoading && entries.length === 0 && (
          <div style={{ padding: "28px 20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", textAlign: "center" }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>No governance events yet.</p>
          </div>
        )}

        {!logLoading && entries.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {entries.map((entry, i) => {
              const ev = entry.event ?? {} as GovernanceEvent;
              const color = eventColor(ev.event_type);
              const isOpen = expanded === entry.entry_id;
              const label = eventLabel(ev);

              return (
                <div key={entry.entry_id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <div
                    onClick={() => setExpanded(p => p === entry.entry_id ? null : entry.entry_id)}
                    style={{ display: "flex", gap: 12, padding: "12px 4px", cursor: "pointer", alignItems: "flex-start" }}
                  >
                    {/* Timeline dot */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 24, flexShrink: 0 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, marginTop: 4 }} />
                      {i < entries.length - 1 && (
                        <div style={{ width: 2, flex: 1, minHeight: 18, background: "var(--border)", marginTop: 3 }} />
                      )}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{label}</span>
                        {entry.signed && (
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "#16a34a18", color: "#16a34a", fontWeight: 600 }}>
                            Verified
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "3px 0 0" }}>
                        {ev.actor && <span style={{ marginRight: 8 }}>{ev.actor}</span>}
                        {ev.at ? relativeTime(ev.at) : ""}
                      </p>
                    </div>

                    <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0, marginTop: 4 }}>{isOpen ? "▲" : "▼"}</span>
                  </div>

                  {isOpen && ev.details && Object.keys(ev.details).length > 0 && (
                    <div style={{ paddingLeft: 36, paddingBottom: 12 }}>
                      <div style={{
                        background: "var(--surface-overlay)", border: "1px solid var(--border)",
                        borderRadius: "var(--radius)", padding: "10px 12px", fontSize: 12,
                        display: "flex", flexDirection: "column", gap: 4,
                      }}>
                        {Object.entries(ev.details)
                          .filter(([, v]) => v != null && v !== "" && String(v).length < 400)
                          .map(([k, v]) => (
                            <p key={k} style={{ margin: 0, color: "var(--text-secondary)" }}>
                              <span style={{ fontWeight: 600, color: "var(--text-muted)", marginRight: 6 }}>
                                {k.replace(/_/g, " ")}:
                              </span>
                              {typeof v === "object" ? JSON.stringify(v) : String(v)}
                            </p>
                          ))}
                        {entry.signed && (
                          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
                            Signed · key {entry.signed.key_id} · {entry.signed.alg}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!logLoading && (entries.length > 0 || page > 0) && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
              style={{ padding: "6px 14px", fontSize: 13, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: page === 0 ? "var(--text-muted)" : "var(--text-primary)", cursor: page === 0 ? "default" : "pointer" }}
            >
              ← Earlier
            </button>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Page {page + 1}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!hasMore}
              style={{ padding: "6px 14px", fontSize: 13, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: !hasMore ? "var(--text-muted)" : "var(--text-primary)", cursor: !hasMore ? "default" : "pointer" }}
            >
              More recent →
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
