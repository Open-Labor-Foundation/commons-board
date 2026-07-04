import fs from "node:fs";
import path from "node:path";
import { readRegistry, writeRegistry, getAddinDir, isValidAddinId, type CatalogPack } from "./addin-registry.js";

const SIGNALS_DIR = process.env.CB_SIGNALS_DIR ?? "/app/signals";

export function writeRebuildSignal(): void {
  try {
    fs.mkdirSync(SIGNALS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SIGNALS_DIR, "rebuild-web"), new Date().toISOString());
  } catch (err) {
    console.warn("[CB] Could not write rebuild signal:", err instanceof Error ? err.message : err);
  }
}

export type InstallResult = {
  id: string;
  installed: boolean;
  requires_rebuild: boolean;
};

const REBUILD_SIGNAL_FILE = "rebuild-pending.json";

export function getRebuildPending(addinsDir: string): { pending: boolean; packs: string[]; since?: string } {
  try {
    const raw = fs.readFileSync(path.join(addinsDir, REBUILD_SIGNAL_FILE), "utf-8");
    return JSON.parse(raw) as { pending: boolean; packs: string[]; since?: string };
  } catch {
    return { pending: false, packs: [] };
  }
}

export function setRebuildPending(addinsDir: string, packId: string): void {
  const current = getRebuildPending(addinsDir);
  const packs = [...new Set([...current.packs, packId])];
  fs.writeFileSync(
    path.join(addinsDir, REBUILD_SIGNAL_FILE),
    JSON.stringify({ pending: true, packs, since: current.since ?? new Date().toISOString() }, null, 2)
  );
}

export function clearRebuildPending(addinsDir: string): void {
  try { fs.unlinkSync(path.join(addinsDir, REBUILD_SIGNAL_FILE)); } catch { /* already gone */ }
}

export function installPack(pack: CatalogPack): InstallResult {
  if (!isValidAddinId(pack.id)) {
    throw new Error(`invalid addin id "${pack.id}"`);
  }
  const addinsDir = getAddinDir();
  const packDir = path.join(addinsDir, pack.id);

  fs.mkdirSync(packDir, { recursive: true });

  // Write manifest derived from catalog entry
  const manifest = {
    id: pack.id,
    version: pack.version,
    name: pack.name,
    description: pack.description,
    author: pack.author,
    cb_min_version: pack.cb_min_version,
    artifact_types: pack.artifact_types,
    nav: pack.nav,
    pages: pack.pages,
  };
  fs.writeFileSync(path.join(packDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Add to registry if not already present
  const current = readRegistry();
  if (!current.includes(pack.id)) {
    writeRegistry([...current, pack.id]);
  }

  const requires_rebuild = Array.isArray(pack.pages) && pack.pages.length > 0;

  if (requires_rebuild) {
    setRebuildPending(addinsDir, pack.id);
  }

  return { id: pack.id, installed: true, requires_rebuild };
}

export function uninstallPack(packId: string): void {
  const current = readRegistry();
  writeRegistry(current.filter(id => id !== packId));
  // Pack files are kept — allows reinstall without re-downloading.
}

export function readPackReadme(packId: string): string | null {
  if (!isValidAddinId(packId)) return null;
  try {
    const addinsDir = getAddinDir();
    return fs.readFileSync(path.join(addinsDir, packId, "README.md"), "utf-8");
  } catch {
    return null;
  }
}
