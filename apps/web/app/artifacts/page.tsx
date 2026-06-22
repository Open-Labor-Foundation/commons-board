"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPost, relativeTime } from "../../lib/api";

type ArtifactType = "business_profile" | "objective_config" | "autonomy_policy" | "cadence_protocol" | "agent_blueprint" | "collective_config";

type ArtifactMeta = { type: ArtifactType; version: string; created_at: string; author?: string };
type ArtifactEntry = ArtifactMeta & { content?: Record<string, unknown> };

const ARTIFACT_TYPES: { id: ArtifactType; label: string; description: string; icon: string }[] = [
  { id: "business_profile", label: "Business Profile", description: "Core identity, mission, and operating model", icon: "◎" },
  { id: "objective_config", label: "Objective Config", description: "Goals, KPIs, and success criteria", icon: "⬡" },
  { id: "autonomy_policy", label: "Autonomy Policy", description: "Delegation levels and agent authority boundaries", icon: "⧊" },
  { id: "cadence_protocol", label: "Cadence Protocol", description: "Meeting rhythms, check-ins, and reporting schedules", icon: "◈" },
  { id: "agent_blueprint", label: "Agent Blueprint", description: "PA configuration, skills, and behavioral parameters", icon: "◉" },
  { id: "collective_config", label: "Collective Config", description: "Membership structure, voting rules, and collective governance", icon: "◫" },
];

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

export default function ArtifactsPage() {
  const [selected, setSelected] = useState<ArtifactType>("business_profile");
  const [latest, setLatest] = useState<ArtifactEntry | null>(null);
  const [history, setHistory] = useState<ArtifactMeta[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [jsonInput, setJsonInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [jsonError, setJsonError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async (type: ArtifactType) => {
    setLoading(true);
    setLatest(null);
    setHistory([]);
    const [l, h] = await Promise.all([
      apiFetch<ArtifactEntry>(`/api/v1/artifacts/${type}/latest`),
      apiFetch<{ artifacts: ArtifactMeta[] }>(`/api/v1/artifacts/${type}`),
    ]);
    setLatest(l);
    setHistory(h?.artifacts ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(selected); }, [selected, load]);

  async function loadVersion(type: ArtifactType, version: string) {
    if (expanded === version) { setExpanded(null); setExpandedContent(null); return; }
    const data = await apiFetch<ArtifactEntry>(`/api/v1/artifacts/${type}/${version}`);
    setExpanded(version);
    setExpandedContent(data?.content ?? null);
  }

  async function createArtifact() {
    setJsonError("");
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(jsonInput); }
    catch { setJsonError("Invalid JSON."); return; }
    setSubmitting(true);
    await apiPost(`/api/v1/artifacts/${selected}`, { content: parsed });
    setSubmitting(false);
    setJsonInput("");
    setShowCreate(false);
    load(selected);
  }

  const typeInfo = ARTIFACT_TYPES.find(t => t.id === selected)!;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 960 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Artifacts</h2>

      {/* Type selector */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
        {ARTIFACT_TYPES.map(t => (
          <button key={t.id} onClick={() => setSelected(t.id)} style={{
            display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px",
            background: selected === t.id ? "var(--brand-light)" : "var(--surface)",
            border: `1px solid ${selected === t.id ? "var(--brand)" : "var(--border)"}`,
            borderRadius: "var(--radius)", textAlign: "left", cursor: "pointer",
          }}>
            <span style={{ fontSize: 18, lineHeight: 1.2 }}>{t.icon}</span>
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: selected === t.id ? "var(--brand)" : "var(--text-primary)", margin: 0 }}>{t.label}</p>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0", lineHeight: 1.3 }}>{t.description}</p>
            </div>
          </button>
        ))}
      </div>

      {loading && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>}

      {!loading && (
        <>
          {/* Latest version */}
          <Card
            title={`${typeInfo.label} — latest`}
            action={
              <button onClick={() => { setShowCreate(!showCreate); setJsonError(""); }} style={{ fontSize: 12, padding: "5px 12px", background: "var(--brand)", color: "#fff", fontWeight: 600 }}>
                {showCreate ? "Cancel" : "New version"}
              </button>
            }
          >
            {showCreate && (
              <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8, padding: 12, background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                <label style={{ fontSize: 12, fontWeight: 500 }}>Content (JSON)</label>
                <textarea
                  value={jsonInput}
                  onChange={e => setJsonInput(e.target.value)}
                  rows={8}
                  placeholder={`{\n  "key": "value"\n}`}
                  style={{ resize: "vertical", padding: "8px 10px", fontSize: 12, fontFamily: "monospace", width: "100%", boxSizing: "border-box" }}
                />
                {jsonError && <p style={{ fontSize: 12, color: "var(--error)", margin: 0 }}>{jsonError}</p>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={createArtifact} disabled={submitting || !jsonInput.trim()} style={{ background: "var(--brand)", color: "#fff", padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>
                    {submitting ? "Saving…" : "Save version"}
                  </button>
                </div>
              </div>
            )}
            {latest ? (
              <div>
                <div style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 12, color: "var(--text-muted)" }}>
                  <span>Version: <strong>{latest.version}</strong></span>
                  <span>Created: <strong>{relativeTime(latest.created_at)}</strong></span>
                  {latest.author && <span>Author: <strong>{latest.author}</strong></span>}
                </div>
                <pre style={{ background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px 14px", fontSize: 11, fontFamily: "monospace", overflow: "auto", margin: 0, maxHeight: 300 }}>
                  {JSON.stringify(latest.content, null, 2)}
                </pre>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>No {typeInfo.label} artifact yet. Create the first version above.</p>
            )}
          </Card>

          {/* Version history */}
          {history.length > 1 && (
            <Card title={`Version history (${history.length})`}>
              <div>
                {history.map(h => (
                  <div key={h.version}>
                    <div
                      onClick={() => loadVersion(selected, h.version)}
                      style={{ display: "flex", gap: 12, alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>v{h.version}</span>
                      {h.author && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{h.author}</span>}
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{relativeTime(h.created_at)}</span>
                      <span style={{ fontSize: 11, color: "var(--brand)" }}>{expanded === h.version ? "▲ hide" : "▼ show"}</span>
                    </div>
                    {expanded === h.version && expandedContent && (
                      <pre style={{ background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px 12px", fontSize: 11, fontFamily: "monospace", overflow: "auto", margin: "6px 0 0", maxHeight: 200 }}>
                        {JSON.stringify(expandedContent, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
