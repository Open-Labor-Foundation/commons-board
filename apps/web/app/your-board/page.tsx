"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

type Chair = {
  chair_id: string;
  name: string;
  domain: string;
  description: string;
  scope: { owns: string[] };
  approval_required_for?: string[];
};

type BoardArtifact = { artifact_id: string; payload?: { chairs?: Chair[] } };

const DOMAIN_COLOR: Record<string, string> = {
  finance: "#16a34a", ops: "#2563eb", legal: "#7c3aed", hr: "#d97706",
  strategy: "#4f46e5", product: "#0891b2", security: "#dc2626",
  rnd: "#ca8a04", it: "#0284c7", sales: "#db2777", growth: "#65a30d", custom: "#64748b",
};

function domainColor(domain: string) { return DOMAIN_COLOR[domain] ?? "#64748b"; }

// "owns" often just restates the description in full-sentence form — drop anything
// that isn't distinct from it, and keep the rest short enough to scan.
function distinctHandles(owns: string[], description: string): string[] {
  return owns
    .filter(o => o.trim() !== description.trim())
    .map(o => (o.length > 60 ? o.slice(0, 57).trimEnd() + "…" : o));
}

export default function YourBoardPage() {
  const [chairs, setChairs] = useState<Chair[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<BoardArtifact>("/api/v1/artifacts/agent_blueprint/latest").then((bp) => {
      setChairs((bp?.payload as { chairs?: Chair[] })?.chairs ?? []);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading board…</span>
      </div>
    );
  }

  if (chairs.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 40 }}>
        <div style={{ maxWidth: 400, textAlign: "center" }}>
          <p style={{ fontSize: 15, fontWeight: 600, margin: "0 0 8px", color: "var(--text-primary)" }}>No board configured yet</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 20px" }}>Complete your board profile to meet your advisors.</p>
          <Link href="/onboarding" style={{ display: "inline-block", background: "var(--brand)", color: "#fff", padding: "10px 24px", borderRadius: "var(--radius)", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>
            Set up my board →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 28px", overflowY: "auto", height: "100%" }}>
      <div style={{ maxWidth: 900 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px", color: "var(--text-primary)" }}>Your Board</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            {chairs.length} advisor{chairs.length !== 1 ? "s" : ""} · <Link href="/org" style={{ color: "var(--brand)", textDecoration: "none" }}>Board structure →</Link>
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {chairs.map((chair) => {
            const color = domainColor(chair.domain);
            const handles = distinctHandles(chair.scope?.owns ?? [], chair.description).slice(0, 2);
            const approvalCount = chair.approval_required_for?.length ?? 0;
            return (
              <div
                key={chair.chair_id}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-lg)",
                  padding: "16px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: "50%",
                    background: color + "18", border: `2px solid ${color}`,
                    flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color }}>{chair.domain.slice(0, 2).toUpperCase()}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "var(--text-primary)", lineHeight: 1.3 }}>{chair.name}</p>
                    <p style={{ fontSize: 11, color, margin: "2px 0 0", fontWeight: 600, textTransform: "capitalize" }}>{chair.domain}</p>
                  </div>
                  {approvalCount > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#92400e", background: "#fefce8", border: "1px solid #fde68a", borderRadius: 10, padding: "3px 8px", flexShrink: 0, whiteSpace: "nowrap" }}>
                      {approvalCount} needs sign-off
                    </span>
                  )}
                </div>

                <p style={{
                  fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5,
                  overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                }}>
                  {chair.description}
                </p>

                {handles.length > 0 && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {handles.map(h => (
                      <span key={h} style={{ fontSize: 11, background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: 8, padding: "2px 8px", color: "var(--text-muted)" }}>
                        {h.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
                  <Link
                    href={`/dashboard?ask=${encodeURIComponent(chair.name)}`}
                    style={{
                      background: "none", border: `1px solid ${color}`, color,
                      borderRadius: "var(--radius)", padding: "6px 12px",
                      fontSize: 13, fontWeight: 600, textDecoration: "none",
                    }}
                  >
                    Ask →
                  </Link>
                  <Link
                    href={`/board/${chair.chair_id}`}
                    style={{
                      background: color + "12", border: `1px solid ${color}40`, color,
                      borderRadius: "var(--radius)", padding: "6px 12px",
                      fontSize: 13, fontWeight: 600, textDecoration: "none",
                    }}
                  >
                    View team →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
