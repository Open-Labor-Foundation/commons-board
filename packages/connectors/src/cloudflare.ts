/**
 * Cloudflare connector.
 * Reads credentials from env vars — never stores keys in code.
 *
 * Required env vars:
 *   CF_API_TOKEN   — Cloudflare API token with DNS:Edit and KV:Write permissions
 *   CF_ACCOUNT_ID  — Cloudflare account ID
 */

export type DnsRecord = {
  type: "A" | "CNAME" | "TXT" | "MX";
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
};

export type CloudflareConnectorResult = {
  ok: boolean;
  domain: string;
  records_count: number;
  created: number;
  updated: number;
};

type CloudflareApiRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
};

async function cfFetch<T>(path: string, apiToken: string, init?: RequestInit): Promise<T> {
  const url = `https://api.cloudflare.com/client/v4${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const body = (await res.json()) as { success: boolean; errors: { message: string }[]; result: T };
  if (!body.success) {
    throw new Error(`Cloudflare API error: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  return body.result;
}

async function findZoneId(domain: string, apiToken: string): Promise<string> {
  const parts = domain.split(".");
  const zone = parts.slice(-2).join(".");
  const result = await cfFetch<Array<{ id: string; name: string }>>(
    `/zones?name=${encodeURIComponent(zone)}&status=active`,
    apiToken
  );
  if (!result || result.length === 0) {
    throw new Error(`Cloudflare zone not found for domain: ${domain}`);
  }
  return result[0].id;
}

export async function cloudflareUpsertDnsRecords(
  domain: string,
  records: DnsRecord[]
): Promise<CloudflareConnectorResult> {
  const apiToken = process.env.CF_API_TOKEN;
  if (!apiToken) throw new Error("CF_API_TOKEN env var is not set");

  const zoneId = await findZoneId(domain, apiToken);

  const existing = await cfFetch<CloudflareApiRecord[]>(
    `/zones/${zoneId}/dns_records?per_page=100`,
    apiToken
  );

  let created = 0;
  let updated = 0;

  for (const record of records) {
    const match = existing.find(
      (r) => r.type === record.type && r.name === `${record.name}.${domain}`.replace(/\.\.$/, ".")
    );

    const payload = {
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: record.ttl ?? 1,
      proxied: record.proxied ?? false
    };

    if (match) {
      await cfFetch(`/zones/${zoneId}/dns_records/${match.id}`, apiToken, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      updated++;
    } else {
      await cfFetch(`/zones/${zoneId}/dns_records`, apiToken, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      created++;
    }
  }

  return { ok: true, domain, records_count: records.length, created, updated };
}

export async function cloudflareKvPut(
  namespaceId: string,
  key: string,
  value: string
): Promise<{ ok: boolean }> {
  const apiToken = process.env.CF_API_TOKEN;
  const accountId = process.env.CF_ACCOUNT_ID;
  if (!apiToken) throw new Error("CF_API_TOKEN env var is not set");
  if (!accountId) throw new Error("CF_ACCOUNT_ID env var is not set");

  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "text/plain" },
      body: value
    }
  );
  return { ok: true };
}
