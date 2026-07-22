/**
 * Vault connector — secret retrieval with pluggable backends.
 *
 * Supports two backends:
 *   1. HashiCorp Vault (when VAULT_ADDR + VAULT_TOKEN set)
 *   2. Environment-variable fallback (reads secrets from process.env directly)
 *
 * The env fallback is for local/dev — production uses Vault. Callers
 * never need to know which backend is active; they call getSecret(path)
 * and get the value back.
 *
 * Required env vars for Vault backend:
 *   VAULT_ADDR   — Vault server URL (e.g., https://vault.yourorg.com)
 *   VAULT_TOKEN  — Vault auth token
 *
 * For env fallback, no env vars are needed — secrets are read from
 * process.env[secretName] directly.
 */

export type VaultSecret = {
  value: string;
  leaseId?: string;
  leaseDuration?: number;
  renewable?: boolean;
  backend: "vault" | "env";
};

function isVaultConfigured(): boolean {
  return Boolean(process.env.VAULT_ADDR && process.env.VAULT_TOKEN);
}

/**
 * Retrieve a secret from Vault (KV v2) or fall back to process.env.
 *
 * @param path  Vault KV path (e.g., "secret/data/stripe" for KV v2)
 *              or env var name when using env fallback
 * @param key   Key within the secret data (Vault) — ignored for env fallback
 */
export async function getSecret(path: string, key: string): Promise<VaultSecret> {
  if (isVaultConfigured()) {
    return getSecretFromVault(path, key);
  }

  // Env fallback
  const value = process.env[key] ?? process.env[path];
  if (value === undefined) {
    throw new Error(`Secret not found: ${key} (env fallback — set ${key} in environment)`);
  }
  return { value, backend: "env" };
}

async function getSecretFromVault(path: string, key: string): Promise<VaultSecret> {
  const addr = process.env.VAULT_ADDR!;
  const token = process.env.VAULT_TOKEN!;

  const url = `${addr.replace(/\/$/, "")}/v1/${path}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { "X-Vault-Token": token }
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Vault API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    lease_id?: string;
    lease_duration?: number;
    renewable?: boolean;
    data?: {
      data?: Record<string, string>;
    };
  };

  const secretData = data.data?.data;
  if (!secretData || !(key in secretData)) {
    throw new Error(`Secret key "${key}" not found at Vault path "${path}"`);
  }

  return {
    value: secretData[key],
    leaseId: data.lease_id,
    leaseDuration: data.lease_duration,
    renewable: data.renewable,
    backend: "vault"
  };
}

/**
 * Retrieve multiple secrets at once. Returns a map of key → value.
 * Uses a single Vault read per path, then extracts all requested keys.
 */
export async function getSecrets(
  path: string,
  keys: string[]
): Promise<Record<string, string>> {
  if (isVaultConfigured()) {
    const addr = process.env.VAULT_ADDR!;
    const token = process.env.VAULT_TOKEN!;
    const url = `${addr.replace(/\/$/, "")}/v1/${path}`;

    const res = await fetch(url, {
      method: "GET",
      headers: { "X-Vault-Token": token }
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Vault API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
      data?: { data?: Record<string, string> };
    };

    const secretData = data.data?.data ?? {};
    const result: Record<string, string> = {};
    for (const key of keys) {
      if (key in secretData) {
        result[key] = secretData[key];
      }
    }
    return result;
  }

  // Env fallback
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Check which backend is active.
 */
export function getVaultBackend(): "vault" | "env" {
  return isVaultConfigured() ? "vault" : "env";
}