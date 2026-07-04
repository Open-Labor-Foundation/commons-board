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

export function loadConfig(): ApiConfig {
  return {
    port: Number(process.env.PORT ?? 4000),
    nodeEnv: process.env.NODE_ENV ?? "development",
    databaseUrl: process.env.DATABASE_URL ?? "",
    dataDir: process.env.CB_DATA_DIR ?? ".data",
    strictSigning: process.env.CB_GOVERNANCE_STRICT_SIGNING === "true"
  };
}
