"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPost, relativeTime } from "../../lib/api";

type Approval = {
  approval_id: string;
  action_id: string;
  action_type: string;
  summary: string;
  status: "pending" | "approved" | "rejected";
  risk_score?: number;
  blast_radius?: string;
  category?: string;
  decided_by?: string;
  decided_at?: string;
  created_at: string;
};

function RiskBadge({ score }: { score?: number }) {
  if (score == null) return null;
  const color = score >= 70 ? "#dc2626" : score >= 40 ? "#d97706" : "#16a34a";
  const label = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  return <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: color + "18", color, fontWeight: 600 }}>{label} ({score})</span>;
}

function StatusBadge({ status }: { status: string }) {
  const color = status === "approved" ? "#16a34a" : status === "rejected" ? "#dc2626" : "#d97706";
  return <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: color + "18", color, fontWeight: 600 }}>{status}</span>;
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [acting, setActing] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await apiFetch<{ approvals: Approval[] }>("/api/v1/approvals");
    setApprovals(data?.approvals ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function decide(approvalId: string, decision: "approved" | "rejected") {
    setActing(approvalId);
    await apiPost(`/api/v1/approvals/${approvalId}/decide`, { decision });
    setActing(null);
    load();
  }

  const visible = tab === "pending" ? approvals.filter(a => a.status === "pending") : approvals;
  const pendingCount = approvals.filter(a => a.status === "pending").length;

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Approvals</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
          Review and act on pending agent actions before they execute.
          {pendingCount > 0 && <strong style={{ color: "#dc2626" }}> {pendingCount} pending.</strong>}
        </p>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
        {(["pending", "all"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: tab === t ? 600 : 400,
            color: tab === t ? "var(--brand)" : "var(--text-secondary)",
            background: "none", borderBottom: tab === t ? "2px solid var(--brand)" : "2px solid transparent", marginBottom: -1, textTransform: "capitalize",
          }}>
            {t === "pending" ? `Pending (${pendingCount})` : `All (${approvals.length})`}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
          {tab === "pending" ? "No pending approvals." : "No approvals yet."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {visible.map(a => (
            <div key={a.approval_id} style={{ borderBottom: "1px solid var(--border)" }}>
              <div
                onClick={() => setExpandedId(prev => prev === a.approval_id ? null : a.approval_id)}
                style={{ display: "flex", gap: 14, padding: "14px 4px", cursor: "pointer", alignItems: "flex-start" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{a.summary}</span>
                    <StatusBadge status={a.status} />
                    <RiskBadge score={a.risk_score} />
                    {a.blast_radius && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>blast: {a.blast_radius}</span>}
                  </div>
                  <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-muted)" }}>
                    <span>{a.action_type.replace(/_/g, " ")}</span>
                    {a.category && <span>{a.category}</span>}
                    <span>{relativeTime(a.created_at)}</span>
                    {a.decided_by && <span>decided by {a.decided_by}</span>}
                  </div>
                </div>
                {a.status === "pending" && (
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => decide(a.approval_id, "approved")}
                      disabled={acting === a.approval_id}
                      style={{ background: "#16a34a", color: "#fff", padding: "6px 14px", fontSize: 12, fontWeight: 600, borderRadius: "var(--radius)" }}
                    >
                      {acting === a.approval_id ? "…" : "Approve"}
                    </button>
                    <button
                      onClick={() => decide(a.approval_id, "rejected")}
                      disabled={acting === a.approval_id}
                      style={{ background: "#dc2626", color: "#fff", padding: "6px 14px", fontSize: 12, fontWeight: 600, borderRadius: "var(--radius)" }}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
              {expandedId === a.approval_id && (
                <div style={{ paddingLeft: 4, paddingBottom: 14 }}>
                  <div style={{ background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px 14px", fontSize: 12, fontFamily: "monospace" }}>
                    <p style={{ margin: 0 }}>action_id: {a.action_id}</p>
                    <p style={{ margin: "3px 0 0" }}>approval_id: {a.approval_id}</p>
                    {a.decided_at && <p style={{ margin: "3px 0 0" }}>decided_at: {a.decided_at}</p>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
