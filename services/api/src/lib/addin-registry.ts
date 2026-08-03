import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const _dirname = path.dirname(fileURLToPath(import.meta.url));
const ADDINS_DIR = process.env.ADDINS_DIR ?? path.resolve(_dirname, "../../../../addins");

// Local catalog path used in development when ADDINS_CATALOG_URL is not set.
// Resolves to <OLF>/artifact-commons/catalog.json -- commons-artifacts'
// addin-economy role moved there (see artifact-commons' own README); the
// two packs with real content (gig-cooperative, startup-launch) migrated
// with it, and this is the only place that pointed at the old location.
const LOCAL_CATALOG_PATH =
  process.env.ADDINS_CATALOG_PATH ??
  path.resolve(ADDINS_DIR, "../../artifact-commons/catalog.json");

export type AddinNavItem = { href: string; label: string };

/**
 * The capability contract (OLF Managed Inference §5): a declaration of the
 * grade of inference an artifact requires, expressed against an abstraction
 * that EITHER a managed Foundry backend OR a customer self-hosted endpoint
 * can satisfy. This is a DECLARATION (what the artifact needs), distinct from
 * commons-crew's ProviderCapabilities (what the transport can do) and from
 * the governance ledger's model-version provenance (what was actually used).
 * Keeping these three axes separate is what prevents the two fulfillment
 * modes from forking into diverging codebases.
 *
 * Mirrors artifact-commons/schemas/inference-need.schema.json exactly -- that
 * schema is the certification gate's source of truth precisely because it's
 * the same shape the real consumer (this type) already parses.
 */
export type InferenceNeed = {
  determination_type: "chat" | "planning" | "execution" | "synthesis";
  model_class: string;
  context: {
    min_tokens: number;
    typical_input_tokens?: number;
    typical_output_tokens?: number;
  };
  version_pin: {
    declared_version: string;
    pin_policy?: "exact" | "minor" | "any";
  };
  disclosed_cost: {
    expected_tokens_per_call: number;
    basis: "measured" | "estimated" | "upper_bound";
    measured_at?: string;
  };
  drift_reconciliation?: {
    threshold_ratio: number;
    action_on_drift?: "flag_for_recost" | "block_until_recost" | "downgrade_to_estimated";
  };
};

export type AddinManifest = {
  id: string;
  version: string;
  name: string;
  description: string;
  author?: string;
  cb_min_version?: string;
  artifact_types: string[];
  nav?: { heading: string; items: AddinNavItem[] };
  pages?: Array<{ route: string; component: string }>;
  seeds?: string[];
  /** Optional in v1. Declares the managed-inference need (§5). Absent = no managed-inference requirement. */
  inference_need?: InferenceNeed;
};

export type CatalogPack = AddinManifest & {
  tags?: string[];
  source_url?: string;
  readme_url?: string;
};

const ADDIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Reject anything that isn't a bare, filesystem-safe addin id (no path separators or traversal). */
export function isValidAddinId(id: string): boolean {
  return ADDIN_ID_PATTERN.test(id);
}

// ── Registry helpers ────────────────────────────────────────────────────────

export function readRegistry(): string[] {
  try {
    const raw = fs.readFileSync(path.join(ADDINS_DIR, "registry.json"), "utf-8");
    const data = JSON.parse(raw) as { installed?: string[] };
    return Array.isArray(data.installed) ? data.installed : [];
  } catch {
    return [];
  }
}

export function writeRegistry(ids: string[]): void {
  fs.mkdirSync(ADDINS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(ADDINS_DIR, "registry.json"),
    JSON.stringify({ version: "1", installed: ids }, null, 2),
  );
}

// ── Manifest helpers ────────────────────────────────────────────────────────

function readManifest(packId: string): AddinManifest | null {
  if (!isValidAddinId(packId)) return null;
  try {
    const raw = fs.readFileSync(path.join(ADDINS_DIR, packId, "manifest.json"), "utf-8");
    return JSON.parse(raw) as AddinManifest;
  } catch {
    return null;
  }
}

export function getInstalledAddins(): AddinManifest[] {
  return readRegistry().flatMap(id => {
    const m = readManifest(id);
    return m ? [m] : [];
  });
}

export function getAddinArtifactTypes(): string[] {
  return getInstalledAddins().flatMap(a => a.artifact_types);
}

// ── Catalog ─────────────────────────────────────────────────────────────────

export async function fetchCatalog(catalogUrl?: string): Promise<CatalogPack[]> {
  const remoteUrl = catalogUrl ?? process.env.ADDINS_CATALOG_URL;

  if (remoteUrl) {
    const resp = await fetch(remoteUrl);
    if (!resp.ok) throw new Error(`Catalog fetch failed: ${resp.status}`);
    const data = (await resp.json()) as { packs?: CatalogPack[] };
    return data.packs ?? [];
  }

  // Local filesystem fallback (development / single-machine installs)
  try {
    const raw = fs.readFileSync(LOCAL_CATALOG_PATH, "utf-8");
    const data = JSON.parse(raw) as { packs?: CatalogPack[] };
    return data.packs ?? [];
  } catch {
    throw new Error("No catalog URL configured. Set one in Settings > Add-ins.");
  }
}

export function getAddinDir(): string {
  return ADDINS_DIR;
}
