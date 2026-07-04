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

const DOMAIN_COLOR: Record<string, string> = {
  finance: "#16a34a", ops: "#2563eb", legal: "#7c3aed", hr: "#d97706",
  strategy: "#4f46e5", product: "#0891b2", security: "#dc2626",
  rnd: "#ca8a04", it: "#0284c7", sales: "#db2777", growth: "#65a30d", custom: "#64748b",
};

function domainColor(domain: string) { return DOMAIN_COLOR[domain] ?? "#64748b"; }

// "owns" often just restates the description in full-sentence form — drop anything
// that isn't distinct from it, and keep the rest short enough to scan.
function distinctOwns(owns: string[], description: string): string[] {
  return owns
    .filter(o => o.trim() !== description.trim())
    .map(o => (o.length > 60 ? o.slice(0, 57).trimEnd() + "…" : o));
}

// task_scope entries are full procedural sentences from the catalog spec, not short
// tags — truncate and cap so a card doesn't turn into a paragraph of run-on text.
function shortTasks(tasks: string[], max: number): string[] {
  return tasks.slice(0, max).map(t => (t.length > 55 ? t.slice(0, 52).trimEnd() + "…" : t));
}

export default function BoardRosterPage() {
  const [chairs, setChairs] = useState<Chair[]>([]);
  const [gaps, setGaps] = useState<OrgGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [gapDesc, setGapDesc] = useState("");
  const [gapPriority, setGapPriority] = useState<"high" | "medium" | "low">("medium");
  const [submittingGap, setSubmittingGap] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [bp, g] = await Promise.all([
      apiFetch<AgentBlueprint>("/api/v1/artifacts/agent_blueprint/latest"),
      apiFetch<{ gaps: OrgGap[] }>("/api/v1/org/gaps"),
    ]);
    const payload = bp?.payload as { chairs?: Chair[] } | undefined;
    setChairs(payload?.chairs ?? []);
    setGaps(g?.gaps ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submitGap() {
    if (!gapDesc.trim()) return;
    setSubmittingGap(true);
    const { data } = await apiPost<{ chair_added?: boolean; already_covered?: boolean; chair?: { name: string } }>(
      "/api/v1/org/gaps",
      { description: gapDesc.trim(), priority: gapPriority }
    );
    setGapDesc("");
    setMsg(
      data?.chair_added && data.chair
        ? `${data.chair.name} added to your board.`
        : data?.already_covered
          ? "Already covered by an existing chair."
          : "Gap reported. We'll work to add coverage."
    );
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
            const owns = distinctOwns(chair.scope?.owns ?? [], chair.description).slice(0, 3);
            const approvalCount = chair.approval_required_for?.length ?? 0;
            return (
              <div key={chair.chair_id} style={{ borderBottom: "1px solid var(--border)" }}>
                <div
                  onClick={() => setExpandedId(prev => prev === chair.chair_id ? null : chair.chair_id)}
                  style={{ display: "flex", gap: 14, padding: "16px 4px", cursor: "pointer", alignItems: "flex-start" }}
                >
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: color + "18", border: `2px solid ${color}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color }}>{chair.domain.slice(0, 2).toUpperCase()}</span>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                      <p style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>{chair.name}</p>
                      {approvalCount > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#92400e", background: "#fefce8", border: "1px solid #fde68a", borderRadius: 10, padding: "2px 8px" }}>
                          {approvalCount} needs your sign-off
                        </span>
                      )}
                    </div>
                    <p style={{
                      fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.4,
                      overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                    }}>
                      {chair.description}
                    </p>
                    {owns.length > 0 && (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                        {owns.map(o => (
                          <span key={o} style={{ fontSize: 11, background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: 8, padding: "2px 8px", color: "var(--text-muted)" }}>
                            {o.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0, marginTop: 4 }}>{isOpen ? "▲" : "▼"}</span>
                </div>

                {isOpen && (
                  <div style={{ paddingLeft: 54, paddingBottom: 16, display: "flex", flexDirection: "column", gap: 12 }}>
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
                                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                  {shortTasks(agent.task_scope, 2).map(t => (
                                    <span key={t} style={{ fontSize: 10, background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: 6, padding: "2px 6px", color: "var(--text-muted)" }}>
                                      {t.replace(/_/g, " ")}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

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
