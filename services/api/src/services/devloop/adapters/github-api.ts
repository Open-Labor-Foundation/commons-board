import { execFileSync } from "node:child_process";

export type GitHubRepoRef = {
  owner: string;
  repo: string;
};

export type GitHubIssue = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: Array<{ name?: string }>;
  pull_request?: unknown;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
};

export type GitHubPullRequest = {
  html_url: string;
  number: number;
};

export type GitHubAdapterConfig = {
  token?: string;
  repository?: string;
  owner?: string;
  repo?: string;
  baseBranch?: string;
};

export function githubToken(config?: GitHubAdapterConfig): string {
  if (config?.token && String(config.token).trim()) return String(config.token).trim();
  return String(process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "").trim();
}

function parseGitHubUrl(url: string): GitHubRepoRef | null {
  const ssh = url.match(/^git@github\.com:([^/]+)\/([^/.]+)(\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };

  const https = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/i);
  if (https) return { owner: https[1], repo: https[2] };
  return null;
}

function resolveFromGitRemote(repoPath: string): GitHubRepoRef | null {
  try {
    const url = execFileSync("git", ["-C", repoPath, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return parseGitHubUrl(url);
  } catch {
    return null;
  }
}

export function resolveGitHubRepo(repoPath: string, config?: GitHubAdapterConfig): GitHubRepoRef | null {
  const combined = String(config?.repository ?? process.env.GITHUB_REPOSITORY ?? "").trim();
  if (combined.includes("/")) {
    const [owner, repo] = combined.split("/");
    if (owner && repo) return { owner, repo };
  }

  const owner = String(config?.owner ?? process.env.GITHUB_OWNER ?? "").trim();
  const repo = String(config?.repo ?? process.env.GITHUB_REPO ?? process.env.GITHUB_REPO_NAME ?? "").trim();
  if (owner && repo) return { owner, repo };

  return resolveFromGitRemote(repoPath);
}

export function githubConfigured(repoPath: string, config?: GitHubAdapterConfig): boolean {
  return githubToken(config).length > 0 && resolveGitHubRepo(repoPath, config) !== null;
}

type RequestInput = {
  repo: GitHubRepoRef;
  method?: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
  config?: GitHubAdapterConfig;
};

export async function githubRequest(input: RequestInput): Promise<Response> {
  const token = githubToken(input.config);
  if (!token) throw new Error("GITHUB_TOKEN/GH_TOKEN is required for GitHub adapter");
  const url = `https://api.github.com/repos/${input.repo.owner}/${input.repo.repo}${input.path}`;
  const response = await fetch(url, {
    method: input.method ?? "GET",
    headers: {
      "accept": "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "commons-board-devloop",
      "x-github-api-version": "2022-11-28",
      "authorization": `Bearer ${token}`
    },
    body: input.body !== undefined ? JSON.stringify(input.body) : undefined
  });
  return response;
}

export async function listOpenIssues(repo: GitHubRepoRef, limit = 50, config?: GitHubAdapterConfig): Promise<GitHubIssue[]> {
  const response = await githubRequest({
    repo,
    path: `/issues?state=open&per_page=${Math.max(1, Math.min(limit, 100))}&sort=created&direction=asc`,
    config
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`github list issues failed (${response.status}): ${body}`);
  }
  return (await response.json()) as GitHubIssue[];
}

export async function updateIssue(
  repo: GitHubRepoRef,
  issueNumber: number,
  body: { state?: "open" | "closed"; labels?: string[] },
  config?: GitHubAdapterConfig
): Promise<void> {
  const response = await githubRequest({
    repo,
    method: "PATCH",
    path: `/issues/${issueNumber}`,
    body,
    config
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`github update issue failed (${response.status}): ${text}`);
  }
}

export async function issueComment(repo: GitHubRepoRef, issueNumber: number, commentBody: string, config?: GitHubAdapterConfig): Promise<void> {
  const response = await githubRequest({
    repo,
    method: "POST",
    path: `/issues/${issueNumber}/comments`,
    body: { body: commentBody },
    config
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`github issue comment failed (${response.status}): ${text}`);
  }
}

export async function createPullRequest(input: {
  repo: GitHubRepoRef;
  title: string;
  body: string;
  head: string;
  base: string;
  config?: GitHubAdapterConfig;
}): Promise<GitHubPullRequest> {
  const response = await githubRequest({
    repo: input.repo,
    method: "POST",
    path: "/pulls",
    body: {
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base
    },
    config: input.config
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`github create PR failed (${response.status}): ${text}`);
  }

  return (await response.json()) as GitHubPullRequest;
}
