"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, relativeTime } from "../../lib/api";

type GovernanceEvent = {
  event_id?: string;
  event_name?: string;
  type?: string;
  actor?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
  created_at?: string;
};

type DecisionEntry = {
  entry_id: string;
  event: GovernanceEvent;
  signed?: { sig: string; key_id: string; alg: string };
  prev_hash?: string;
  hash?: string;
  sequence?: number;
};

const PAGE_SIZE = 20;

function Badge({ label, color }: { label: string; color?: string }) {
  const c = color ?? "#64748b";
  return (
    <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 10, fontSize: 10, fontWeight: 600, background: c + "18", color: c, textTransform: "uppercase", letterSpacing: "0.04em" }}>
      {label}
    </span>
  );
}

function eventColor(name?: string): string {
  if (!name) return "#64748b";
  if (name.includes("approv")) return "#2563eb";
  if (name.includes("reject") || name.includes("cancel")) return "#dc2626";
  if (name.includes("complet") || name.includes("confirm") || name.includes("execut")) return "#16a34a";
  if (name.includes("create") || name.includes("submit")) return "#9333ea";
  return "#64748b";
}

export default function GovernancePage() {
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

  function toggleExpand(id: string) {
    setExpanded(prev => prev === id ? null : id);
  }

  const eventName = (e: GovernanceEvent) => e.event_name ?? e.type ?? "unknown";
  const eventTime = (e: GovernanceEvent) => e.timestamp ?? e.created_at ?? "";

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Governance</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
          Cryptographically signed decision log. Every entry is chained to the previous via hash.
          {total != null && ` ${total.toLocaleString()} entries total.`}
        </p>
      </div>

      {loading && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>}

      {!loading && entries.length === 0 && (
        <div style={{ padding: 32, textAlign: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
          <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>No decisions logged yet</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "6px 0 0" }}>Governance events will appear here as the board operates.</p>
        </div>
      )}

      {!loading && entries.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {entries.map((entry, i) => {
            const ev = entry.event ?? {} as GovernanceEvent;
            const name = eventName(ev);
            const color = eventColor(name);
            const isOpen = expanded === entry.entry_id;

            return (
              <div key={entry.entry_id} style={{ borderBottom: "1px solid var(--border)" }}>
                <div
                  onClick={() => toggleExpand(entry.entry_id)}
                  style={{ display: "flex", gap: 12, padding: "12px 4px", cursor: "pointer", alignItems: "flex-start" }}
                >
                  {/* Sequence indicator + chain line */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 32, flexShrink: 0 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: color + "18", border: `2px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color }}>
                      {entry.sequence ?? (page * PAGE_SIZE + i + 1)}
                    </div>
                    {i < entries.length - 1 && (
                      <div style={{ width: 2, flex: 1, minHeight: 16, background: "var(--border)", marginTop: 2 }} />
                    )}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <Badge label={name.replace(/_/g, " ")} color={color} />
                      {entry.signed && <Badge label="signed" color="#16a34a" />}
                      {ev.actor && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>by {ev.actor}</span>}
                      <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
                        {eventTime(ev) ? relativeTime(eventTime(ev)) : ""}
                      </span>
                    </div>
                    {ev.summary && (
                      <p style={{ fontSize: 13, margin: "5px 0 0", color: "var(--text-primary)", lineHeight: 1.4 }}>{ev.summary}</p>
                    )}
                    <p style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", margin: "5px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.hash ? `hash: ${entry.hash.slice(0, 24)}…` : `id: ${entry.entry_id}`}
                    </p>
                  </div>

                  <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
                </div>

                {/* Expanded detail */}
                {isOpen && (
                  <div style={{ paddingLeft: 44, paddingBottom: 16 }}>
                    <div style={{ background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
                      {/* Hash chain */}
                      {(entry.prev_hash || entry.hash) && (
                        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 3 }}>
                          {entry.prev_hash && <span>prev: {entry.prev_hash}</span>}
                          {entry.hash && <span>hash: {entry.hash}</span>}
                        </div>
                      )}
                      {/* Signature */}
                      {entry.signed && (
                        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 11, display: "flex", gap: 16 }}>
                          <span style={{ color: "var(--text-muted)" }}>key: <strong style={{ fontFamily: "monospace" }}>{entry.signed.key_id}</strong></span>
                          <span style={{ color: "var(--text-muted)" }}>alg: <strong>{entry.signed.alg}</strong></span>
                          <span style={{ color: "var(--text-muted)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>sig: {entry.signed.sig.slice(0, 32)}…</span>
                        </div>
                      )}
                      {/* Payload */}
                      {ev.payload && (
                        <div style={{ padding: "10px 14px" }}>
                          <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", margin: "0 0 6px", textTransform: "uppercase" }}>Payload</p>
                          <pre style={{ fontSize: 11, fontFamily: "monospace", margin: 0, overflow: "auto", maxHeight: 200, color: "var(--text-primary)" }}>
                            {JSON.stringify(ev.payload, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && (entries.length > 0 || page > 0) && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 20 }}>
          <button onClick={() => setPage(p => p - 1)} disabled={page === 0} style={{ padding: "7px 14px", fontSize: 13, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: page === 0 ? "var(--text-muted)" : "var(--text-primary)" }}>
            ← Previous
          </button>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Page {page + 1}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={!hasMore} style={{ padding: "7px 14px", fontSize: 13, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: !hasMore ? "var(--text-muted)" : "var(--text-primary)" }}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
