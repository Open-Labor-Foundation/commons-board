"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, relativeTime } from "../../lib/api";

type WorkerSummary = {
  agent_id: string;
  name: string;
  task_scope: string[];
  chair_id: string;
  chair_name: string;
  chair_domain: string;
  status: "active" | "pending" | "ready";
  current_task: { id: string; description: string; type: string; status: string; created_at: string } | null;
  action_count: number;
};

type WorkerListResponse = {
  workers: WorkerSummary[];
  total: number;
};

const DOMAIN_COLOR: Record<string, string> = {
  finance: "#16a34a", ops: "#2563eb", legal: "#7c3aed", hr: "#d97706",
  strategy: "#4f46e5", product: "#0891b2", security: "#dc2626",
  rnd: "#ca8a04", it: "#0284c7", sales: "#db2777", growth: "#65a30d", custom: "#64748b",
};

function domainColor(domain: string) { return DOMAIN_COLOR[domain] ?? "#64748b"; }

function StatusBadge({ status }: { status: "active" | "pending" | "ready" }) {
  const map = {
    active:  { bg: "#16a34a18", color: "#16a34a", label: "Working" },
    pending: { bg: "#d9770618", color: "#d97706", label: "Needs input" },
    ready:   { bg: "var(--surface-overlay)", color: "var(--text-muted)", label: "Ready" },
  };
  const s = map[status];
  return (
    <span style={{ fontSize: 10, fontWeight: 700, background: s.bg, color: s.color, padding: "2px 7px", borderRadius: 10, flexShrink: 0 }}>
      {s.label}
    </span>
  );
}

export default function WorkersPage() {
  const [data, setData] = useState<WorkerListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterChair, setFilterChair] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const load = useCallback(async () => {
    const res = await apiFetch<WorkerListResponse>("/api/v1/workers");
    setData(res ?? { workers: [], total: 0 });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const chairs = data ? Array.from(new Map(data.workers.map(w => [w.chair_id, { id: w.chair_id, name: w.chair_name, domain: w.chair_domain }])).values()) : [];

  const filtered = (data?.workers ?? []).filter(w => {
    if (filterChair !== "all" && w.chair_id !== filterChair) return false;
    if (filterStatus !== "all" && w.status !== filterStatus) return false;
    return true;
  });

  const activeCount = (data?.workers ?? []).filter(w => w.status === "active").length;
  const pendingCount = (data?.workers ?? []).filter(w => w.status === "pending").length;

  if (loading) return <div style={{ padding: 32, fontSize: 13, color: "var(--text-muted)" }}>Loading…</div>;

  return (
    <div style={{ padding: 24, maxWidth: 1100, display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Our Workers</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
          Every worker on your board and what they're doing right now.
        </p>
      </div>

      {/* Stats strip */}
      {data && data.total > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[
            { label: "Total workers", value: data.total },
            { label: "Currently working", value: activeCount, color: "#16a34a" },
            { label: "Waiting for input", value: pendingCount, color: "#d97706" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px" }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</p>
              <p style={{ fontSize: 22, fontWeight: 700, margin: 0, color: color ?? "var(--text-primary)" }}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      {data && data.total > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={filterChair} onChange={e => setFilterChair(e.target.value)} style={{ padding: "7px 10px", fontSize: 13, borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
            <option value="all">All teams</option>
            {chairs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: "7px 10px", fontSize: 13, borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
            <option value="all">All statuses</option>
            <option value="active">Working</option>
            <option value="pending">Needs input</option>
            <option value="ready">Ready</option>
          </select>
          {(filterChair !== "all" || filterStatus !== "all") && (
            <button onClick={() => { setFilterChair("all"); setFilterStatus("all"); }}
              style={{ fontSize: 12, color: "var(--text-muted)", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "5px 10px", cursor: "pointer" }}>
              Clear filters
            </button>
          )}
          <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
            {filtered.length} worker{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Empty state */}
      {data && data.total === 0 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "40px 24px", textAlign: "center" }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-secondary)", margin: "0 0 8px" }}>No workers yet</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 20px" }}>Your board workers appear here once the board is set up.</p>
          <Link href="/onboarding" style={{ fontSize: 13, fontWeight: 600, color: "#fff", background: "var(--brand)", padding: "9px 20px", borderRadius: "var(--radius)", textDecoration: "none" }}>
            Set up your board →
          </Link>
        </div>
      )}

      {/* Worker grid grouped by chair */}
      {filtered.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {chairs
            .filter(c => filtered.some(w => w.chair_id === c.id))
            .map(chair => {
              const chairWorkers = filtered.filter(w => w.chair_id === chair.id);
              const color = domainColor(chair.domain);
              return (
                <div key={chair.id}>
                  {/* Chair section header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <div style={{ width: 24, height: 24, borderRadius: "50%", background: color + "18", border: `2px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color }}>{chair.domain.slice(0, 2).toUpperCase()}</span>
                    </div>
                    <Link href={`/board/${chair.id}`} style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", textDecoration: "none" }}>
                      {chair.name}
                    </Link>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{chairWorkers.length} worker{chairWorkers.length !== 1 ? "s" : ""}</span>
                    <Link href={`/board/${chair.id}`} style={{ fontSize: 11, color: "var(--brand)", textDecoration: "none", marginLeft: "auto" }}>
                      View team →
                    </Link>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
                    {chairWorkers.map(worker => (
                      <Link
                        key={worker.agent_id}
                        href={`/workers/${worker.agent_id}`}
                        style={{
                          display: "block",
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-lg)",
                          padding: "14px 16px",
                          textDecoration: "none",
                          boxShadow: "var(--shadow-sm)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{worker.name}</span>
                          <StatusBadge status={worker.status} />
                        </div>

                        {worker.task_scope && worker.task_scope.length > 0 && (
                          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 8px", lineHeight: 1.4 }}>
                            {worker.task_scope.slice(0, 2).join(" · ")}
                          </p>
                        )}

                        {worker.current_task ? (
                          <div style={{ background: "#16a34a0d", border: "1px solid #16a34a25", borderRadius: "var(--radius)", padding: "7px 10px" }}>
                            <p style={{ fontSize: 9, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 3px" }}>
                              Working on
                            </p>
                            <p style={{ fontSize: 12, color: "var(--text-primary)", margin: 0, lineHeight: 1.45, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
                              {worker.current_task.description}
                            </p>
                            <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "4px 0 0" }}>
                              Started {relativeTime(worker.current_task.created_at)}
                            </p>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              {worker.action_count > 0 ? `${worker.action_count} task${worker.action_count !== 1 ? "s" : ""} completed` : "No tasks yet"}
                            </span>
                            <span style={{ fontSize: 11, color: "var(--brand)", fontWeight: 500 }}>Assign task →</span>
                          </div>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
