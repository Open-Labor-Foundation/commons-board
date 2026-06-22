import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DevTask, TaskProvider, TaskStatus } from "../contracts.js";
import {
  type GitHubAdapterConfig,
  githubConfigured,
  issueComment,
  listOpenIssues,
  resolveGitHubRepo,
  type GitHubRepoRef,
  updateIssue
} from "./github-api.js";
import {
  commentOnLinkedIssue,
  linkedProviderConfigured,
  listOpenLinkedIssues,
  transitionLinkedIssue,
  type LinkedProvider,
  type LinkedProviderConfig
} from "./linked-provider-api.js";

type LocalIssue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "in_progress" | "pr_open" | "closed" | "blocked" | "failed";
  priority?: string;
  created_at?: string;
  updated_at?: string;
};

function now(): string {
  return new Date().toISOString();
}

function sectionLines(body: string, section: string): string[] {
  const regex = new RegExp(`##\\s+${section}([\\s\\S]*?)(\\n##\\s+|$)`, "i");
  const match = body.match(regex);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseAcceptanceCriteria(body: string): string[] {
  const block = sectionLines(body, "Acceptance Criteria");
  const criteria = block
    .map((line) => line.replace(/^-\s*\[\s?\]\s*/i, "").replace(/^-\s*/, "").trim())
    .filter(Boolean);
  return criteria.length > 0 ? criteria : ["Acceptance criteria must be defined in issue body"];
}

function parseConstraints(body: string): string[] {
  const block = sectionLines(body, "Constraints");
  return block.map((line) => line.replace(/^-\s*/, "").trim()).filter(Boolean);
}

function toTask(issue: LocalIssue): DevTask {
  return {
    id: `issue-${issue.number}`,
    title: issue.title,
    description: issue.body,
    priority: issue.priority ?? "medium",
    status: "pending",
    acceptance_criteria: parseAcceptanceCriteria(issue.body),
    constraints: parseConstraints(issue.body),
    labels: issue.labels ?? [],
    source_type: "github_issue",
    source_ref: `github:issue:${issue.number}`,
    repo_target: ".",
    created_at: issue.created_at ?? now(),
    updated_at: issue.updated_at ?? now(),
    metadata: {
      issue_number: issue.number
    }
  };
}

export class GitHubIssueProvider implements TaskProvider {
  private readonly issuesPath: string;
  private readonly repoRef: GitHubRepoRef | null;
  private readonly remoteEnabled: boolean;
  private readonly githubConfig?: GitHubAdapterConfig;
  private readonly provider: "local" | LinkedProvider;
  private readonly linkedConfig?: LinkedProviderConfig;

  constructor(
    private readonly repoPath: string,
    options?: {
      provider?: "local" | LinkedProvider;
      forceLocal?: boolean;
      githubConfig?: GitHubAdapterConfig;
      linkedConfig?: LinkedProviderConfig;
    }
  ) {
    this.issuesPath = join(repoPath, ".ai", "project", "issues.json");
    this.provider = options?.provider ?? "local";
    this.githubConfig = options?.githubConfig;
    this.linkedConfig = options?.linkedConfig;
    this.repoRef = this.provider === "github" ? resolveGitHubRepo(repoPath, options?.githubConfig) : null;
    this.remoteEnabled =
      options?.forceLocal
        ? false
        : this.provider === "github"
          ? githubConfigured(repoPath, options?.githubConfig)
          : this.linkedConfig
            ? linkedProviderConfigured(this.linkedConfig)
            : false;
  }

  private async readIssues(): Promise<LocalIssue[]> {
    try {
      const parsed = JSON.parse(await readFile(this.issuesPath, "utf8")) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item) => item as LocalIssue);
    } catch {
      return [];
    }
  }

  private async writeIssues(issues: LocalIssue[]): Promise<void> {
    await mkdir(join(this.issuesPath, ".."), { recursive: true });
    await writeFile(this.issuesPath, `${JSON.stringify(issues, null, 2)}\n`, "utf8");
  }

  async claimNextTask(): Promise<DevTask | null> {
    if (this.remoteEnabled && this.provider !== "github" && this.linkedConfig) {
      const issues = await listOpenLinkedIssues(this.linkedConfig, 75);
      const next = issues.find((issue) => issue.labels.map((label) => label.toLowerCase()).some((label) => ["ready", "autobot", "auto"].includes(label)));
      if (!next) return null;
      await commentOnLinkedIssue(this.linkedConfig, next.number, "commons-board project mode claimed this issue for execution.");
      return toTask({
        number: next.number,
        title: next.title,
        body: next.body,
        labels: next.labels,
        state: "in_progress",
        created_at: next.created_at,
        updated_at: next.updated_at
      });
    }

    if (this.remoteEnabled && this.repoRef) {
      const issues = await listOpenIssues(this.repoRef, 75, this.githubConfig);
      const next = issues.find((issue) => {
        if (issue.pull_request) return false;
        const labels = (issue.labels ?? []).map((item) => String(item.name ?? "").toLowerCase());
        return labels.some((label) => ["ready", "autobot", "auto"].includes(label));
      });
      if (!next) return null;
      const nextLabels = Array.from(
        new Set([...(next.labels ?? []).map((item) => String(item.name ?? "").trim()).filter(Boolean), "auto-in-progress"])
      );
      await updateIssue(this.repoRef, next.number, { labels: nextLabels }, this.githubConfig);
      await issueComment(this.repoRef, next.number, "commons-board project mode claimed this issue for execution.", this.githubConfig);
      return toTask({
        number: next.number,
        title: next.title,
        body: next.body ?? "",
        labels: nextLabels,
        state: "in_progress",
        created_at: next.created_at,
        updated_at: next.updated_at
      });
    }

    const issues = await this.readIssues();
    const next = issues.find(
      (issue) =>
        issue.state === "open" &&
        issue.labels.map((label) => label.toLowerCase()).some((label) => ["ready", "autobot", "auto"].includes(label))
    );
    if (!next) return null;
    next.state = "in_progress";
    next.updated_at = now();
    await this.writeIssues(issues);
    return toTask(next);
  }

  async transitionTask(taskId: string, nextStatus: TaskStatus): Promise<void> {
    const issueNumber = Number.parseInt(taskId.replace(/^issue-/, ""), 10);
    if (!Number.isFinite(issueNumber)) return;

    if (this.remoteEnabled && this.provider !== "github" && this.linkedConfig) {
      await transitionLinkedIssue(
        this.linkedConfig,
        issueNumber,
        nextStatus === "done" ? "done" : nextStatus === "blocked" ? "blocked" : nextStatus === "failed" ? "failed" : "in_progress"
      );
      const note =
        nextStatus === "done"
          ? "Execution completed and issue closed by commons-board project mode."
          : `Execution transitioned to ${nextStatus}.`;
      await commentOnLinkedIssue(this.linkedConfig, issueNumber, note);
      return;
    }

    if (this.remoteEnabled && this.repoRef) {
      const closeIssue = nextStatus === "done";
      const mappedLabels = closeIssue
        ? ["auto-completed"]
        : nextStatus === "blocked"
          ? ["auto-blocked"]
          : nextStatus === "failed"
            ? ["auto-failed"]
            : ["auto-in-progress"];
      await updateIssue(this.repoRef, issueNumber, {
        state: closeIssue ? "closed" : "open",
        labels: mappedLabels
      }, this.githubConfig);
      const note =
        nextStatus === "done"
          ? "Execution completed and issue closed by commons-board project mode."
          : `Execution transitioned to ${nextStatus}.`;
      await issueComment(this.repoRef, issueNumber, note, this.githubConfig);
      return;
    }

    const issues = await this.readIssues();
    const issue = issues.find((item) => item.number === issueNumber);
    if (!issue) return;

    const mappedState: LocalIssue["state"] =
      nextStatus === "done"
        ? "closed"
        : nextStatus === "blocked"
          ? "blocked"
          : nextStatus === "failed"
            ? "failed"
            : "in_progress";
    issue.state = mappedState;
    issue.updated_at = now();
    await this.writeIssues(issues);
  }
}
