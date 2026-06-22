"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPut } from "../../lib/api";

type Settings = {
  workspaceName?: string;
  org_name?: string;
  governanceMode?: string;
  governance_mode?: string;
  providerName?: string;
  provider_name?: string;
  modelName?: string;
  model_name?: string;
  apiKeyEnv?: string;
  api_key_env?: string;
  apiKeyConfigured?: boolean;
};

const PROVIDERS = [
  { id: "featherless", label: "Featherless AI", defaultModel: "Qwen/Qwen3-32B", defaultKeyEnv: "FEATHERLESS_API_KEY" },
  { id: "openai", label: "OpenAI", defaultModel: "gpt-4o", defaultKeyEnv: "OPENAI_API_KEY" },
  { id: "anthropic", label: "Anthropic", defaultModel: "claude-sonnet-4-6", defaultKeyEnv: "ANTHROPIC_API_KEY" },
  { id: "other", label: "Other / Self-hosted", defaultModel: "", defaultKeyEnv: "MODEL_API_KEY" },
];

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [orgName, setOrgName] = useState("");
  const [govMode, setGovMode] = useState("collective");
  const [provider, setProvider] = useState("featherless");
  const [modelName, setModelName] = useState("");
  const [apiKeyEnv, setApiKeyEnv] = useState("");
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);

  const load = useCallback(async () => {
    const s = await apiFetch<Settings>("/api/v1/settings");
    if (s) {
      setOrgName(s.workspaceName ?? s.org_name ?? "");
      setGovMode(s.governanceMode ?? s.governance_mode ?? "collective");
      setProvider(s.providerName ?? s.provider_name ?? "featherless");
      setModelName(s.modelName ?? s.model_name ?? "");
      setApiKeyEnv(s.apiKeyEnv ?? s.api_key_env ?? "");
      setApiKeyConfigured(s.apiKeyConfigured ?? false);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleProviderChange(p: string) {
    const def = PROVIDERS.find(x => x.id === p);
    setProvider(p);
    if (def?.defaultModel) setModelName(def.defaultModel);
    if (def?.defaultKeyEnv) setApiKeyEnv(def.defaultKeyEnv);
  }

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    const { status } = await apiPut("/api/v1/settings", {
      workspaceName: orgName.trim(),
      governanceMode: govMode,
      providerName: provider,
      modelName: modelName.trim(),
      apiKeyEnv: apiKeyEnv.trim(),
    });
    setSaving(false);
    if (status >= 400) { setError("Failed to save. Check API connectivity."); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>Settings</h2>
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 24px" }}>Workspace configuration and AI provider settings.</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Workspace */}
        <Section title="Workspace">
          <Field label="Workspace name">
            <input
              type="text"
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              placeholder="e.g. Acme Workers Cooperative"
              style={{ width: "100%", padding: "9px 12px", fontSize: 14, boxSizing: "border-box" }}
            />
          </Field>
          <Field label="Governance mode">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {([
                ["collective", "Collective", "Democratic board — decisions require member consensus or votes"],
                ["business", "Business", "Executive board — decisions made by designated chairs and operators"],
              ] as const).map(([val, label, desc]) => (
                <label key={val} style={{
                  display: "flex", gap: 12, padding: "12px 14px",
                  border: `1px solid ${govMode === val ? "var(--brand)" : "var(--border)"}`,
                  borderRadius: "var(--radius)",
                  background: govMode === val ? "var(--brand-light)" : "var(--surface)",
                  cursor: "pointer",
                }}>
                  <input type="radio" name="govmode" value={val} checked={govMode === val} onChange={() => setGovMode(val)} style={{ marginTop: 2 }} />
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{label}</p>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 0" }}>{desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </Field>
        </Section>

        {/* Provider */}
        <Section title="AI Provider">
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
            The inference provider powers board chat and autonomous actions. API keys must be set as environment variables — they are never stored here.
          </p>
          <Field label="Provider">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {PROVIDERS.map(p => (
                <label key={p.id} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
                  border: `1px solid ${provider === p.id ? "var(--brand)" : "var(--border)"}`,
                  borderRadius: "var(--radius)",
                  background: provider === p.id ? "var(--brand-light)" : "var(--surface)",
                  cursor: "pointer", fontSize: 13,
                }}>
                  <input type="radio" name="provider" value={p.id} checked={provider === p.id} onChange={() => handleProviderChange(p.id)} />
                  {p.label}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Model name">
            <input
              type="text"
              value={modelName}
              onChange={e => setModelName(e.target.value)}
              placeholder="e.g. Qwen/Qwen3-32B"
              style={{ width: "100%", padding: "9px 12px", fontSize: 14, boxSizing: "border-box" }}
            />
          </Field>
          <Field label="API key environment variable">
            <input
              type="text"
              value={apiKeyEnv}
              onChange={e => setApiKeyEnv(e.target.value)}
              placeholder="e.g. FEATHERLESS_API_KEY"
              style={{ width: "100%", padding: "9px 12px", fontSize: 14, boxSizing: "border-box" }}
            />
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "5px 0 0" }}>
              Name of the env var only — not the key itself. Key status: {" "}
              <strong style={{ color: apiKeyConfigured ? "#16a34a" : "#dc2626" }}>
                {apiKeyConfigured ? "configured" : "not found"}
              </strong>
            </p>
          </Field>
        </Section>

        {error && <p style={{ fontSize: 13, color: "var(--error)", margin: 0 }}>{error}</p>}

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={save} disabled={saving} style={{ background: "var(--brand)", color: "#fff", padding: "10px 24px", fontSize: 14, fontWeight: 600 }}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          {saved && <span style={{ fontSize: 13, color: "#16a34a", fontWeight: 500 }}>Saved.</span>}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
      </div>
      <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}
