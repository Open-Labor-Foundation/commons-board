"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, relativeTime } from "../../lib/api";

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

const PAGE_SIZE = 20;

const EVENT_LABELS: Record<string, string> = {
  artifact_written: "Board document updated",
  action_proposed: "Decision requested",
  approval_recorded: "Vote recorded",
  org_activated: "Board activated",
  action_executed: "Action completed",
  setting_updated: "Settings updated",
  artifact_created: "Document created",
  action_proposed_autonomous: "Autonomous action proposed",
};

const EVENT_COLORS: Record<string, string> = {
  artifact_written: "#2563eb",
  action_proposed: "#d97706",
  approval_recorded: "#16a34a",
  org_activated: "#7c3aed",
  action_executed: "#16a34a",
  setting_updated: "#64748b",
  artifact_created: "#2563eb",
};

function humanizeLabel(eventType?: string): string {
  if (!eventType) return "Board activity";
  return EVENT_LABELS[eventType] ?? eventType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function eventColor(eventType?: string): string {
  return EVENT_COLORS[eventType ?? ""] ?? "#64748b";
}

function detailSummary(event: GovernanceEvent): string | null {
  const d = event.details ?? {};
  if (event.event_type === "approval_recorded") {
    const decision = d.decision === "approve" ? "approved" : "declined";
    return `Decision was ${decision}`;
  }
  if (event.event_type === "artifact_written" && d.version) {
    return `Updated to version ${d.version}`;
  }
  if (event.event_type === "action_proposed" && d.action_type) {
    return String(d.action_type).replace(/_/g, " ");
  }
  return null;
}

export default function BoardMinutesPage() {
  const [entries, setEntries] = useState<DecisionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    const offset = p * PAGE_SIZE;
    const data = await apiFetch<{ entries: DecisionEntry[]; total?: number }>(`/api/v1/decision-log?limit=${PAGE_SIZE}&offset=${offset}`);
    const items = data?.entries ?? [];
    setEntries(items);
    setHasMore(items.length === PAGE_SIZE);
    if (data?.total != null) setTotal(data.total);
    setLoading(false);
  }, []);

  useEffect(() => { load(page); }, [page, load]);

  return (
    <div style={{ padding: 24, maxWidth: 860 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Board Minutes</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
          A tamper-evident record of every decision and action taken by your board.
          {total != null && ` ${total.toLocaleString()} entries.`}
        </p>
      </div>

      {loading && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>}

      {!loading && entries.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
          <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>No board activity yet</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "6px 0 0" }}>Decisions and actions will appear here as your board operates.</p>
        </div>
      )}

      {!loading && entries.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {entries.map((entry, i) => {
            const ev = entry.event ?? {} as GovernanceEvent;
            const color = eventColor(ev.event_type);
            const isOpen = expanded === entry.entry_id;
            const detail = detailSummary(ev);

            return (
              <div key={entry.entry_id} style={{ borderBottom: "1px solid var(--border)" }}>
                <div
                  onClick={() => setExpanded(prev => prev === entry.entry_id ? null : entry.entry_id)}
                  style={{ display: "flex", gap: 12, padding: "13px 4px", cursor: "pointer", alignItems: "flex-start" }}
                >
                  {/* Timeline dot + line */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 28, flexShrink: 0 }}>
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: color, marginTop: 3 }} />
                    {i < entries.length - 1 && (
                      <div style={{ width: 2, flex: 1, minHeight: 20, background: "var(--border)", marginTop: 3 }} />
                    )}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                        {humanizeLabel(ev.event_type)}
                      </span>
                      {entry.signed && (
                        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 8, background: "#16a34a18", color: "#16a34a", fontWeight: 600 }}>
                          Verified
                        </span>
                      )}
                    </div>
                    {detail && (
                      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "3px 0 0" }}>{detail}</p>
                    )}
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "3px 0 0" }}>
                      {ev.at ? relativeTime(ev.at) : ""}
                    </p>
                  </div>

                  <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
                </div>

                {/* Expanded */}
                {isOpen && (
                  <div style={{ paddingLeft: 40, paddingBottom: 14 }}>
                    <div style={{ background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px 14px", fontSize: 12 }}>
                      {ev.actor && (
                        <p style={{ margin: "0 0 6px", color: "var(--text-secondary)" }}>
                          <strong>By:</strong> {ev.actor}
                        </p>
                      )}
                      {ev.details && Object.keys(ev.details).length > 0 && (
                        <div>
                          <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>Details</p>
                          {Object.entries(ev.details).map(([k, v]) => (
                            <p key={k} style={{ margin: "2px 0", color: "var(--text-secondary)" }}>
                              <strong>{k.replace(/_/g, " ")}:</strong>{" "}
                              {typeof v === "object" ? JSON.stringify(v) : String(v)}
                            </p>
                          ))}
                        </div>
                      )}
                      {entry.signed && (
                        <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
                          Cryptographic signature: key {entry.signed.key_id} · {entry.signed.alg}
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

      {!loading && (entries.length > 0 || page > 0) && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 20 }}>
          <button onClick={() => setPage(p => p - 1)} disabled={page === 0} style={{ padding: "7px 14px", fontSize: 13, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: page === 0 ? "var(--text-muted)" : "var(--text-primary)" }}>
            ← Earlier
          </button>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Page {page + 1}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={!hasMore} style={{ padding: "7px 14px", fontSize: 13, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: !hasMore ? "var(--text-muted)" : "var(--text-primary)" }}>
            More recent →
          </button>
        </div>
      )}
    </div>
  );
}
