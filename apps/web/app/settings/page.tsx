"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPut } from "../../lib/api";

type ProviderConfig = {
  provider_id: string;
  kind: string;
  display_name: string;
  model: string;
  api_key?: string | null;
  endpoint: string | null;
  options: Record<string, string | number | boolean>;
  concurrency_lanes?: number;
  concurrency_cost?: number;
};

type WorkspaceSettings = {
  workspace_id: string;
  org_name?: string;
  governance_mode?: string;
  active_provider_id: string;
  providers: ProviderConfig[];
  rbac?: { grants: Record<string, string[]> };
  feature_toggles?: Record<string, boolean>;
  board_settings?: { confidence_floor?: number };
  addin_catalog_url?: string;
  updated_at?: string;
};

const PROVIDERS = [
  { id: "featherless", label: "Featherless AI", defaultModel: "Qwen/Qwen3-32B" },
  { id: "openai", label: "OpenAI", defaultModel: "gpt-4o" },
  { id: "anthropic", label: "Anthropic", defaultModel: "claude-sonnet-4-6" },
  { id: "other", label: "Other / Self-hosted", defaultModel: "" },
];

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [orgName, setOrgName] = useState("");
  const [govMode, setGovMode] = useState<"collective" | "business">("collective");
  const [provider, setProvider] = useState("featherless");
  const [modelName, setModelName] = useState("Qwen/Qwen3-32B");
  // apiKey: the value typed by the user. Empty means "no change" (preserve existing on server).
  const [apiKey, setApiKey] = useState("");
  // keyConfigured: true when the server reports a key is already stored.
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [concurrencyLanes, setConcurrencyLanes] = useState(1);
  const [concurrencyCost, setConcurrencyCost] = useState(1);
  const [confidenceFloor, setConfidenceFloor] = useState(0.45);
  const [catalogUrl, setCatalogUrl] = useState("");

  const load = useCallback(async () => {
    const s = await apiFetch<WorkspaceSettings>("/api/v1/settings");
    if (s) {
      setOrgName(s.org_name ?? "");
      setGovMode((s.governance_mode as "collective" | "business") ?? "collective");
      const activeProvider = s.providers.find(p => p.provider_id === s.active_provider_id);
      if (activeProvider) {
        setProvider(activeProvider.provider_id);
        setModelName(activeProvider.model ?? "");
        // api_key comes back as "configured" if set, "" if not — never the real value.
        setKeyConfigured(activeProvider.api_key === "configured");
        setApiKey("");
        setConcurrencyLanes(activeProvider.concurrency_lanes ?? 1);
        setConcurrencyCost(activeProvider.concurrency_cost ?? 1);
      }
      if (s.board_settings?.confidence_floor != null) {
        setConfidenceFloor(s.board_settings.confidence_floor);
      }
      setCatalogUrl(s.addin_catalog_url ?? "");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleProviderChange(p: string) {
    const def = PROVIDERS.find(x => x.id === p);
    setProvider(p);
    if (def?.defaultModel) setModelName(def.defaultModel);
    setApiKey("");
    setKeyConfigured(false);
  }

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);

    const providerDef = PROVIDERS.find(p => p.id === provider);
    const providerConfig: ProviderConfig = {
      provider_id: provider,
      kind: "hosted_api",
      display_name: providerDef?.label ?? provider,
      model: modelName.trim(),
      // Send the typed key if non-empty; otherwise send "" so the server preserves the existing key.
      api_key: apiKey.trim() || "",
      endpoint: null,
      options: {},
      concurrency_lanes: Math.max(1, concurrencyLanes),
      concurrency_cost: Math.max(1, concurrencyCost),
    };

    const { status } = await apiPut("/api/v1/settings", {
      org_name: orgName.trim() || undefined,
      governance_mode: govMode,
      providers: [providerConfig],
      active_provider_id: provider,
      board_settings: { confidence_floor: confidenceFloor },
      addin_catalog_url: catalogUrl.trim() || "",
    });

    setSaving(false);
    if (status >= 400) { setError("Failed to save settings. Check that the API is reachable."); return; }

    // Reload to reflect the masked key state from the server.
    await load();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>Settings</h2>
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 24px" }}>Workspace configuration and AI provider settings.</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
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

        <Section title="AI Provider">
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
            The inference provider powers board chat and autonomous actions. Your API key is stored on the server.
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
          <Field label="API key">
            {keyConfigured && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>✓ Key configured</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>— enter a new value below to replace it</span>
              </div>
            )}
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={keyConfigured ? "Leave blank to keep existing key" : "Paste your API key"}
              autoComplete="new-password"
              style={{ width: "100%", padding: "9px 12px", fontSize: 14, boxSizing: "border-box" }}
            />
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "5px 0 0" }}>
              Stored on your server. Never returned by the API — leave blank when saving other settings to preserve it.
            </p>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Field label="Concurrency lanes">
              <input
                type="number"
                min={1}
                max={64}
                value={concurrencyLanes}
                onChange={e => setConcurrencyLanes(Math.max(1, parseInt(e.target.value, 10) || 1))}
                style={{ width: "100%", padding: "9px 12px", fontSize: 14, boxSizing: "border-box" }}
              />
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "5px 0 0" }}>
                Total simultaneous inference slots on this API key (Featherless lane allotment).
              </p>
            </Field>
            <Field label="Lane cost per call">
              <input
                type="number"
                min={1}
                max={16}
                value={concurrencyCost}
                onChange={e => setConcurrencyCost(Math.max(1, parseInt(e.target.value, 10) || 1))}
                style={{ width: "100%", padding: "9px 12px", fontSize: 14, boxSizing: "border-box" }}
              />
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "5px 0 0" }}>
                Lanes consumed per call for this model. Check the Featherless model page for the cost.
              </p>
            </Field>
          </div>
          <div style={{ padding: "8px 12px", background: "var(--surface-overlay)", borderRadius: "var(--radius)", fontSize: 12, color: "var(--text-muted)" }}>
            Max parallel calls: <strong style={{ color: "var(--text)" }}>{Math.max(1, Math.floor(concurrencyLanes / Math.max(1, concurrencyCost)))}</strong>
            {" "}— board chat and worker jobs will not exceed this limit simultaneously.
          </div>
        </Section>

        <Section title="Board Reasoning">
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
            Controls how the board chat routing loop scores and filters incoming messages.
          </p>
          <Field label="Intent confidence floor">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={confidenceFloor}
                onChange={e => setConfidenceFloor(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 36, textAlign: "right" }}>
                {(confidenceFloor * 100).toFixed(0)}%
              </span>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "5px 0 0" }}>
              Messages scoring below this threshold are blocked by the reasoning loop. Default 45%.
              Lower values accept more messages; higher values require clearer intent.
            </p>
          </Field>
        </Section>

        <Section title="Add-ins">
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
            Configure the source for the add-in catalog. Point this at a <code style={{ fontSize: 11, fontFamily: "monospace", background: "var(--surface-overlay)", padding: "1px 4px", borderRadius: 3 }}>catalog.json</code> file hosted on GitHub, a CDN, or a local server.
          </p>
          <Field label="Catalog URL">
            <input
              type="url"
              value={catalogUrl}
              onChange={e => setCatalogUrl(e.target.value)}
              placeholder="https://raw.githubusercontent.com/org/repo/main/catalog.json"
              style={{ width: "100%", padding: "9px 12px", fontSize: 14, boxSizing: "border-box" }}
            />
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "5px 0 0" }}>
              Leave blank to use the <code style={{ fontFamily: "monospace" }}>ADDINS_CATALOG_URL</code> env var or a local catalog file.
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

function Field({ label, children }: { title?: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}
