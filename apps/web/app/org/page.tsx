"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPost, relativeTime } from "../../lib/api";

type Chair = {
  chair_id: string;
  name: string;
  domain: string;
  description: string;
  scope: { owns: string[]; escalates_to: string[] };
  worker_agents: Array<{ agent_id: string; name: string; task_scope: string[] }>;
  approval_required_for: string[];
};

type AgentBlueprint = { payload: { chairs: Chair[] } };

type OrgGap = {
  gap_id: string;
  description: string;
  priority: "high" | "medium" | "low";
  submitted_at?: string;
  status: string;
};

type ReviewItem = {
  id: string;
  category: string;
  discipline: string;
  reviewer_type: string;
  scope: string;
  artifacts_covered: string[];
  status: "required" | "under_review" | "approved";
  reviewer_name: string | null;
  review_date: string | null;
  notes: string | null;
};

type ReviewManifest = {
  payload: {
    advisory_statement: string;
    review_items: ReviewItem[];
    go_live_gate: { requires_all_approved: boolean; minimum_required_categories: string[] };
  };
};

const DOMAIN_COLOR: Record<string, string> = {
  finance: "#16a34a", ops: "#2563eb", legal: "#7c3aed", hr: "#d97706",
  strategy: "#4f46e5", product: "#0891b2", security: "#dc2626",
  rnd: "#ca8a04", it: "#0284c7", sales: "#db2777", growth: "#65a30d", custom: "#64748b",
};

function domainColor(domain: string) { return DOMAIN_COLOR[domain] ?? "#64748b"; }

const REVIEW_STATUS_STYLE: Record<ReviewItem["status"], { bg: string; color: string; label: string }> = {
  required:     { bg: "#dc262618", color: "#dc2626", label: "Required" },
  under_review: { bg: "#d9770618", color: "#d97706", label: "In review" },
  approved:     { bg: "#16a34a18", color: "#16a34a", label: "Approved" },
};

const CATEGORY_LABEL: Record<string, string> = {
  legal: "Legal", financial: "Financial", insurance: "Insurance",
  regulatory: "Regulatory", food_safety: "Food Safety", labor: "Labor",
  technology: "Technology", governance: "Governance",
};

export default function BoardRosterPage() {
  const [chairs, setChairs] = useState<Chair[]>([]);
  const [gaps, setGaps] = useState<OrgGap[]>([]);
  const [manifest, setManifest] = useState<ReviewManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [gapDesc, setGapDesc] = useState("");
  const [gapPriority, setGapPriority] = useState<"high" | "medium" | "low">("medium");
  const [submittingGap, setSubmittingGap] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [bp, g, rm] = await Promise.all([
      apiFetch<AgentBlueprint>("/api/v1/artifacts/agent_blueprint/latest"),
      apiFetch<{ gaps: OrgGap[] }>("/api/v1/org/gaps"),
      apiFetch<ReviewManifest>("/api/v1/artifacts/professional_review_manifest/latest"),
    ]);
    const payload = bp?.payload as { chairs?: Chair[] } | undefined;
    setChairs(payload?.chairs ?? []);
    setGaps(g?.gaps ?? []);
    setManifest(rm ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submitGap() {
    if (!gapDesc.trim()) return;
    setSubmittingGap(true);
    await apiPost("/api/v1/org/gaps", { description: gapDesc.trim(), priority: gapPriority });
    setGapDesc("");
    setMsg("Gap reported. Thank you.");
    setSubmittingGap(false);
    load();
  }

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading your board…</div>;

  return (
    <div style={{ padding: 24, maxWidth: 960 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Board Roster</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
          Your board chairs and the areas of the business they manage on your behalf.
        </p>
      </div>

      {/* Go-live gate */}
      {manifest && (() => {
        const items = manifest.payload.review_items ?? [];
        const gate = manifest.payload.go_live_gate;
        const requiredCats = gate?.minimum_required_categories ?? [];
        const approvedCats = items.filter(i => i.status === "approved").map(i => i.category);
        const pendingRequired = requiredCats.filter(c => !approvedCats.includes(c));
        const allGatesMet = pendingRequired.length === 0;
        if (allGatesMet) return null;
        return (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "var(--radius-lg)", padding: "14px 18px", display: "flex", gap: 14, alignItems: "flex-start" }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>🔒</span>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", margin: "0 0 4px" }}>
                Not cleared for operations — {pendingRequired.length} required review{pendingRequired.length !== 1 ? "s" : ""} pending
              </p>
              <p style={{ fontSize: 12, color: "#7f1d1d", margin: "0 0 8px", lineHeight: 1.5 }}>
                This cooperative requires sign-off from qualified professionals in the following categories before any operational, legal, or financial activity can begin.
              </p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {pendingRequired.map(cat => (
                  <span key={cat} style={{ fontSize: 11, fontWeight: 700, background: "#dc262618", color: "#dc2626", padding: "2px 9px", borderRadius: 10 }}>
                    {cat.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {chairs.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
          <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>No board chairs configured yet</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "6px 0 0" }}>
            Complete the <a href="/onboarding" style={{ color: "var(--brand)" }}>board profile interview</a> to set up your chairs.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {chairs.map((chair) => {
            const color = domainColor(chair.domain);
            const isOpen = expandedId === chair.chair_id;
            return (
              <div key={chair.chair_id} style={{ borderBottom: "1px solid var(--border)" }}>
                <div
                  onClick={() => setExpandedId(prev => prev === chair.chair_id ? null : chair.chair_id)}
                  style={{ display: "flex", gap: 14, padding: "16px 4px", cursor: "pointer", alignItems: "flex-start" }}
                >
                  {/* Domain badge */}
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: color + "18", border: `2px solid ${color}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color }}>{chair.domain.slice(0, 2).toUpperCase()}</span>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 3px", color: "var(--text-primary)" }}>{chair.name}</p>
                    <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.4 }}>{chair.description}</p>
                    {chair.scope?.owns?.length > 0 && (
                      <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "5px 0 0" }}>
                        Responsible for: {chair.scope.owns.slice(0, 4).map(o => o.replace(/_/g, " ")).join(", ")}
                        {chair.scope.owns.length > 4 && " and more"}
                      </p>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0, marginTop: 4 }}>{isOpen ? "▲" : "▼"}</span>
                </div>

                {isOpen && (
                  <div style={{ paddingLeft: 54, paddingBottom: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                    {/* Needs your approval for */}
                    {chair.approval_required_for?.length > 0 && (
                      <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: "var(--radius)", padding: "10px 14px" }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: "#92400e", margin: "0 0 5px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          Needs your approval for
                        </p>
                        <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 2 }}>
                          {chair.approval_required_for.map(item => (
                            <li key={item} style={{ fontSize: 12, color: "var(--text-primary)" }}>{item.replace(/_/g, " ")}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Worker agents */}
                    {chair.worker_agents?.length > 0 && (
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          Support staff
                        </p>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          {chair.worker_agents.map(agent => (
                            <div key={agent.agent_id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "8px 12px" }}>
                              <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 2px" }}>{agent.name}</p>
                              {agent.task_scope?.length > 0 && (
                                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
                                  {agent.task_scope.slice(0, 3).map(t => t.replace(/_/g, " ")).join(", ")}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Escalates to */}
                    {chair.scope?.escalates_to?.length > 0 && (
                      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                        Escalates complex decisions to: {chair.scope.escalates_to.join(", ")} chair{chair.scope.escalates_to.length !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Professional review manifest */}
      {manifest && (
        <div style={{ marginTop: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Professional Review Required</h3>
            {(() => {
              const items = manifest.payload.review_items ?? [];
              const allApproved = items.every(i => i.status === "approved");
              const anyPending = items.some(i => i.status === "required");
              return (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 10,
                  background: allApproved ? "#16a34a18" : anyPending ? "#dc262618" : "#d9770618",
                  color:      allApproved ? "#16a34a"   : anyPending ? "#dc2626"   : "#d97706",
                }}>
                  {allApproved ? "All approved" : anyPending ? "Reviews pending" : "In progress"}
                </span>
              );
            })()}
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 14px", lineHeight: 1.5 }}>
            {manifest.payload.advisory_statement}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(manifest.payload.review_items ?? []).map(item => {
              const style = REVIEW_STATUS_STYLE[item.status];
              return (
                <div key={item.id} style={{ display: "flex", gap: 12, padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", alignItems: "flex-start" }}>
                  <div style={{ flexShrink: 0, marginTop: 2 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, background: style.bg, color: style.color, padding: "2px 8px", borderRadius: 10 }}>
                      {style.label}
                    </span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{item.discipline}</p>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: 10, padding: "1px 7px" }}>
                        {CATEGORY_LABEL[item.category] ?? item.category}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.reviewer_type}</span>
                    </div>
                    <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "3px 0 0", lineHeight: 1.4 }}>{item.scope}</p>
                    {item.artifacts_covered.length > 0 && (
                      <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 0" }}>
                        Covers: {item.artifacts_covered.join(", ")}
                      </p>
                    )}
                    {item.reviewer_name && (
                      <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "3px 0 0" }}>
                        Reviewer: {item.reviewer_name}{item.review_date ? ` · ${item.review_date}` : ""}
                      </p>
                    )}
                    {item.notes && (
                      <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "4px 0 0", background: "var(--surface-overlay)", padding: "5px 8px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                        {item.notes}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Missing expertise */}
      <div style={{ marginTop: 32 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 6px" }}>Missing expertise?</h3>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px" }}>
          If there's a business function your board doesn't cover, flag it here and we'll work to add coverage.
        </p>

        {msg && <p style={{ fontSize: 13, color: "var(--success)", margin: "0 0 12px" }}>{msg}</p>}

        {gaps.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            {gaps.map(g => (
              <div key={g.gap_id} style={{ display: "flex", gap: 10, padding: "10px 12px", background: "var(--surface)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{g.description}</p>
                  {g.submitted_at && <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0" }}>Reported {relativeTime(g.submitted_at)}</p>}
                </div>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: g.priority === "high" ? "#dc262618" : "var(--surface-overlay)", color: g.priority === "high" ? "#dc2626" : "var(--text-muted)", fontWeight: 600, alignSelf: "flex-start" }}>
                  {g.priority}
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 520 }}>
          <textarea
            value={gapDesc}
            onChange={(e) => setGapDesc(e.target.value)}
            placeholder="Describe what's missing (e.g. 'Someone to manage our social media and marketing strategy')"
            rows={3}
            style={{ resize: "vertical", padding: "8px 10px", fontSize: 13, width: "100%", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={gapPriority} onChange={(e) => setGapPriority(e.target.value as "high"|"medium"|"low")} style={{ padding: "6px 10px", fontSize: 13 }}>
              <option value="high">Urgent</option>
              <option value="medium">Medium priority</option>
              <option value="low">Nice to have</option>
            </select>
            <button onClick={submitGap} disabled={submittingGap || !gapDesc.trim()} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>
              {submittingGap ? "Submitting…" : "Report gap"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
