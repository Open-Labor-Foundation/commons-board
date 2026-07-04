"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "../../../lib/api";

type CatalogPack = {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  artifact_types: string[];
  tags?: string[];
  installed: boolean;
  requires_rebuild?: boolean;
  readme_url?: string;
  nav?: { heading: string; items: unknown[] };
  pages?: unknown[];
};

type InstallState = "idle" | "working" | "done" | "error";

function renderMarkdown(md: string): string {
  return md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^#### (.+)$/gm, '<h4 style="margin:14px 0 4px;font-size:13px;font-weight:700">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 style="margin:16px 0 6px;font-size:14px;font-weight:700">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="margin:20px 0 8px;font-size:16px;font-weight:700">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="margin:0 0 12px;font-size:18px;font-weight:700">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:var(--surface-overlay);padding:1px 5px;border-radius:3px;font-size:12px;font-family:monospace">$1</code>')
    .replace(/^\|(.+)\|$/gm, (_, row) => {
      const cells = row.split("|").map((c: string) => `<td style="padding:4px 10px;border:1px solid var(--border)">${c.trim()}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .replace(/(<tr>.*<\/tr>\n?)+/gs, m => `<table style="border-collapse:collapse;margin:10px 0;font-size:12px">${m}</table>`)
    .replace(/^- (.+)$/gm, '<li style="margin:3px 0;font-size:13px">$1</li>')
    .replace(/(<li[^>]*>.*<\/li>\n?)+/gs, m => `<ul style="margin:8px 0;padding-left:20px">${m}</ul>`)
    .replace(/\n{2,}/g, '</p><p style="margin:0 0 10px;font-size:13px;line-height:1.6">')
    .replace(/^(?!<[htul])(.+)$/gm, '<p style="margin:0 0 10px;font-size:13px;line-height:1.6">$1</p>')
    .replace(/---/g, '<hr style="border:none;border-top:1px solid var(--border);margin:16px 0">');
}

export default function AddinsPage() {
  const [packs, setPacks] = useState<CatalogPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "installed">("all");
  const [detail, setDetail] = useState<CatalogPack | null>(null);
  const [readme, setReadme] = useState<string | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(false);
  const [installState, setInstallState] = useState<Record<string, InstallState>>({});
  const [installMsg, setInstallMsg] = useState<Record<string, string>>({});
  const [rebuildPending, setRebuildPending] = useState<{ pending: boolean; packs: string[]; since?: string }>({ pending: false, packs: [] });
  const [rebuildState, setRebuildState] = useState<"idle" | "triggering" | "triggered" | "error">("idle");
  const [rebuildError, setRebuildError] = useState<string | null>(null);

  const checkRebuild = useCallback(async () => {
    const r = await apiFetch<{ pending: boolean; packs: string[]; since?: string }>("/api/v1/addins/rebuild-status");
    if (r) setRebuildPending(r);
  }, []);

  async function dismissRebuild() {
    await apiFetch("/api/v1/addins/rebuild-dismiss", { method: "POST" });
    setRebuildPending({ pending: false, packs: [] });
    setRebuildState("idle");
    setRebuildError(null);
  }

  async function triggerRebuild() {
    setRebuildState("triggering");
    setRebuildError(null);
    const result = await apiFetch<{ triggered?: boolean; error?: string }>("/api/v1/addins/rebuild", { method: "POST" });
    if (result?.triggered) {
      setRebuildState("triggered");
    } else {
      setRebuildState("error");
      setRebuildError(result?.error ?? "Rebuild trigger failed.");
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await apiFetch<{ packs: CatalogPack[]; error?: string }>("/api/v1/addins/catalog");
    if (!data) { setError("Could not reach the add-in catalog."); setLoading(false); return; }
    if (data.error && !data.packs?.length) { setError(data.error); setLoading(false); return; }
    setPacks(data.packs ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); checkRebuild(); }, [load, checkRebuild]);

  async function openDetail(pack: CatalogPack) {
    setDetail(pack);
    setReadme(null);
    setReadmeLoading(true);
    // Try local API first (works once pack is installed or in local dev)
    const local = await apiFetch<{ content: string }>(`/api/v1/addins/${pack.id}/readme`);
    if (local?.content) { setReadme(local.content); setReadmeLoading(false); return; }
    // Try remote readme_url
    if (pack.readme_url) {
      try {
        const resp = await fetch(pack.readme_url);
        if (resp.ok) { setReadme(await resp.text()); setReadmeLoading(false); return; }
      } catch {}
    }
    setReadme(null);
    setReadmeLoading(false);
  }

  async function doInstall(pack: CatalogPack) {
    setInstallState(s => ({ ...s, [pack.id]: "working" }));
    setInstallMsg(s => ({ ...s, [pack.id]: "" }));
    const result = await apiFetch<{ installed?: boolean; requires_rebuild?: boolean; error?: string }>(
      `/api/v1/addins/${pack.id}/install`,
      { method: "POST" }
    );
    if (result?.installed) {
      setPacks(prev => prev.map(p => p.id === pack.id ? { ...p, installed: true } : p));
      if (detail?.id === pack.id) setDetail({ ...pack, installed: true });
      const msg = result.requires_rebuild
        ? "Installed. A rebuild is required to activate pages."
        : "Installed and active.";
      setInstallMsg(s => ({ ...s, [pack.id]: msg }));
      setInstallState(s => ({ ...s, [pack.id]: "done" }));
      if (result.requires_rebuild) checkRebuild();
    } else {
      setInstallMsg(s => ({ ...s, [pack.id]: result?.error ?? "Install failed." }));
      setInstallState(s => ({ ...s, [pack.id]: "error" }));
    }
  }

  async function doUninstall(pack: CatalogPack) {
    setInstallState(s => ({ ...s, [pack.id]: "working" }));
    const result = await apiFetch<{ installed?: boolean; error?: string }>(
      `/api/v1/addins/${pack.id}`,
      { method: "DELETE" }
    );
    if (result?.installed === false) {
      setPacks(prev => prev.map(p => p.id === pack.id ? { ...p, installed: false } : p));
      if (detail?.id === pack.id) setDetail({ ...pack, installed: false });
      setInstallMsg(s => ({ ...s, [pack.id]: "Removed. Refresh to update navigation." }));
      setInstallState(s => ({ ...s, [pack.id]: "done" }));
    } else {
      setInstallMsg(s => ({ ...s, [pack.id]: result?.error ?? "Remove failed." }));
      setInstallState(s => ({ ...s, [pack.id]: "error" }));
    }
  }

  const filtered = packs.filter(p => {
    if (tab === "installed" && !p.installed) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.tags?.some(t => t.includes(q));
  });

  const installedCount = packs.filter(p => p.installed).length;

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      {/* Rebuild banner */}
      {rebuildPending.pending && (
        <div style={{
          background: "#fef3c7", border: "1px solid #d97706", borderRadius: "var(--radius)",
          padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "flex-start", gap: 12
        }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#92400e", margin: 0 }}>
              Rebuild required
            </p>
            {rebuildState === "triggered" ? (
              <p style={{ fontSize: 12, color: "#78350f", margin: "3px 0 0" }}>
                Rebuild triggered. The web container is restarting and building — this may take a minute.
                Refresh the page to confirm it is back online, then dismiss this banner.
              </p>
            ) : rebuildState === "error" ? (
              <p style={{ fontSize: 12, color: "#92400e", margin: "3px 0 0" }}>
                {rebuildError} You can also run{" "}
                <code style={{ fontFamily: "monospace", background: "rgba(0,0,0,0.07)", padding: "1px 5px", borderRadius: 3 }}>docker compose up --build web</code> manually.
              </p>
            ) : (
              <p style={{ fontSize: 12, color: "#78350f", margin: "3px 0 0" }}>
                Pack{rebuildPending.packs.length > 1 ? "s" : ""} <strong>{rebuildPending.packs.join(", ")}</strong> declare
                {rebuildPending.packs.length === 1 ? "s" : ""} pages that require a web rebuild to activate.
                Click <strong>Rebuild Now</strong> to restart the web container automatically, or run{" "}
                <code style={{ fontFamily: "monospace", background: "rgba(0,0,0,0.07)", padding: "1px 5px", borderRadius: 3 }}>docker compose up --build web</code> manually.
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {rebuildState !== "triggered" && (
              <button
                onClick={triggerRebuild}
                disabled={rebuildState === "triggering"}
                style={{ background: "#92400e", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: rebuildState === "triggering" ? "not-allowed" : "pointer", opacity: rebuildState === "triggering" ? 0.7 : 1 }}
              >
                {rebuildState === "triggering" ? "Triggering…" : "Rebuild Now"}
              </button>
            )}
            <button
              onClick={dismissRebuild}
              style={{ background: "transparent", color: "#92400e", border: "1px solid #d97706", borderRadius: "var(--radius)", padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 20, display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Add-in Library</h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
            Browse and install configuration packs for your board.
          </p>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search packs..."
          style={{ padding: "7px 12px", fontSize: 13, width: 220, borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--surface)" }}
        />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 20 }}>
        {([["all", `All (${packs.length})`], ["installed", `Installed (${installedCount})`]] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: tab === t ? 600 : 400,
            color: tab === t ? "var(--brand)" : "var(--text-secondary)",
            background: "none", border: "none",
            borderBottom: tab === t ? "2px solid var(--brand)" : "2px solid transparent",
            marginBottom: -1, cursor: "pointer",
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* States */}
      {loading && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading catalog…</p>}
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "var(--radius-lg)", padding: "12px 16px", fontSize: 13, color: "#dc2626" }}>
          {error}
        </div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {search ? "No packs match your search." : tab === "installed" ? "No add-ins installed yet." : "No packs available."}
        </p>
      )}

      {/* Pack grid */}
      {!loading && !error && filtered.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {filtered.map(pack => {
            const state = installState[pack.id] ?? "idle";
            const msg = installMsg[pack.id];
            return (
              <div key={pack.id} style={{ background: "var(--surface)", border: `1px solid ${pack.installed ? "var(--brand)" : "var(--border)"}`, borderRadius: "var(--radius-lg)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Card header */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{pack.name}</span>
                      {pack.installed && (
                        <span style={{ fontSize: 10, fontWeight: 700, background: "var(--brand-light)", color: "var(--brand)", padding: "1px 7px", borderRadius: 10 }}>
                          Installed
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0" }}>
                      {pack.author ?? "Unknown"} · v{pack.version}
                    </p>
                  </div>
                </div>

                {/* Description */}
                <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                  {pack.description}
                </p>

                {/* Metadata */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: 10, padding: "1px 8px" }}>
                    {pack.artifact_types.length} artifact type{pack.artifact_types.length !== 1 ? "s" : ""}
                  </span>
                  {pack.tags?.map(tag => (
                    <span key={tag} style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: 10, padding: "1px 8px" }}>
                      {tag}
                    </span>
                  ))}
                </div>

                {/* Status message */}
                {msg && (
                  <p style={{ fontSize: 11, color: state === "error" ? "#dc2626" : "#16a34a", margin: 0, fontWeight: 500 }}>
                    {msg}
                  </p>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                  <button
                    onClick={() => openDetail(pack)}
                    style={{ flex: 1, padding: "6px 0", fontSize: 12, fontWeight: 500, background: "transparent", border: "1px solid var(--border)", borderRadius: "var(--radius)", cursor: "pointer", color: "var(--text-secondary)" }}
                  >
                    Details
                  </button>
                  {pack.installed ? (
                    <button
                      onClick={() => doUninstall(pack)}
                      disabled={state === "working"}
                      style={{ flex: 1, padding: "6px 0", fontSize: 12, fontWeight: 600, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "var(--radius)", cursor: state === "working" ? "not-allowed" : "pointer", color: "#dc2626", opacity: state === "working" ? 0.6 : 1 }}
                    >
                      {state === "working" ? "Removing…" : "Remove"}
                    </button>
                  ) : (
                    <button
                      onClick={() => doInstall(pack)}
                      disabled={state === "working"}
                      style={{ flex: 1, padding: "6px 0", fontSize: 12, fontWeight: 600, background: "var(--brand)", border: "none", borderRadius: "var(--radius)", cursor: state === "working" ? "not-allowed" : "pointer", color: "#fff", opacity: state === "working" ? 0.6 : 1 }}
                    >
                      {state === "working" ? "Installing…" : "Install"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setDetail(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }}
        >
          <div style={{ width: 520, height: "100vh", background: "var(--surface)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            {/* Detail header */}
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{detail.name}</h3>
                    {detail.installed && (
                      <span style={{ fontSize: 10, fontWeight: 700, background: "var(--brand-light)", color: "var(--brand)", padding: "2px 8px", borderRadius: 10 }}>
                        Installed
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "3px 0 0" }}>
                    {detail.author} · v{detail.version}
                  </p>
                </div>
                <button onClick={() => setDetail(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--text-muted)", padding: "0 4px", lineHeight: 1 }}>×</button>
              </div>

              {/* Detail action */}
              <div style={{ marginTop: 12 }}>
                {detail.installed ? (
                  <button
                    onClick={() => doUninstall(detail)}
                    disabled={installState[detail.id] === "working"}
                    style={{ padding: "7px 18px", fontSize: 13, fontWeight: 600, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "var(--radius)", cursor: "pointer", color: "#dc2626" }}
                  >
                    {installState[detail.id] === "working" ? "Removing…" : "Remove Add-in"}
                  </button>
                ) : (
                  <button
                    onClick={() => doInstall(detail)}
                    disabled={installState[detail.id] === "working"}
                    style={{ padding: "7px 18px", fontSize: 13, fontWeight: 600, background: "var(--brand)", border: "none", borderRadius: "var(--radius)", cursor: "pointer", color: "#fff" }}
                  >
                    {installState[detail.id] === "working" ? "Installing…" : "Install Add-in"}
                  </button>
                )}
                {installMsg[detail.id] && (
                  <p style={{ fontSize: 11, color: installState[detail.id] === "error" ? "#dc2626" : "#16a34a", margin: "6px 0 0", fontWeight: 500 }}>
                    {installMsg[detail.id]}
                  </p>
                )}
              </div>
            </div>

            {/* Pack metadata strip */}
            <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 5px" }}>Artifact Types</p>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {detail.artifact_types.map(t => (
                    <span key={t} style={{ fontSize: 11, background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: 8, padding: "2px 8px", fontFamily: "monospace", color: "var(--text-secondary)" }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              {detail.nav && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 5px" }}>
                    Adds Navigation — {(detail.nav as { heading: string; items: unknown[] }).heading}
                  </p>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {(detail.nav as { heading: string; items: Array<{ label: string }> }).items.map(item => (
                      <span key={item.label} style={{ fontSize: 11, background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: 8, padding: "2px 8px", color: "var(--text-secondary)" }}>
                        {item.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {detail.tags && detail.tags.length > 0 && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {detail.tags.map(t => (
                    <span key={t} style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--surface-overlay)", border: "1px solid var(--border)", borderRadius: 10, padding: "1px 7px" }}>{t}</span>
                  ))}
                </div>
              )}
            </div>

            {/* README */}
            <div style={{ padding: "18px 24px", flex: 1 }}>
              {readmeLoading && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading documentation…</p>}
              {!readmeLoading && readme && (
                <div
                  style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(readme) }}
                />
              )}
              {!readmeLoading && !readme && (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Documentation not available. {detail.readme_url && (
                    <a href={detail.readme_url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>View on GitHub</a>
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
