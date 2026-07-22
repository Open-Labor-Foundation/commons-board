/**
 * Runtime configuration. All values come from the environment. No secrets are
 * ever hardcoded; defaults are safe local-dev values only.
 */

export interface ApiConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  /** Directory for file-backed state when no database is configured (dev). */
  dataDir: string;
  /** When true, require a real governance signing key (see governance-signing). */
  strictSigning: boolean;
}

/**
 * Inference-queue env-var overrides. All optional — when unset/invalid the
 * queue falls back to its code defaults. These sit BELOW workspace settings in
 * precedence (code defaults < env vars < workspace settings).
 *
 * Parsed once at module load; the queue reads these via `loadInferenceEnv()`.
 */
export interface InferenceEnvConfig {
  /** Override the global queue-depth backpressure limit (default 50). */
  maxQueueDepth: number | null;
  /** Override chair_deliberation maxConcurrent. */
  chairMaxConcurrent: number | null;
  /** Override worker_dispatch timeoutMs. */
  workerTimeoutMs: number | null;
}

/**
 * Parse a positive integer from an env var. Returns null when the var is
 * unset or not a positive integer (invalid values are ignored, not fatal —
 * the queue falls back to its code default rather than refusing to start).
 */
function parsePositiveInt(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function loadConfig(): ApiConfig {
  return {
    port: Number(process.env.PORT ?? 4000),
    nodeEnv: process.env.NODE_ENV ?? "development",
    databaseUrl: process.env.DATABASE_URL ?? "",
    dataDir: process.env.CB_DATA_DIR ?? ".data",
    strictSigning: process.env.CB_GOVERNANCE_STRICT_SIGNING === "true"
  };
}

/**
 * Read the CB_INFERENCE_* env vars. Pure function over process.env so it can
 * be called at module load and is testable. Invalid values resolve to null
 * (→ queue uses its code default).
 */
export function loadInferenceEnv(): InferenceEnvConfig {
  return {
    maxQueueDepth: parsePositiveInt(process.env.CB_INFERENCE_MAX_QUEUE_DEPTH),
    chairMaxConcurrent: parsePositiveInt(
      process.env.CB_INFERENCE_CHAIR_MAX_CONCURRENT
    ),
    workerTimeoutMs: parsePositiveInt(process.env.CB_INFERENCE_WORKER_TIMEOUT_MS),
  };
}
