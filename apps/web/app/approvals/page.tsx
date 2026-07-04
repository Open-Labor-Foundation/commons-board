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
  required_approvers?: number;
  responses?: Array<{ approver_id: string; decision: string; at: string }>;
  created_at: string;
  resolved_at?: string;
};

function humanizeActionType(raw: string): string {
  const map: Record<string, string> = {
    budget_approval: "Budget approval",
    member_admission: "New member admission",
    contract_approval: "Contract approval",
    policy_change: "Policy change",
    compensation_change: "Compensation change",
    vendor_approval: "Vendor approval",
  };
  return map[raw] ?? raw.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function reviewLabel(score?: number, blast?: string): string {
  if (score != null && score >= 70) return "Full board vote required";
  if (blast === "high") return "Full board vote required";
  if (blast === "medium" || (score != null && score >= 40)) return "Chair review required";
  return "Standard approval";
}

function reviewColor(score?: number, blast?: string): string {
  if (score != null && score >= 70) return "#dc2626";
  if (blast === "high") return "#dc2626";
  if (blast === "medium" || (score != null && score >= 40)) return "#d97706";
  return "#16a34a";
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = { approved: "#16a34a", rejected: "#dc2626", pending: "#d97706" };
  const labels: Record<string, string> = { approved: "Approved", rejected: "Rejected", pending: "Awaiting decision" };
  const c = colors[status] ?? "#64748b";
  return (
    <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: c + "18", color: c, fontWeight: 600 }}>
      {labels[status] ?? status}
    </span>
  );
}

export default function DecisionsPage() {
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
    const endpoint = decision === "approved" ? "approve" : "reject";
    await apiPost(`/api/v1/approvals/${approvalId}/${endpoint}`, {});
    setActing(null);
    load();
  }

  const visible = tab === "pending" ? approvals.filter(a => a.status === "pending") : approvals;
  const pendingCount = approvals.filter(a => a.status === "pending").length;

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, maxWidth: 860 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Decisions Needed</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
          Your board chairs have flagged these items for your review and approval.
          {pendingCount > 0 && <strong style={{ color: "#dc2626" }}> {pendingCount} awaiting your decision.</strong>}
        </p>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
        {(["pending", "all"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: tab === t ? 600 : 400,
            color: tab === t ? "var(--brand)" : "var(--text-secondary)",
            background: "none", borderBottom: tab === t ? "2px solid var(--brand)" : "2px solid transparent", marginBottom: -1,
          }}>
            {t === "pending" ? `Needs Decision (${pendingCount})` : `All (${approvals.length})`}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
          {tab === "pending" ? "No decisions pending — your board is all caught up." : "No decisions recorded yet."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {visible.map(a => {
            const isOpen = expandedId === a.approval_id;
            const rColor = reviewColor(a.risk_score, a.blast_radius);
            return (
              <div key={a.approval_id} style={{ borderBottom: "1px solid var(--border)" }}>
                <div
                  onClick={() => setExpandedId(prev => prev === a.approval_id ? null : a.approval_id)}
                  style={{ display: "flex", gap: 14, padding: "16px 4px", cursor: "pointer", alignItems: "flex-start" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Type label */}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {humanizeActionType(a.action_type || "")}
                      </span>
                      <StatusPill status={a.status} />
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: rColor + "18", color: rColor, fontWeight: 500 }}>
                        {reviewLabel(a.risk_score, a.blast_radius)}
                      </span>
                    </div>
                    {/* Summary — the human-readable description */}
                    <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 6px", lineHeight: 1.5 }}>
                      {a.summary}
                    </p>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
                      Requested {relativeTime(a.created_at)}
                      {a.resolved_at && ` · Decided ${relativeTime(a.resolved_at)}`}
                    </p>
                  </div>
                  {a.status === "pending" && (
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => decide(a.approval_id, "approved")}
                        disabled={acting === a.approval_id}
                        style={{ background: "#16a34a", color: "#fff", padding: "7px 16px", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius)", border: "none", cursor: "pointer" }}
                      >
                        {acting === a.approval_id ? "…" : "Approve"}
                      </button>
                      <button
                        onClick={() => decide(a.approval_id, "rejected")}
                        disabled={acting === a.approval_id}
                        style={{ background: "var(--surface)", color: "#dc2626", padding: "7px 16px", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius)", border: "1px solid #dc2626", cursor: "pointer" }}
                      >
                        Decline
                      </button>
                    </div>
                  )}
                  <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0, marginLeft: 8, marginTop: 2 }}>{isOpen ? "▲" : "▼"}</span>
                </div>

                {/* Expanded: vote history */}
                {isOpen && (
                  <div style={{ paddingLeft: 4, paddingBottom: 16 }}>
                    {a.responses && a.responses.length > 0 ? (
                      <div style={{ background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px 14px" }}>
                        <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Vote history</p>
                        {a.responses.map((r, i) => (
                          <div key={i} style={{ display: "flex", gap: 10, fontSize: 12, padding: "4px 0", borderBottom: i < a.responses!.length - 1 ? "1px solid var(--border)" : "none" }}>
                            <span style={{ fontWeight: 500, color: r.decision === "approve" ? "#16a34a" : "#dc2626" }}>
                              {r.decision === "approve" ? "Approved" : "Declined"}
                            </span>
                            <span style={{ color: "var(--text-muted)" }}>by {r.approver_id}</span>
                            <span style={{ color: "var(--text-muted)", marginLeft: "auto" }}>{relativeTime(r.at)}</span>
                          </div>
                        ))}
                        {a.required_approvers && (
                          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "8px 0 0" }}>
                            {a.responses.filter(r => r.decision === "approve").length} of {a.required_approvers} vote{a.required_approvers !== 1 ? "s" : ""} needed
                          </p>
                        )}
                      </div>
                    ) : (
                      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>No votes recorded yet.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
