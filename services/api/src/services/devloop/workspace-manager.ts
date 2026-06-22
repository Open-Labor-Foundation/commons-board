import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { DevTask, WorkspaceDescriptor, WorkspaceManager } from "./contracts.js";

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 36) || "task";
}

async function hasGit(repoPath: string): Promise<boolean> {
  try {
    const gitPath = join(repoPath, ".git");
    await stat(gitPath);
    return true;
  } catch {
    return false;
  }
}

function canUseGitCli(repoPath: string): boolean {
  try {
    execFileSync("git", ["-C", repoPath, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

export class LocalWorkspaceManager implements WorkspaceManager {
  constructor(private readonly repoPath: string) {}

  async createWorkspace(task: DevTask, runId: string): Promise<WorkspaceDescriptor> {
    const baseAi = join(this.repoPath, ".ai", "workspaces");
    await mkdir(baseAi, { recursive: true });

    const workspaceId = `${task.id}-${Date.now()}`;
    const workspacePath = join(baseAi, workspaceId);

    if ((await hasGit(this.repoPath)) && canUseGitCli(this.repoPath)) {
      const branch = `auto/${task.source_type === "github_issue" ? "issue" : "task"}-${slug(task.id)}-${Date.now().toString().slice(-6)}`;
      execFileSync("git", ["-C", this.repoPath, "worktree", "add", "-b", branch, workspacePath, "HEAD"], { encoding: "utf8" });
      return {
        workspace_id: workspaceId,
        workspace_path: workspacePath,
        cleanup_hint: `git -C ${this.repoPath} worktree remove ${workspacePath}`,
        git_branch: branch
      };
    }

    const tempRoot = await mkdtemp(join(tmpdir(), "cb-devloop-workspace-"));
    const fallbackWorkspace = join(tempRoot, workspaceId);
    await mkdir(fallbackWorkspace, { recursive: true });
    await cp(resolve(this.repoPath), fallbackWorkspace, {
      recursive: true,
      filter: (source) => {
        const blocked = ["node_modules", ".ai/workspaces", "dist", ".next"];
        return !blocked.some((part) => source.includes(part));
      }
    });

    return {
      workspace_id: workspaceId,
      workspace_path: fallbackWorkspace,
      cleanup_hint: `remove directory ${tempRoot}`,
      git_branch: null
    };
  }
}
