/**
 * Jira connector — creates issues via Jira REST API v3.
 * Reads credentials from env vars — never stores keys in code.
 *
 * Required env vars:
 *   JIRA_BASE_URL     — Jira instance base URL (e.g., https://yourorg.atlassian.net)
 *   JIRA_API_TOKEN    — Jira API token
 *   JIRA_USER_EMAIL   — Atlassian account email for basic auth
 *
 * Optional:
 *   JIRA_DEFAULT_PROJECT  — fallback project key when none specified in opts
 */

export type JiraIssueResult = {
  id: string;
  key: string;
  self: string;
  url: string;
};

export type JiraIssueType = {
  name: string;
  description?: string;
};

export async function jiraCreateIssue(opts: {
  projectKey?: string;
  summary: string;
  description?: string;
  issueType?: string;
  labels?: string[];
  priority?: string;
  assigneeAccountId?: string;
  components?: string[];
}): Promise<JiraIssueResult> {
  const baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl) throw new Error("JIRA_BASE_URL env var is not set");

  const token = process.env.JIRA_API_TOKEN;
  if (!token) throw new Error("JIRA_API_TOKEN env var is not set");

  const email = process.env.JIRA_USER_EMAIL;
  if (!email) throw new Error("JIRA_USER_EMAIL env var is not set");

  const projectKey = opts.projectKey ?? process.env.JIRA_DEFAULT_PROJECT;
  if (!projectKey) throw new Error("projectKey is required (or set JIRA_DEFAULT_PROJECT)");

  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    summary: opts.summary,
    issuetype: { name: opts.issueType ?? "Task" }
  };

  if (opts.description) {
    fields.description = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: opts.description }]
        }
      ]
    };
  }

  if (opts.labels && opts.labels.length > 0) {
    fields.labels = opts.labels;
  }

  if (opts.priority) {
    fields.priority = { name: opts.priority };
  }

  if (opts.assigneeAccountId) {
    fields.assignee = { accountId: opts.assigneeAccountId };
  }

  if (opts.components && opts.components.length > 0) {
    fields.components = opts.components.map((name) => ({ name }));
  }

  const auth = Buffer.from(`${email}:${token}`).toString("base64");

  const res = await fetch(`${baseUrl}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ fields })
  });

  const data = (await res.json()) as {
    id?: string;
    key?: string;
    self?: string;
    errorMessages?: string[];
  };

  if (!res.ok || data.errorMessages) {
    throw new Error(`Jira API error: ${data.errorMessages?.join("; ") ?? res.statusText}`);
  }

  return {
    id: data.id ?? "",
    key: data.key ?? "",
    self: data.self ?? "",
    url: `${baseUrl}/browse/${data.key ?? ""}`
  };
}

export type JiraTransition = {
  id: string;
  name: string;
  to: { id: string; name: string };
};

export async function jiraGetTransitions(issueKey: string): Promise<JiraTransition[]> {
  const baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl) throw new Error("JIRA_BASE_URL env var is not set");

  const token = process.env.JIRA_API_TOKEN;
  if (!token) throw new Error("JIRA_API_TOKEN env var is not set");

  const email = process.env.JIRA_USER_EMAIL;
  if (!email) throw new Error("JIRA_USER_EMAIL env var is not set");

  const auth = Buffer.from(`${email}:${token}`).toString("base64");

  const res = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/transitions`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json"
    }
  });

  const data = (await res.json()) as {
    transitions?: JiraTransition[];
    errorMessages?: string[];
  };

  if (!res.ok || data.errorMessages) {
    throw new Error(`Jira API error: ${data.errorMessages?.join("; ") ?? res.statusText}`);
  }

  return data.transitions ?? [];
}

export async function jiraTransitionIssue(issueKey: string, transitionId: string): Promise<void> {
  const baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl) throw new Error("JIRA_BASE_URL env var is not set");

  const token = process.env.JIRA_API_TOKEN;
  if (!token) throw new Error("JIRA_API_TOKEN env var is not set");

  const email = process.env.JIRA_USER_EMAIL;
  if (!email) throw new Error("JIRA_USER_EMAIL env var is not set");

  const auth = Buffer.from(`${email}:${token}`).toString("base64");

  const res = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/transitions`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ transition: { id: transitionId } })
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ errorMessages: [res.statusText] }))) as {
      errorMessages?: string[];
    };
    throw new Error(`Jira API error: ${err.errorMessages?.join("; ") ?? res.statusText}`);
  }
}