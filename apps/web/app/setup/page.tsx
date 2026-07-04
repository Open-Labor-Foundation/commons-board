"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPut } from "../../lib/api";

type Step = "workspace" | "provider" | "done";

const PROVIDERS = [
  { id: "featherless", label: "Featherless AI" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "other", label: "Other / Self-hosted" },
];

const DEFAULT_MODELS: Record<string, string> = {
  featherless: "Qwen/Qwen3-32B",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-6",
  other: "",
};

const DEFAULT_KEY_ENVS: Record<string, string> = {
  featherless: "FEATHERLESS_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  other: "MODEL_API_KEY",
};

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("workspace");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [orgName, setOrgName] = useState("");
  const [governanceMode, setGovernanceMode] = useState<"collective" | "business">("collective");
  const [provider, setProvider] = useState("featherless");
  const [modelName, setModelName] = useState("Qwen/Qwen3-32B");
  const [apiKeyEnv, setApiKeyEnv] = useState("FEATHERLESS_API_KEY");

  function handleProviderChange(p: string) {
    setProvider(p);
    setModelName(DEFAULT_MODELS[p] ?? "");
    setApiKeyEnv(DEFAULT_KEY_ENVS[p] ?? "MODEL_API_KEY");
  }

  async function saveAndFinish() {
    setSaving(true);
    setError("");

    const providerDef = PROVIDERS.find(p => p.id === provider);
    const { data, status } = await apiPut("/api/v1/settings", {
      org_name: orgName.trim(),
      governance_mode: governanceMode,
      providers: [{
        provider_id: provider,
        kind: "hosted_api",
        display_name: providerDef?.label ?? provider,
        model: modelName.trim(),
        api_key_env: apiKeyEnv.trim() || null,
        endpoint: null,
        options: {},
      }],
      active_provider_id: provider,
    });

    setSaving(false);
    if (!data || status >= 400) {
      setError("Failed to save settings. Check that the API is reachable.");
      return;
    }
    setStep("done");
    router.replace("/dashboard");
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--surface-raised)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        width: "100%",
        maxWidth: 480,
        background: "var(--surface)",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow)",
        overflow: "hidden",
      }}>
        <div style={{ background: "var(--brand)", padding: "20px 28px" }}>
          <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginBottom: 4 }}>commons-board</p>
          <h1 style={{ color: "#fff", fontSize: 20, fontWeight: 700, margin: 0 }}>
            {step === "done" ? "You're set up" : "Set up your workspace"}
          </h1>
        </div>

        {step !== "done" && (
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
            {(["workspace", "provider"] as Step[]).map((s, i) => (
              <div key={s} style={{
                flex: 1,
                padding: "10px 16px",
                fontSize: 12,
                fontWeight: step === s ? 600 : 400,
                color: step === s ? "var(--brand)" : "var(--text-muted)",
                borderBottom: step === s ? "2px solid var(--brand)" : "2px solid transparent",
                marginBottom: -1,
              }}>
                {i + 1}. {s === "workspace" ? "Workspace" : "Provider"}
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: 28 }}>
          {step === "workspace" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                  Workspace name
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="e.g. Acme Workers Cooperative"
                  autoFocus
                  style={{ width: "100%", padding: "9px 12px", fontSize: 14, boxSizing: "border-box" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                  Governance mode
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {([
                    ["collective", "Collective", "Democratic board — decisions require member consensus or votes"],
                    ["business", "Business", "Executive board — decisions made by designated chairs and operators"],
                  ] as const).map(([val, label, desc]) => (
                    <label key={val} style={{
                      display: "flex",
                      gap: 12,
                      padding: "12px 14px",
                      border: `1px solid ${governanceMode === val ? "var(--brand)" : "var(--border)"}`,
                      borderRadius: "var(--radius)",
                      background: governanceMode === val ? "var(--brand-light)" : "var(--surface)",
                      cursor: "pointer",
                    }}>
                      <input
                        type="radio"
                        name="governance"
                        value={val}
                        checked={governanceMode === val}
                        onChange={() => setGovernanceMode(val)}
                        style={{ marginTop: 2 }}
                      />
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{label}</p>
                        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 0" }}>{desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setStep("provider")}
                disabled={!orgName.trim()}
                style={{
                  background: "var(--brand)",
                  color: "#fff",
                  padding: "10px 20px",
                  fontWeight: 600,
                  fontSize: 14,
                  alignSelf: "flex-end",
                }}
              >
                Next →
              </button>
            </div>
          )}

          {step === "provider" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
                The inference provider powers board chat and autonomous actions. The API key must be set as an environment variable on the server — it is never stored here.
              </p>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Provider</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {PROVIDERS.map(({ id, label }) => (
                    <label key={id} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 12px",
                      border: `1px solid ${provider === id ? "var(--brand)" : "var(--border)"}`,
                      borderRadius: "var(--radius)",
                      background: provider === id ? "var(--brand-light)" : "var(--surface)",
                      cursor: "pointer",
                      fontSize: 13,
                    }}>
                      <input type="radio" name="provider" value={id} checked={provider === id} onChange={() => handleProviderChange(id)} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Model name</label>
                <input
                  type="text"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder="e.g. Qwen/Qwen3-32B"
                  style={{ width: "100%", padding: "9px 12px", fontSize: 14, boxSizing: "border-box" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                  API key environment variable name
                </label>
                <input
                  type="text"
                  value={apiKeyEnv}
                  onChange={(e) => setApiKeyEnv(e.target.value)}
                  placeholder="e.g. FEATHERLESS_API_KEY"
                  style={{ width: "100%", padding: "9px 12px", fontSize: 14, boxSizing: "border-box" }}
                />
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                  This is the name of the env var — not the key itself. The key must be present in the container environment.
                </p>
              </div>

              {error && <p style={{ fontSize: 13, color: "var(--error)", margin: 0 }}>{error}</p>}

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setStep("workspace")} style={{ background: "none", border: "1px solid var(--border)", padding: "10px 16px", fontSize: 14, color: "var(--text-secondary)" }}>
                  ← Back
                </button>
                <button
                  onClick={saveAndFinish}
                  disabled={saving || !modelName.trim() || !apiKeyEnv.trim()}
                  style={{ background: "var(--brand)", color: "#fff", padding: "10px 20px", fontWeight: 600, fontSize: 14 }}
                >
                  {saving ? "Saving…" : "Finish setup"}
                </button>
              </div>
            </div>
          )}

          {step === "done" && (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>✓</div>
              <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>Workspace configured</p>
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Taking you to the board…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
