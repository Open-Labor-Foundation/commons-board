"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPost, humanize, statusColor, relativeTime } from "../../lib/api";

type SpecialistMatch = {
  id: string;
  org_role: string;
  description: string;
  matched_specialist?: string;
  match_score?: number;
  status: string;
  confirmed_at?: string;
};

type OrgGap = {
  gap_id: string;
  description: string;
  priority: "high" | "medium" | "low";
  submitted_at?: string;
  status: string;
};

type CatalogSync = {
  last_sync?: string;
  agent_count?: number;
  status?: string;
};

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 500, background: color + "18", color }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}

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

export default function OrgPage() {
  const [matches, setMatches] = useState<SpecialistMatch[]>([]);
  const [gaps, setGaps] = useState<OrgGap[]>([]);
  const [catalogSync, setCatalogSync] = useState<CatalogSync | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [gapDesc, setGapDesc] = useState("");
  const [gapPriority, setGapPriority] = useState<"high"|"medium"|"low">("medium");
  const [submittingGap, setSubmittingGap] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [m, g, cs] = await Promise.all([
      apiFetch<{ matches: SpecialistMatch[] }>("/api/v1/org/specialist-matches"),
      apiFetch<{ gaps: OrgGap[] }>("/api/v1/org/gaps"),
      apiFetch<CatalogSync>("/api/v1/org/catalog-sync"),
    ]);
    setMatches(m?.matches ?? []);
    setGaps(g?.gaps ?? []);
    setCatalogSync(cs);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function resolveSpecialists() {
    setResolving(true);
    setMsg("");
    const { data } = await apiPost("/api/v1/org/resolve-specialists", {});
    setResolving(false);
    if (data) { setMsg("Resolution complete."); load(); }
    else setMsg("Resolution failed — check API connectivity.");
  }

  async function confirmAll() {
    const unconfirmed = matches.filter(m => m.status !== "confirmed" && m.matched_specialist);
    if (!unconfirmed.length) return;
    await apiPost("/api/v1/org/confirm-specialists", {
      confirmations: unconfirmed.map(m => ({ id: m.id, confirmed: true })),
    });
    load();
  }

  async function submitGap() {
    if (!gapDesc.trim()) return;
    setSubmittingGap(true);
    await apiPost("/api/v1/org/gaps", { description: gapDesc.trim(), priority: gapPriority });
    setGapDesc("");
    setSubmittingGap(false);
    load();
  }

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 960 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Org &amp; Specialists</h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
            Map your org roles to labor-commons specialists and track coverage gaps.
            {catalogSync && ` Catalog: ${catalogSync.agent_count ?? 0} agents`}
            {catalogSync?.last_sync && ` · synced ${relativeTime(catalogSync.last_sync)}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={resolveSpecialists} disabled={resolving} style={{ background: "var(--brand)", color: "#fff", padding: "8px 16px", fontSize: 13, fontWeight: 600 }}>
            {resolving ? "Resolving…" : "Re-resolve specialists"}
          </button>
          {matches.some(m => m.status !== "confirmed" && m.matched_specialist) && (
            <button onClick={confirmAll} style={{ background: "var(--success)", color: "#fff", padding: "8px 16px", fontSize: 13, fontWeight: 600 }}>
              Confirm all
            </button>
          )}
        </div>
      </div>

      {msg && <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{msg}</p>}

      {/* Specialist matches */}
      <Card title={`Specialist matches (${matches.length})`}>
        {matches.length === 0 ? (
          <div style={{ padding: "20px 0", textAlign: "center" }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>No specialist matches yet.</p>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "6px 0 0" }}>
              Use the interview flow to describe your org roles, then run re-resolve to match them to catalog specialists.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 80px", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              <span>Role</span><span>Matched specialist</span><span>Score</span><span>Status</span>
            </div>
            {matches.map(m => (
              <div key={m.id} style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 80px", gap: 8, padding: "10px 0", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{m.org_role}</p>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.description}</p>
                </div>
                <p style={{ fontSize: 12, margin: 0, color: m.matched_specialist ? "var(--text-primary)" : "var(--text-muted)" }}>
                  {m.matched_specialist ?? "—"}
                </p>
                <p style={{ fontSize: 12, margin: 0, color: "var(--text-muted)" }}>
                  {m.match_score != null ? `${Math.round(m.match_score * 100)}%` : "—"}
                </p>
                <StatusBadge label={m.status} color={statusColor(m.status)} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Gaps */}
      <Card
        title={`Coverage gaps (${gaps.length})`}
        action={
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Roles with no suitable specialist in catalog
          </span>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {gaps.length === 0 && <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>No gaps reported.</p>}
          {gaps.map(g => (
            <div key={g.gap_id} style={{ display: "flex", gap: 12, padding: "10px 12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{g.description}</p>
                {g.submitted_at && <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "3px 0 0" }}>Submitted {relativeTime(g.submitted_at)}</p>}
              </div>
              <StatusBadge label={g.priority} color={g.priority === "high" ? "#dc2626" : g.priority === "medium" ? "#d97706" : "#64748b"} />
            </div>
          ))}

          {/* Report a gap */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", margin: 0 }}>Report a gap</p>
            <textarea
              value={gapDesc}
              onChange={(e) => setGapDesc(e.target.value)}
              placeholder="Describe the missing role or capability…"
              rows={2}
              style={{ resize: "vertical", padding: "8px 10px", fontSize: 13, width: "100%", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select value={gapPriority} onChange={(e) => setGapPriority(e.target.value as "high"|"medium"|"low")} style={{ padding: "6px 10px", fontSize: 13 }}>
                <option value="high">High priority</option>
                <option value="medium">Medium priority</option>
                <option value="low">Low priority</option>
              </select>
              <button onClick={submitGap} disabled={submittingGap || !gapDesc.trim()} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>
                {submittingGap ? "Submitting…" : "Submit gap"}
              </button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
