/** Redact secret-like fields before logging. Ported from mother-board. */
const REDACT_KEYS = ["token", "authorization", "apikey", "encryptedtoken", "password", "secret", "key"];

export function redactSensitiveData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(input)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (REDACT_KEYS.some((candidate) => normalized.includes(candidate))) {
      output[key] = "[REDACTED]";
      continue;
    }
    output[key] = redactSensitiveData(nested);
  }
  return output;
}
