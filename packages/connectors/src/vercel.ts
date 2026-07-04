/**
 * Vercel connector.
 * Reads credentials from env vars — never stores keys in code.
 *
 * Required env vars:
 *   VERCEL_TOKEN    — Vercel personal or team access token
 *
 * Optional:
 *   VERCEL_TEAM_ID  — team scope for projects (omit for personal accounts)
 */

type VercelProject = { id: string; name: string; accountId: string };
type VercelDeployment = { id: string; url: string; state: string };

async function vercelFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error("VERCEL_TOKEN env var is not set");

  const teamId = process.env.VERCEL_TEAM_ID;
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://api.vercel.com${path}${teamId ? `${sep}teamId=${teamId}` : ""}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: { message: res.statusText } }))) as {
      error?: { message?: string };
    };
    throw new Error(`Vercel API error ${res.status}: ${err?.error?.message ?? res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export type VercelDeployResult = {
  project_id: string;
  deployment_id: string;
  url: string;
  state: string;
};

export async function vercelDeployTemplate(opts: {
  projectName: string;
  headline: string;
  cta: string;
  framework?: "nextjs" | "vite" | "static";
  envVars?: Record<string, string>;
}): Promise<VercelDeployResult> {
  const slug = opts.projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 52);

  // Create or find the project
  let project: VercelProject;
  try {
    project = await vercelFetch<VercelProject>(`/v9/projects/${slug}`);
  } catch {
    project = await vercelFetch<VercelProject>("/v10/projects", {
      method: "POST",
      body: JSON.stringify({
        name: slug,
        framework: opts.framework ?? "nextjs",
        publicSource: false
      })
    });
  }

  // Deploy
  const envArray = Object.entries(opts.envVars ?? {}).map(([key, value]) => ({
    key,
    value,
    type: "plain" as const,
    target: ["production", "preview"] as const
  }));

  const deployment = await vercelFetch<VercelDeployment>("/v13/deployments", {
    method: "POST",
    body: JSON.stringify({
      name: slug,
      project: project.id,
      target: "production",
      files: [
        {
          file: "index.html",
          data: `<!DOCTYPE html><html><head><title>${opts.headline}</title></head><body><h1>${opts.headline}</h1><p><a href="#">${opts.cta}</a></p></body></html>`
        }
      ],
      env: envArray
    })
  });

  return {
    project_id: project.id,
    deployment_id: deployment.id,
    url: `https://${deployment.url}`,
    state: deployment.state
  };
}
