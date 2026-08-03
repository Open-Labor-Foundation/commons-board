import fs from "node:fs";
import path from "node:path";
import { readRegistry, writeRegistry, getAddinDir, isValidAddinId, type CatalogPack } from "./addin-registry.js";

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Joins a relative path onto packDir and verifies the result is still
 * inside it -- relativePath segments (artifact type names, seed refs, page
 * component names) come from catalog data, which can be a self-hosted,
 * operator-configured URL (ADDINS_CATALOG_URL), not necessarily trusted the
 * way this repo's own bundled catalog is. Returns null instead of writing
 * outside packDir.
 */
function safePackPath(packDir: string, relativePath: string): string | null {
  const resolved = path.resolve(packDir, relativePath);
  const resolvedRoot = path.resolve(packDir) + path.sep;
  if (!resolved.startsWith(resolvedRoot)) return null;
  return resolved;
}

/** Best-effort GET of one pack file. Returns null on any failure (missing file, network error, timeout) -- never throws. */
async function fetchPackFile(baseUrl: string, relativePath: string): Promise<string | null> {
  try {
    const url = `${baseUrl.replace(/\/$/, "")}/${relativePath}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Fetches one pack file and writes it under packDir if both the fetch and the path check succeed. Returns true on success. */
async function fetchAndWritePackFile(baseUrl: string, packDir: string, relativePath: string): Promise<boolean> {
  const dest = safePackPath(packDir, relativePath);
  if (!dest) return false;
  const content = await fetchPackFile(baseUrl, relativePath);
  if (content === null) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  return true;
}

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

/**
 * Installs a pack: writes its manifest, then fetches its real content
 * (schemas, page components, seeds, README) from source_url onto disk.
 *
 * Previously this only ever wrote manifest.json -- no addin's schemas, page
 * components, or seeds have ever existed on disk at runtime for any pack,
 * ever, which is why gig-cooperative/startup-launch's artifact writes and
 * page rendering were both broken beneath a manifest that looked complete.
 *
 * Per-file fetch, not a tarball: the manifest already fully enumerates every
 * file a pack needs (artifact_types -> schemas/<type>.schema.json,
 * pages[].component -> pages/<component>.tsx, seeds[] -> their own listed
 * relative paths), so no catalog format change is needed. A file a pack
 * hasn't published yet is logged and skipped, not a failed install -- no
 * existing catalog pack should start failing to install because of this.
 */
export async function installPack(pack: CatalogPack): Promise<InstallResult> {
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
    seeds: pack.seeds,
    inference_need: pack.inference_need,
  };
  fs.writeFileSync(path.join(packDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  if (pack.source_url) {
    const missing: string[] = [];

    for (const artifactType of pack.artifact_types) {
      const relativePath = `schemas/${artifactType}.schema.json`;
      const ok = await fetchAndWritePackFile(pack.source_url, packDir, relativePath);
      if (!ok) missing.push(relativePath);
    }

    for (const page of pack.pages ?? []) {
      const relativePath = `pages/${page.component}.tsx`;
      const ok = await fetchAndWritePackFile(pack.source_url, packDir, relativePath);
      if (!ok) missing.push(relativePath);
    }

    for (const seedRef of pack.seeds ?? []) {
      const ok = await fetchAndWritePackFile(pack.source_url, packDir, seedRef);
      if (!ok) missing.push(seedRef);
    }

    const readmeOk = await fetchAndWritePackFile(pack.source_url, packDir, "README.md");
    if (!readmeOk) missing.push("README.md");

    if (missing.length > 0) {
      console.warn(
        `[CB] Pack "${pack.id}" installed with ${missing.length} file(s) not yet available at its source: ${missing.join(", ")}`
      );
    }
  }

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
