import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FinalizationResult, Finalizer } from "../contracts.js";
import { createPullRequest, githubConfigured, issueComment, resolveGitHubRepo, type GitHubAdapterConfig, type GitHubRepoRef } from "./github-api.js";
import { createLinkedPullRequest, type LinkedProvider, type LinkedProviderConfig } from "./linked-provider-api.js";

type FinalizeInput = Parameters<Finalizer["finalize"]>[0];

function safeGitCommit(workspacePath: string, message: string): string | null {
  try {
    execFileSync("git", ["-C", workspacePath, "add", "-A"], { encoding: "utf8" });
    execFileSync("git", ["-C", workspacePath, "commit", "--allow-empty", "-m", message], { encoding: "utf8" });
    const sha = execFileSync("git", ["-C", workspacePath, "rev-parse", "HEAD"], { encoding: "utf8" });
    return sha.trim();
  } catch {
    return null;
  }
}

function safeGitPush(workspacePath: string, branch: string): void {
  execFileSync("git", ["-C", workspacePath, "push", "-u", "origin", branch], { encoding: "utf8" });
}

export class ProductFinalizer implements Finalizer {
  async finalize(input: FinalizeInput): Promise<FinalizationResult> {
    if (input.testResult.status !== "passed" || input.reviewResult.status !== "approved") {
      return {
        status: input.reviewResult.status === "rejected" ? "failed" : "blocked",
        commit_sha: null,
        pr_url: null,
        local_commit_ref: null,
        closure_notes: ["Finalization blocked by failed quality gates"]
      };
    }

    const commit = input.dryRun ? null : safeGitCommit(input.workspace.workspace_path, `auto(task): ${input.task.id} ${input.task.title}`);
    return {
      status: "completed",
      commit_sha: commit,
      pr_url: null,
      local_commit_ref: commit,
      closure_notes: [input.dryRun ? "dry_run=true; commit skipped" : "local commit attempted"]
    };
  }
}

export class ProjectFinalizer implements Finalizer {
  private readonly provider: "local" | LinkedProvider;
  private readonly githubEnabled: boolean;
  private readonly repoRef: GitHubRepoRef | null;
  private readonly githubConfig?: GitHubAdapterConfig;
  private readonly linkedConfig?: LinkedProviderConfig;
  private readonly baseBranch: string;

  constructor(
    private readonly repoPath: string,
    options?: {
      provider?: "local" | LinkedProvider;
      githubConfig?: GitHubAdapterConfig;
      linkedConfig?: LinkedProviderConfig;
      baseBranch?: string;
    }
  ) {
    this.provider = options?.provider ?? "local";
    this.githubConfig = options?.githubConfig;
    this.linkedConfig = options?.linkedConfig;
    this.githubEnabled = this.provider === "github" && githubConfigured(this.repoPath, options?.githubConfig);
    this.repoRef = this.provider === "github" ? resolveGitHubRepo(this.repoPath, options?.githubConfig) : null;
    this.baseBranch = String(options?.baseBranch ?? process.env.GITHUB_BASE_BRANCH ?? "main").trim() || "main";
  }

  async finalize(input: FinalizeInput): Promise<FinalizationResult> {
    if (input.testResult.status !== "passed" || input.reviewResult.status !== "approved") {
      return {
        status: input.reviewResult.status === "rejected" ? "failed" : "blocked",
        commit_sha: null,
        pr_url: null,
        local_commit_ref: null,
        closure_notes: ["PR creation skipped because quality gates are not green"]
      };
    }

    const issueNumber = Number((input.task.metadata?.issue_number as number | undefined) ?? Number.NaN);
    const localPrUrl = `local://project/pr/${Number.isFinite(issueNumber) ? issueNumber : input.task.id}`;
    const commit = input.dryRun ? null : safeGitCommit(input.workspace.workspace_path, `auto(issue): ${input.task.id} ${input.task.title}`);
    const branch = input.workspace.git_branch ?? `auto/issue-${input.task.id}`;

    if (!input.dryRun && this.provider !== "local" && commit && input.workspace.git_branch) {
      try {
        safeGitPush(input.workspace.workspace_path, input.workspace.git_branch);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          status: "blocked",
          commit_sha: commit,
          pr_url: null,
          local_commit_ref: commit,
          closure_notes: ["Remote push failed", message]
        };
      }
    }

    let prUrl = localPrUrl;
    if (!input.dryRun && this.githubEnabled && this.repoRef && commit && input.workspace.git_branch) {
      try {
        const pr = await createPullRequest({
          repo: this.repoRef,
          title: `auto(issue): ${input.task.title}`,
          body: [
            `Automated by commons-board project mode.`,
            ``,
            `Issue: ${input.task.source_ref ?? "n/a"}`,
            `Task: ${input.task.id}`,
            `Branch: ${input.workspace.git_branch}`,
            ``,
            `## Summary`,
            input.codingResult.summary,
            ``,
            `## Changed Files`,
            ...input.codingResult.changed_files.map((item) => `- ${item}`),
            ``,
            `## Test Result`,
            `- status: ${input.testResult.status}`,
            ...input.testResult.executed_commands.map((cmd) => `- command: ${cmd}`),
            ``,
            `## Reviewer`,
            `- status: ${input.reviewResult.status}`,
            `- risk_level: ${input.reviewResult.risk_level}`
          ].join("\n"),
          head: input.workspace.git_branch,
          base: this.baseBranch,
          config: this.githubConfig
        });
        prUrl = pr.html_url;
        if (Number.isFinite(issueNumber)) {
          await issueComment(this.repoRef, issueNumber, `Opened automated PR: ${pr.html_url}`, this.githubConfig);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          status: "blocked",
          commit_sha: commit,
          pr_url: null,
          local_commit_ref: commit,
          closure_notes: ["GitHub PR creation failed", message]
        };
      }
    }

    if (
      !input.dryRun &&
      this.provider !== "local" &&
      this.provider !== "github" &&
      this.linkedConfig &&
      commit &&
      input.workspace.git_branch
    ) {
      try {
        const linkedPrUrl = await createLinkedPullRequest({
          config: this.linkedConfig,
          title: `auto(issue): ${input.task.title}`,
          body: [
            "Automated by commons-board project mode.",
            "",
            `Issue: ${input.task.source_ref ?? "n/a"}`,
            `Task: ${input.task.id}`,
            `Branch: ${input.workspace.git_branch}`,
            "",
            "## Summary",
            input.codingResult.summary
          ].join("\n"),
          head: input.workspace.git_branch,
          base: this.baseBranch
        });
        if (linkedPrUrl) prUrl = linkedPrUrl;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          status: "blocked",
          commit_sha: commit,
          pr_url: null,
          local_commit_ref: commit,
          closure_notes: ["Linked provider PR creation failed", message]
        };
      }
    }

    const prDir = join(this.repoPath, ".ai", "project", "prs");
    await mkdir(prDir, { recursive: true });
    const prPath = join(prDir, `${input.task.id}.json`);
    await writeFile(
      prPath,
      `${JSON.stringify(
        {
          issue: input.task.source_ref,
          task_id: input.task.id,
          branch,
          summary: input.codingResult.summary,
          changed_files: input.codingResult.changed_files,
          test_result: input.testResult,
          review_result: input.reviewResult,
          commit_sha: commit,
          pr_url: prUrl,
          created_at: new Date().toISOString()
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    return {
      status: "completed",
      commit_sha: commit,
      pr_url: prUrl,
      local_commit_ref: commit,
      closure_notes: ["PR artifact emitted", `pr_artifact=${prPath}`]
    };
  }
}
