export type LinkedProvider = "github" | "gitlab" | "bitbucket" | "azure" | "gitea";

export type LinkedProviderConfig = {
  provider: LinkedProvider;
  token: string;
  owner: string;
  repo: string;
  projectId?: string;
  baseBranch?: string;
  remoteUrl?: string;
};

export type LinkedIssue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  created_at?: string;
  updated_at?: string;
  source_ref?: string;
};

type AzureOrgProject = {
  org: string;
  project: string;
};

function requiredToken(config: LinkedProviderConfig): string {
  const token = String(config.token ?? "").trim();
  if (!token) throw new Error(`${config.provider} token is required`);
  return token;
}

function providerBaseUrl(config: LinkedProviderConfig): string {
  const remote = String(config.remoteUrl ?? "").trim();
  if (config.provider === "gitlab") return "https://gitlab.com";
  if (config.provider === "gitea") return remote || "http://localhost:3001";
  if (config.provider === "bitbucket") return "https://api.bitbucket.org";
  if (config.provider === "azure") return "https://dev.azure.com";
  return "";
}

function urlNoGitSuffix(input: string): string {
  return input.replace(/\.git$/i, "");
}

function parseAzureOrgProject(config: LinkedProviderConfig): AzureOrgProject {
  const fromProjectId = String(config.projectId ?? "").trim();
  if (fromProjectId.includes("/")) {
    const [org, project] = fromProjectId.split("/");
    if (org && project) return { org, project };
  }
  const remote = urlNoGitSuffix(String(config.remoteUrl ?? "").trim());
  const match = remote.match(/^https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)$/i);
  if (match) return { org: match[1], project: match[2] };
  throw new Error("azure configuration requires projectId=org/project or remoteUrl");
}

function parseGitLabProjectPath(config: LinkedProviderConfig): string {
  const projectId = String(config.projectId ?? "").trim();
  if (projectId) return projectId;
  if (config.owner && config.repo) return `${config.owner}/${config.repo}`;
  throw new Error("gitlab configuration requires projectId or owner+repo");
}

async function providerRequest(
  config: LinkedProviderConfig,
  input: { method?: "GET" | "POST" | "PUT" | "PATCH"; path: string; body?: unknown; query?: string }
): Promise<Response> {
  const method = input.method ?? "GET";
  const token = requiredToken(config);
  const base = providerBaseUrl(config);
  const query = input.query ? `${input.query.startsWith("?") ? "" : "?"}${input.query}` : "";
  const url = `${base}${input.path}${query}`;
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (config.provider === "gitlab") {
    headers["PRIVATE-TOKEN"] = token;
  } else if (config.provider === "bitbucket") {
    headers["authorization"] = `Bearer ${token}`;
  } else if (config.provider === "azure") {
    headers["authorization"] = `Basic ${Buffer.from(`:${token}`).toString("base64")}`;
  } else if (config.provider === "gitea") {
    headers["authorization"] = `token ${token}`;
  }

  return fetch(url, {
    method,
    headers,
    body: input.body !== undefined ? JSON.stringify(input.body) : undefined
  });
}

export function linkedProviderConfigured(config: LinkedProviderConfig): boolean {
  if (!String(config.token ?? "").trim()) return false;
  if (config.provider === "azure") {
    try {
      parseAzureOrgProject(config);
      return true;
    } catch {
      return false;
    }
  }
  if (config.provider === "gitlab") {
    return Boolean(String(config.projectId ?? "").trim() || (config.owner && config.repo));
  }
  return Boolean(config.owner && config.repo);
}

export async function listOpenLinkedIssues(config: LinkedProviderConfig, limit = 50): Promise<LinkedIssue[]> {
  if (config.provider === "gitlab") {
    const project = encodeURIComponent(parseGitLabProjectPath(config));
    const res = await providerRequest(config, {
      path: `/api/v4/projects/${project}/issues`,
      query: `state=opened&per_page=${Math.max(1, Math.min(limit, 100))}&order_by=created_at&sort=asc`
    });
    if (!res.ok) throw new Error(`gitlab list issues failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    return body.map((item) => ({
      number: Number(item.iid ?? 0),
      title: String(item.title ?? "Untitled"),
      body: String(item.description ?? ""),
      labels: Array.isArray(item.labels) ? item.labels.map((label) => String(label)) : [],
      state: String(item.state ?? "opened"),
      created_at: String(item.created_at ?? ""),
      updated_at: String(item.updated_at ?? ""),
      source_ref: `gitlab:issue:${String(item.iid ?? "0")}`
    }));
  }

  if (config.provider === "gitea") {
    const res = await providerRequest(config, {
      path: `/api/v1/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/issues`,
      query: `state=open&limit=${Math.max(1, Math.min(limit, 100))}`
    });
    if (!res.ok) throw new Error(`gitea list issues failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    return body.map((item) => ({
      number: Number(item.number ?? 0),
      title: String(item.title ?? "Untitled"),
      body: String(item.body ?? ""),
      labels: Array.isArray(item.labels) ? item.labels.map((label) => String((label as Record<string, unknown>).name ?? "")) : [],
      state: String(item.state ?? "open"),
      created_at: String(item.created_at ?? ""),
      updated_at: String(item.updated_at ?? ""),
      source_ref: `gitea:issue:${String(item.number ?? "0")}`
    }));
  }

  if (config.provider === "bitbucket") {
    const res = await providerRequest(config, {
      path: `/2.0/repositories/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/issues`,
      query: `q=${encodeURIComponent('state="new" OR state="open"')}&sort=created_on&pagelen=${Math.max(1, Math.min(limit, 100))}`
    });
    if (!res.ok) throw new Error(`bitbucket list issues failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { values?: Array<Record<string, unknown>> };
    return (body.values ?? []).map((item) => ({
      number: Number(item.id ?? 0),
      title: String(item.title ?? "Untitled"),
      body: String(item.content && typeof item.content === "object" ? (item.content as Record<string, unknown>).raw ?? "" : ""),
      labels: Array.isArray(item.kind) ? (item.kind as string[]) : [],
      state: String(item.state ?? "open"),
      created_at: String(item.created_on ?? ""),
      updated_at: String(item.updated_on ?? ""),
      source_ref: `bitbucket:issue:${String(item.id ?? "0")}`
    }));
  }

  if (config.provider === "azure") {
    const { org, project } = parseAzureOrgProject(config);
    const wiql = await providerRequest(config, {
      method: "POST",
      path: `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/wiql`,
      query: "api-version=7.0",
      body: {
        query: `Select [System.Id] From WorkItems Where [System.TeamProject] = '${project}' And [System.State] <> 'Closed' Order By [System.CreatedDate] Asc`
      }
    });
    if (!wiql.ok) throw new Error(`azure wiql failed (${wiql.status}): ${await wiql.text()}`);
    const wiqlBody = (await wiql.json()) as { workItems?: Array<{ id: number }> };
    const ids = (wiqlBody.workItems ?? []).slice(0, Math.max(1, Math.min(limit, 100))).map((item) => item.id);
    if (ids.length === 0) return [];
    const workItems = await providerRequest(config, {
      path: `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/workitems`,
      query: `api-version=7.0&ids=${ids.join(",")}&fields=System.Id,System.Title,System.Description,System.State,System.Tags,System.CreatedDate,System.ChangedDate`
    });
    if (!workItems.ok) throw new Error(`azure workitems failed (${workItems.status}): ${await workItems.text()}`);
    const workItemsBody = (await workItems.json()) as { value?: Array<{ id?: number; fields?: Record<string, unknown> }> };
    return (workItemsBody.value ?? []).map((item) => {
      const fields = item.fields ?? {};
      return {
        number: Number(item.id ?? 0),
        title: String(fields["System.Title"] ?? "Untitled"),
        body: String(fields["System.Description"] ?? ""),
        labels: String(fields["System.Tags"] ?? "")
          .split(";")
          .map((tag) => tag.trim())
          .filter(Boolean),
        state: String(fields["System.State"] ?? "open"),
        created_at: String(fields["System.CreatedDate"] ?? ""),
        updated_at: String(fields["System.ChangedDate"] ?? ""),
        source_ref: `azure:workitem:${String(item.id ?? "0")}`
      };
    });
  }

  throw new Error(`unsupported provider: ${config.provider}`);
}

export async function commentOnLinkedIssue(config: LinkedProviderConfig, issueNumber: number, comment: string): Promise<void> {
  if (config.provider === "gitlab") {
    const project = encodeURIComponent(parseGitLabProjectPath(config));
    const res = await providerRequest(config, {
      method: "POST",
      path: `/api/v4/projects/${project}/issues/${issueNumber}/notes`,
      body: { body: comment }
    });
    if (!res.ok) throw new Error(`gitlab issue comment failed (${res.status}): ${await res.text()}`);
    return;
  }
  if (config.provider === "gitea") {
    const res = await providerRequest(config, {
      method: "POST",
      path: `/api/v1/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/issues/${issueNumber}/comments`,
      body: { body: comment }
    });
    if (!res.ok) throw new Error(`gitea issue comment failed (${res.status}): ${await res.text()}`);
    return;
  }
  if (config.provider === "bitbucket") {
    const res = await providerRequest(config, {
      method: "POST",
      path: `/2.0/repositories/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/issues/${issueNumber}/comments`,
      body: { content: { raw: comment } }
    });
    if (!res.ok) throw new Error(`bitbucket issue comment failed (${res.status}): ${await res.text()}`);
    return;
  }
  if (config.provider === "azure") return;
}

export async function transitionLinkedIssue(config: LinkedProviderConfig, issueNumber: number, nextStatus: "done" | "blocked" | "failed" | "in_progress"): Promise<void> {
  if (config.provider === "gitlab") {
    const project = encodeURIComponent(parseGitLabProjectPath(config));
    const stateEvent = nextStatus === "done" ? "close" : "reopen";
    const res = await providerRequest(config, {
      method: "PUT",
      path: `/api/v4/projects/${project}/issues/${issueNumber}`,
      body: { state_event: stateEvent }
    });
    if (!res.ok) throw new Error(`gitlab issue transition failed (${res.status}): ${await res.text()}`);
    return;
  }
  if (config.provider === "gitea") {
    const state = nextStatus === "done" ? "closed" : "open";
    const res = await providerRequest(config, {
      method: "PATCH",
      path: `/api/v1/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/issues/${issueNumber}`,
      body: { state }
    });
    if (!res.ok) throw new Error(`gitea issue transition failed (${res.status}): ${await res.text()}`);
    return;
  }
  if (config.provider === "bitbucket") {
    const state = nextStatus === "done" ? "resolved" : "open";
    const res = await providerRequest(config, {
      method: "PUT",
      path: `/2.0/repositories/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/issues/${issueNumber}`,
      body: { state }
    });
    if (!res.ok) throw new Error(`bitbucket issue transition failed (${res.status}): ${await res.text()}`);
    return;
  }
  if (config.provider === "azure") {
    const { org, project } = parseAzureOrgProject(config);
    const state = nextStatus === "done" ? "Closed" : "Active";
    const res = await fetch(
      `${providerBaseUrl(config)}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/workitems/${issueNumber}?api-version=7.0`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json-patch+json",
          "authorization": `Basic ${Buffer.from(`:${requiredToken(config)}`).toString("base64")}`
        },
        body: JSON.stringify([{ op: "add", path: "/fields/System.State", value: state }])
      }
    );
    if (!res.ok) throw new Error(`azure workitem transition failed (${res.status}): ${await res.text()}`);
    return;
  }
}

export async function createLinkedPullRequest(input: {
  config: LinkedProviderConfig;
  title: string;
  body: string;
  head: string;
  base: string;
}): Promise<string> {
  const config = input.config;
  if (config.provider === "gitlab") {
    const project = encodeURIComponent(parseGitLabProjectPath(config));
    const res = await providerRequest(config, {
      method: "POST",
      path: `/api/v4/projects/${project}/merge_requests`,
      body: {
        title: input.title,
        description: input.body,
        source_branch: input.head,
        target_branch: input.base
      }
    });
    if (!res.ok) throw new Error(`gitlab create MR failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { web_url?: string };
    return String(json.web_url ?? "");
  }
  if (config.provider === "gitea") {
    const res = await providerRequest(config, {
      method: "POST",
      path: `/api/v1/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/pulls`,
      body: {
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base
      }
    });
    if (!res.ok) throw new Error(`gitea create PR failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { html_url?: string };
    return String(json.html_url ?? "");
  }
  if (config.provider === "bitbucket") {
    const res = await providerRequest(config, {
      method: "POST",
      path: `/2.0/repositories/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/pullrequests`,
      body: {
        title: input.title,
        description: input.body,
        source: { branch: { name: input.head } },
        destination: { branch: { name: input.base } }
      }
    });
    if (!res.ok) throw new Error(`bitbucket create PR failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { links?: { html?: { href?: string } } };
    return String(json.links?.html?.href ?? "");
  }
  if (config.provider === "azure") {
    const { org, project } = parseAzureOrgProject(config);
    const res = await providerRequest(config, {
      method: "POST",
      path: `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(config.repo)}/pullrequests`,
      query: "api-version=7.0",
      body: {
        title: input.title,
        description: input.body,
        sourceRefName: `refs/heads/${input.head}`,
        targetRefName: `refs/heads/${input.base}`
      }
    });
    if (!res.ok) throw new Error(`azure create PR failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { url?: string };
    return String(json.url ?? "");
  }
  throw new Error(`unsupported provider: ${config.provider}`);
}
