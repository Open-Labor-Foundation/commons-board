"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPost, relativeTime } from "../../lib/api";

type Vote = {
  vote_id: string;
  title: string;
  description?: string;
  status: "open" | "closed" | "passed" | "failed";
  options?: string[];
  tally?: Record<string, number>;
  quorum?: number;
  threshold?: number;
  opened_at: string;
  closes_at?: string;
  resolved_at?: string;
};

type Amendment = {
  amendment_id: string;
  title: string;
  description?: string;
  artifact_type?: string;
  proposed_change?: string;
  status: "proposed" | "voting" | "applied" | "rejected";
  proposed_at: string;
  vote_id?: string;
};

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
        {action}
      </div>
      <div style={{ padding: "12px 16px" }}>{children}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = ["passed", "applied"].includes(status) ? "#16a34a" : ["failed", "rejected"].includes(status) ? "#dc2626" : status === "open" || status === "voting" ? "#2563eb" : "#64748b";
  return <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: color + "18", color, fontWeight: 600 }}>{status}</span>;
}

export default function VotesPage() {
  const [votes, setVotes] = useState<Vote[]>([]);
  const [amendments, setAmendments] = useState<Amendment[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"votes" | "amendments">("votes");
  const [voteForm, setVoteForm] = useState({ title: "", description: "", options: "Yes,No", quorum: "51", threshold: "51" });
  const [amendForm, setAmendForm] = useState({ title: "", description: "", artifact_type: "autonomy_policy", proposed_change: "" });
  const [submitting, setSubmitting] = useState(false);
  const [castingVote, setCastingVote] = useState<{ voteId: string; option: string } | null>(null);

  const load = useCallback(async () => {
    const [v, a] = await Promise.all([
      apiFetch<{ votes: Vote[] }>("/api/v1/votes"),
      apiFetch<{ amendments: Amendment[] }>("/api/v1/amendments"),
    ]);
    setVotes(v?.votes ?? []);
    setAmendments(a?.amendments ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openVote() {
    if (!voteForm.title.trim()) return;
    setSubmitting(true);
    await apiPost("/api/v1/votes", {
      title: voteForm.title.trim(),
      description: voteForm.description.trim() || undefined,
      options: voteForm.options.split(",").map(s => s.trim()).filter(Boolean),
      quorum: Number(voteForm.quorum),
      threshold: Number(voteForm.threshold),
    });
    setVoteForm({ title: "", description: "", options: "Yes,No", quorum: "51", threshold: "51" });
    setSubmitting(false);
    load();
  }

  async function castVote(voteId: string, option: string) {
    setCastingVote({ voteId, option });
    await apiPost(`/api/v1/votes/${voteId}/cast`, { option });
    setCastingVote(null);
    load();
  }

  async function closeVote(voteId: string) {
    await apiPost(`/api/v1/votes/${voteId}/close`, {});
    load();
  }

  async function proposeAmendment() {
    if (!amendForm.title.trim()) return;
    setSubmitting(true);
    await apiPost("/api/v1/amendments", {
      title: amendForm.title.trim(),
      description: amendForm.description.trim() || undefined,
      artifact_type: amendForm.artifact_type,
      proposed_change: amendForm.proposed_change.trim() || undefined,
    });
    setAmendForm(f => ({ ...f, title: "", description: "", proposed_change: "" }));
    setSubmitting(false);
    load();
  }

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Member Votes</h2>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        {(["votes", "amendments"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: tab === t ? 600 : 400,
            color: tab === t ? "var(--brand)" : "var(--text-secondary)",
            background: "none", borderBottom: tab === t ? "2px solid var(--brand)" : "2px solid transparent", marginBottom: -1, textTransform: "capitalize",
          }}>
            {t === "votes" ? `Votes (${votes.length})` : `Amendments (${amendments.length})`}
          </button>
        ))}
      </div>

      {tab === "votes" && (
        <Card title="Votes">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ padding: "12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 2 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Motion title</label>
                  <input value={voteForm.title} onChange={e => setVoteForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Approve Q3 budget increase" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Options (comma-sep)</label>
                  <input value={voteForm.options} onChange={e => setVoteForm(f => ({ ...f, options: e.target.value }))} style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
                </div>
                <div style={{ width: 70 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Quorum %</label>
                  <input type="number" value={voteForm.quorum} onChange={e => setVoteForm(f => ({ ...f, quorum: e.target.value }))} style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button onClick={openVote} disabled={submitting || !voteForm.title.trim()} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>
                    Open vote
                  </button>
                </div>
              </div>
            </div>
            {votes.length === 0 ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No votes yet.</p> : votes.map(v => (
              <div key={v.vote_id} style={{ padding: "14px 16px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{v.title}</p>
                    {v.description && <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "3px 0 0" }}>{v.description}</p>}
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 0" }}>Opened {relativeTime(v.opened_at)}{v.closes_at ? ` · closes ${relativeTime(v.closes_at)}` : ""}</p>
                  </div>
                  <StatusBadge status={v.status} />
                  {v.status === "open" && (
                    <button onClick={() => closeVote(v.vote_id)} style={{ fontSize: 11, padding: "3px 10px", background: "none", border: "1px solid var(--border)", borderRadius: 4 }}>Close</button>
                  )}
                </div>
                {v.tally && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  {Object.entries(v.tally).map(([opt, count]) => (
                    <span key={opt} style={{ fontSize: 12, padding: "3px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>{opt}: {count}</span>
                  ))}
                </div>}
                {v.status === "open" && v.options && (
                  <div style={{ display: "flex", gap: 8 }}>
                    {v.options.map(opt => (
                      <button key={opt} onClick={() => castVote(v.vote_id, opt)} disabled={castingVote?.voteId === v.vote_id} style={{ background: "var(--brand)", color: "#fff", padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: "var(--radius)" }}>
                        {castingVote?.voteId === v.vote_id && castingVote.option === opt ? "Casting…" : `Vote ${opt}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "amendments" && (
        <Card title="Amendments">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ padding: "12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 2 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Title</label>
                  <input value={amendForm.title} onChange={e => setAmendForm(f => ({ ...f, title: e.target.value }))} placeholder="Amendment title" style={{ width: "100%", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Artifact type</label>
                  <select value={amendForm.artifact_type} onChange={e => setAmendForm(f => ({ ...f, artifact_type: e.target.value }))} style={{ width: "100%", padding: "7px 10px", fontSize: 13 }}>
                    {["autonomy_policy", "collective_config", "cadence_protocol", "objective_config", "business_profile", "agent_blueprint"].map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button onClick={proposeAmendment} disabled={submitting || !amendForm.title.trim()} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>
                    Propose
                  </button>
                </div>
              </div>
              <textarea value={amendForm.proposed_change} onChange={e => setAmendForm(f => ({ ...f, proposed_change: e.target.value }))} placeholder="Describe the proposed change…" rows={3} style={{ resize: "vertical", padding: "8px 10px", fontSize: 13, width: "100%", boxSizing: "border-box" }} />
            </div>
            {amendments.length === 0 ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No amendments proposed.</p> : amendments.map(a => (
              <div key={a.amendment_id} style={{ padding: "12px 14px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{a.title}</p>
                    {a.description && <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "3px 0 0" }}>{a.description}</p>}
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 0" }}>Proposed {relativeTime(a.proposed_at)} · {a.artifact_type?.replace(/_/g, " ")}</p>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
                {a.proposed_change && <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "8px 0 0", paddingTop: 8, borderTop: "1px solid var(--border)" }}>{a.proposed_change}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
