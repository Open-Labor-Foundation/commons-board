"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, relativeTime } from "../../lib/api";

type ArtifactType = "business_profile" | "objective_config" | "autonomy_policy" | "cadence_protocol" | "agent_blueprint" | "collective_config";
type ArtifactRecord = { artifact_id: string; version: number; created_at: string; payload?: Record<string, unknown> };

const DOCS: { id: ArtifactType; label: string; description: string }[] = [
  { id: "business_profile",  label: "Business Profile",    description: "Your organization's identity, industry, size, and operating model" },
  { id: "objective_config",  label: "Goals & KPIs",        description: "Primary objectives, success criteria, and key performance indicators" },
  { id: "cadence_protocol",  label: "Meeting Schedule",    description: "When and how your board delivers briefings and check-ins" },
  { id: "agent_blueprint",   label: "Board Composition",   description: "Your board chairs, their domains, and what they manage" },
  { id: "autonomy_policy",   label: "Delegation Policy",   description: "What the board can decide independently vs. what needs your approval" },
  { id: "collective_config", label: "Governance Rules",    description: "Membership structure, voting thresholds, and collective decision rules" },
];

function renderPayload(type: ArtifactType, payload: Record<string, unknown>): React.ReactNode {
  if (type === "business_profile") {
    const loc = payload.location as { primary?: string; regions?: string[] } | undefined;
    const size = payload.size as { headcount?: number; member_count?: number } | undefined;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Row label="Organization" value={String(payload.org_name ?? "—")} />
        <Row label="Governance" value={payload.governance_mode === "collective" ? "Worker cooperative / collective" : "Business / company"} />
        <Row label="Industry" value={String(payload.industry ?? "—")} />
        <Row label="Description" value={String(payload.description ?? "—")} />
        <Row label="Operating since" value={String(payload.operating_since ?? "—")} />
        {loc && <Row label="Location" value={[loc.primary, ...(loc.regions ?? [])].filter(Boolean).join(" · ")} />}
        {size && <Row label="Team size" value={`${size.headcount ?? 0} people${size.member_count != null ? ` · ${size.member_count} members` : ""}`} />}
        {Array.isArray(payload.external_systems) && payload.external_systems.length > 0 && (
          <Row label="Connected tools" value={(payload.external_systems as string[]).join(", ")} />
        )}
      </div>
    );
  }

  if (type === "objective_config") {
    const objectives = (payload.primary_objectives as Array<Record<string, unknown>>) ?? [];
    const kpis = (payload.kpis as Array<Record<string, unknown>>) ?? [];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {objectives.length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 8px" }}>Objectives</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {objectives.map((obj, i) => (
                <div key={i} style={{ background: "var(--surface-overlay)", borderRadius: "var(--radius)", padding: "10px 12px", border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>
                    #{obj.priority as number ?? i + 1}: {String(obj.description ?? "")}
                  </p>
                  {obj.target_date != null && <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>Target: {String(obj.target_date)}</p>}
                  {Array.isArray(obj.success_criteria) && (
                    <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
                      {(obj.success_criteria as string[]).map((c, j) => (
                        <li key={j} style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 2 }}>{c}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {kpis.length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 8px" }}>Key Metrics</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
              {kpis.map((kpi, i) => (
                <div key={i} style={{ background: "var(--surface-overlay)", borderRadius: "var(--radius)", padding: "10px 12px", border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 12, fontWeight: 600, margin: "0 0 4px" }}>{String(kpi.name ?? "")}</p>
                  <p style={{ fontSize: 13, fontWeight: 700, margin: "0 0 2px", color: "var(--brand)" }}>
                    {kpi.current_value != null ? String(kpi.current_value) : "—"} {String(kpi.unit ?? "")}
                  </p>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
                    Target: {kpi.target_value != null ? String(kpi.target_value) : "—"} · {String(kpi.reporting_cadence ?? "")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        {Array.isArray(payload.constraints) && (payload.constraints as string[]).length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 8px" }}>Constraints</p>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {(payload.constraints as string[]).map((c, i) => (
                <li key={i} style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (type === "cadence_protocol") {
    const daily = payload.daily as Record<string, unknown> | undefined;
    const weekly = payload.weekly as Record<string, unknown> | undefined;
    const monthly = payload.monthly as Record<string, unknown> | undefined;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {daily && (
          <ScheduleRow
            title="Daily"
            enabled={!!daily.enabled}
            detail={`${String(daily.run_at ?? "")} ${String(daily.timezone ?? "")} · ${String(daily.output ?? "pulse")}`}
          />
        )}
        {weekly && (
          <ScheduleRow
            title="Weekly"
            enabled={!!weekly.enabled}
            detail={`${String(weekly.run_on ?? "monday")}s at ${String(weekly.run_at ?? "")} ${String(weekly.timezone ?? "")} · ${String(weekly.output ?? "brief")}`}
          />
        )}
        {monthly && (
          <ScheduleRow
            title="Monthly"
            enabled={!!monthly.enabled}
            detail={`Day ${String(monthly.run_on_day ?? 1)} of the month · ${String(monthly.output ?? "review")}`}
          />
        )}
      </div>
    );
  }

  if (type === "agent_blueprint") {
    const chairs = (payload.chairs as Array<Record<string, unknown>>) ?? [];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {chairs.map((chair, i) => (
          <div key={i} style={{ display: "flex", gap: 10, padding: "9px 12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 2px" }}>{String(chair.name ?? "")}</p>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>{String(chair.description ?? "")}</p>
            </div>
            <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{String(chair.domain ?? "")}</span>
          </div>
        ))}
      </div>
    );
  }

  if (type === "autonomy_policy") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {Object.entries(payload).filter(([k]) => k !== "org_id" && k !== "schema_version").map(([k, v]) => (
          <Row key={k} label={k.replace(/_/g, " ")} value={typeof v === "object" ? JSON.stringify(v) : String(v ?? "—")} />
        ))}
      </div>
    );
  }

  if (type === "collective_config") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {Object.entries(payload).filter(([k]) => k !== "org_id" && k !== "schema_version").map(([k, v]) => (
          <Row key={k} label={k.replace(/_/g, " ")} value={typeof v === "object" ? JSON.stringify(v) : String(v ?? "—")} />
        ))}
      </div>
    );
  }

  return <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>Document loaded.</p>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 13, borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
      <span style={{ fontWeight: 600, color: "var(--text-secondary)", minWidth: 140, flexShrink: 0, textTransform: "capitalize" }}>{label}</span>
      <span style={{ color: "var(--text-primary)", flex: 1 }}>{value}</span>
    </div>
  );
}

function ScheduleRow({ title, enabled, detail }: { title: string; enabled: boolean; detail: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: enabled ? "#16a34a" : "var(--text-muted)", flexShrink: 0 }} />
      <div>
        <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 2px" }}>{title} briefing</p>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>{enabled ? detail : "Disabled"}</p>
      </div>
    </div>
  );
}

export default function BoardDocumentsPage() {
  const [selected, setSelected] = useState<ArtifactType>("business_profile");
  const [record, setRecord] = useState<ArtifactRecord | null>(null);
  const [history, setHistory] = useState<ArtifactRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (type: ArtifactType) => {
    setLoading(true);
    setRecord(null);
    const [latest, hist] = await Promise.all([
      apiFetch<ArtifactRecord>(`/api/v1/artifacts/${type}/latest`),
      apiFetch<{ versions: ArtifactRecord[] }>(`/api/v1/artifacts/${type}`),
    ]);
    setRecord(latest ?? null);
    setHistory(hist?.versions ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(selected); }, [selected, load]);

  const docInfo = DOCS.find(d => d.id === selected)!;

  return (
    <div style={{ padding: 24, maxWidth: 960 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Board Documents</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
          The governing documents that define how your board operates.
        </p>
      </div>

      {/* Document selector */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, marginBottom: 24 }}>
        {DOCS.map(doc => (
          <button
            key={doc.id}
            onClick={() => setSelected(doc.id)}
            style={{
              display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", textAlign: "left", cursor: "pointer",
              background: selected === doc.id ? "var(--brand-light)" : "var(--surface)",
              border: `1px solid ${selected === doc.id ? "var(--brand)" : "var(--border)"}`,
              borderRadius: "var(--radius)",
            }}
          >
            <p style={{ fontSize: 12, fontWeight: 700, color: selected === doc.id ? "var(--brand)" : "var(--text-primary)", margin: 0 }}>{doc.label}</p>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, lineHeight: 1.35 }}>{doc.description}</p>
          </button>
        ))}
      </div>

      {loading && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>}

      {!loading && (
        <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface-overlay)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{docInfo.label}</span>
              {record && (
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 10 }}>
                  Version {record.version} · Updated {relativeTime(record.created_at)}
                </span>
              )}
            </div>
            <a href="/onboarding" style={{ fontSize: 12, color: "var(--brand)", textDecoration: "none", fontWeight: 500 }}>
              Update via interview →
            </a>
          </div>

          <div style={{ padding: "16px" }}>
            {!record ? (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-secondary)", margin: "0 0 8px" }}>
                  {docInfo.label} not yet configured
                </p>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px" }}>
                  {docInfo.description}. This document is created during the board setup interview.
                </p>
                <a href="/onboarding" style={{ display: "inline-block", background: "var(--brand)", color: "#fff", padding: "9px 18px", borderRadius: "var(--radius)", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>
                  Start board interview →
                </a>
              </div>
            ) : (
              renderPayload(selected, (record.payload ?? {}) as Record<string, unknown>)
            )}
          </div>

          {history.length > 1 && (
            <div style={{ borderTop: "1px solid var(--border)", padding: "10px 16px" }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
                {history.length} versions · first created {relativeTime(history[0]?.created_at ?? "")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
