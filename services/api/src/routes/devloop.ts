/**
 * Devloop routes — autonomous task execution and project management.
 *
 * Ported from mother-board routes/devloop.ts.
 * Sanitized:
 *   - store.getWorkspaceSettings() → readJson('project-config/...')
 *   - store.updateWorkspaceSettings() → writeJsonAtomic('project-config/...')
 *   - store.* patterns fully removed
 *   - "Mother-Board" → "commons-board" in all user-facing strings
 *   - DATA_PATH env var retained (generic, deployment-injected)
 *   - DEVLOOP_PRODUCT_ROOT retained (generic)
 *   - tokenFromEnvRef() unchanged — reads env var NAME from config, resolves at runtime
 *
 * Routes:
 *   GET  /api/v1/devloop/contracts                         — service contracts
 *   GET  /api/v1/devloop/project/provider-status          — configured provider status
 *   GET  /api/v1/devloop/project/provider-recommendation  — AI provider recommendation
 *   POST /api/v1/devloop/project/provider-recommendation/apply — apply recommendation
 *   POST /api/v1/devloop/product/run-next                 — product mode run
 *   POST /api/v1/devloop/project/run-next                 — project mode run
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { requireContext, requireRole } from "../lib/auth.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import { LocalArtifactStore } from "../services/devloop/artifact-store.js";
import { AICodingAgent } from "../services/devloop/coding-agent.js";
import { CITestRunner } from "../services/devloop/ci-test-runner.js";
import { ProductFinalizer, ProjectFinalizer } from "../services/devloop/adapters/finalizers.js";
import { GitHubIssueProvider } from "../services/devloop/adapters/github-issue-provider.js";
import { LocalBacklogTaskProvider } from "../services/devloop/adapters/local-backlog-provider.js";
import { AIPlannerAgent } from "../services/devloop/planner-agent.js";
import { AIReviewerAgent } from "../services/devloop/reviewer-agent.js";
import { LocalStateStore } from "../services/devloop/state-store.js";
import { TaskOrchestrator } from "../services/devloop/task-orchestrator.js";
import { LocalWorkspaceManager } from "../services/devloop/workspace-manager.js";
import { githubConfigured, resolveGitHubRepo, type GitHubAdapterConfig } from "../services/devloop/adapters/github-api.js";
import { linkedProviderConfigured, type LinkedProviderConfig } from "../services/devloop/adapters/linked-provider-api.js";
import {
  DEVLOOP_RETRY_BUDGETS,
  DEVLOOP_RUN_STATES,
  DEVLOOP_SERVICE_CONTRACTS,
  DEVLOOP_TASK_STATES
} from "../services/devloop/specs.js";

export const devloopRouter = Router();
devloopRouter.use(requireContext);

type RunBody = {
  repo_path?: string;
  dry_run?: boolean;
  profile?: "default" | "unit" | "integration" | "lint" | "build";
};

type ProjectProvider = "local" | "github" | "gitlab" | "bitbucket" | "azure" | "gitea";
type ProjectSystemConfig = {
  provider: ProjectProvider;
  repoPath: string;
  remoteUrl: string;
  tokenEnvVar: string;
  owner: string;
  repo: string;
  projectId: string;
  baseBranch: string;
};

type ProjectProviderRecommendation = {
  recommended_provider: ProjectProvider;
  confidence: number;
  rationale: string[];
  candidate_scores: Array<{
    provider: ProjectProvider;
    score: number;
    reason: string;
  }>;
  observed_signals: {
    local_ready_issue_count: number;
    local_open_issue_count: number;
    current_provider: ProjectProvider;
    current_provider_configured: boolean;
    token_present: boolean;
  };
};

function resolveRepoPath(raw: unknown): string {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : process.cwd();
}

function runBody(reqBody: unknown): RunBody {
  return (typeof reqBody === "object" && reqBody ? (reqBody as RunBody) : {}) as RunBody;
}

function normalizeProvider(value: unknown): ProjectProvider {
  const candidate = String(value ?? "").trim().toLowerCase();
  if (["github", "gitlab", "bitbucket", "azure", "gitea"].includes(candidate)) return candidate as ProjectProvider;
  return "local";
}

function projectConfigKey(workspaceId: string): string {
  return `project-config/${workspaceId}`;
}

function workspaceProjectConfig(workspaceId: string): ProjectSystemConfig {
  const stored = readJson<Partial<ProjectSystemConfig>>(projectConfigKey(workspaceId), {});
  return {
    provider: normalizeProvider(stored.provider),
    repoPath: String(stored.repoPath ?? "").trim(),
    remoteUrl: String(stored.remoteUrl ?? "").trim(),
    tokenEnvVar: String(stored.tokenEnvVar ?? "").trim(),
    owner: String(stored.owner ?? "").trim(),
    repo: String(stored.repo ?? "").trim(),
    projectId: String(stored.projectId ?? "").trim(),
    baseBranch: String(stored.baseBranch ?? "").trim() || "main"
  };
}

function tokenFromEnvRef(envName: string): string {
  const key = envName.trim();
  if (!key) return "";
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) return "";
  return String(process.env[key] ?? "").trim();
}

function defaultTokenEnvVar(provider: ProjectProvider): string {
  if (provider === "github") return "GITHUB_TOKEN";
  if (provider === "gitlab") return "GITLAB_TOKEN";
  if (provider === "bitbucket") return "BITBUCKET_TOKEN";
  if (provider === "azure") return "AZURE_DEVOPS_TOKEN";
  if (provider === "gitea") return "GITEA_TOKEN";
  return "";
}

type LocalProjectIssue = {
  labels?: string[];
  state?: string;
};

async function localIssueSignals(repoPath: string): Promise<{ readyCount: number; openCount: number }> {
  try {
    const issuesPath = join(repoPath, ".ai", "project", "issues.json");
    const raw = await readFile(issuesPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { readyCount: 0, openCount: 0 };
    let readyCount = 0;
    let openCount = 0;
    for (const item of parsed as LocalProjectIssue[]) {
      const state = String(item.state ?? "").toLowerCase();
      if (state !== "open") continue;
      openCount += 1;
      const labels = Array.isArray(item.labels) ? item.labels.map((label) => String(label).toLowerCase()) : [];
      if (labels.some((label) => ["ready", "autobot", "auto"].includes(label))) {
        readyCount += 1;
      }
    }
    return { readyCount, openCount };
  } catch {
    return { readyCount: 0, openCount: 0 };
  }
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

async function recommendProjectProvider(input: {
  config: ProjectSystemConfig;
  repoPath: string;
  configured: boolean;
  tokenPresent: boolean;
}): Promise<ProjectProviderRecommendation> {
  const signals = await localIssueSignals(input.repoPath);
  const candidates: Array<{ provider: ProjectProvider; score: number; reason: string }> = [];

  const localBase = 0.45 + (signals.readyCount > 0 ? 0.35 : 0) + (signals.openCount > 0 ? 0.1 : 0);
  candidates.push({
    provider: "local",
    score: clampScore(localBase),
    reason:
      signals.readyCount > 0
        ? "Local ready queue detected; prefer internal deterministic execution path."
        : "Local mode is safest default and requires no external auth dependency."
  });

  if (input.config.provider !== "local") {
    const nonLocalBase = 0.35 + (input.configured ? 0.3 : -0.2) + (signals.readyCount === 0 ? 0.15 : -0.05);
    candidates.push({
      provider: input.config.provider,
      score: clampScore(nonLocalBase),
      reason: input.configured
        ? "Provider is configured; can support external repository collaboration demand."
        : "Provider selected but not fully configured; confidence reduced."
    });
  } else {
    for (const provider of ["github", "gitlab", "bitbucket", "azure", "gitea"] as ProjectProvider[]) {
      const score = clampScore(0.22 + (signals.readyCount === 0 ? 0.12 : 0));
      candidates.push({
        provider,
        score,
        reason: "Available as linked mode, but no strong demand signal currently exceeds local-first baseline."
      });
    }
  }

  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const top = sorted[0] ?? { provider: "local" as const, score: 0.5, reason: "Default recommendation." };
  const rationale = [
    top.reason,
    `Observed local ready issues: ${signals.readyCount}.`,
    `Current provider: ${input.config.provider} (${input.configured ? "configured" : "not configured"}).`
  ];
  return {
    recommended_provider: top.provider,
    confidence: clampScore(top.score),
    rationale,
    candidate_scores: sorted,
    observed_signals: {
      local_ready_issue_count: signals.readyCount,
      local_open_issue_count: signals.openCount,
      current_provider: input.config.provider,
      current_provider_configured: input.configured,
      token_present: input.tokenPresent
    }
  };
}

function githubConfigFromProject(config: ProjectSystemConfig): GitHubAdapterConfig {
  const token = tokenFromEnvRef(config.tokenEnvVar || defaultTokenEnvVar("github"));
  const repository = config.owner && config.repo ? `${config.owner}/${config.repo}` : "";
  return {
    token,
    owner: config.owner,
    repo: config.repo,
    repository,
    baseBranch: config.baseBranch
  };
}

function linkedConfigFromProject(config: ProjectSystemConfig): LinkedProviderConfig | null {
  if (config.provider === "local") return null;
  return {
    provider: config.provider as Exclude<ProjectProvider, "local">,
    token: tokenFromEnvRef(config.tokenEnvVar || defaultTokenEnvVar(config.provider)),
    owner: config.owner,
    repo: config.repo,
    projectId: config.projectId,
    remoteUrl: config.remoteUrl,
    baseBranch: config.baseBranch
  };
}

function resolveProjectRepoPath(raw: unknown, config: ProjectSystemConfig, workspaceId: string): string {
  const dataPath = String(process.env.DATA_PATH ?? "/data").trim() || "/data";
  if (typeof raw === "string" && raw.trim()) return resolveRepoPath(raw);
  if (config.repoPath) return resolveRepoPath(config.repoPath);
  return join(dataPath, "project-runtime", workspaceId);
}

function envTrue(name: string, defaultValue: boolean): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return !["0", "false", "no", "off"].includes(raw);
}

function pathWithinRoot(path: string, root: string): boolean {
  const absolutePath = resolve(path);
  const absoluteRoot = resolve(root);
  if (absolutePath === absoluteRoot) return true;
  return absolutePath.startsWith(`${absoluteRoot}/`);
}

// ---------------------------------------------------------------------------
// Task CRUD — simple JSON-file backed task list
// ---------------------------------------------------------------------------

type DevTask = {
  task_id: string;
  workspace_id: string;
  title: string;
  type: string;
  domain: string;
  status: string;
  priority: number;
  notes?: string;
  created_at: string;
  updated_at: string;
};

const tasksKey = (w: string) => `devloop-tasks/${w}`;

/** GET /api/v1/devloop/tasks */
devloopRouter.get("/tasks", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const tasks = readJson<DevTask[]>(tasksKey(workspaceId), []);
  const active = tasks.filter(t => !["completed", "done", "cancelled"].includes(t.status)).length;
  const completed = tasks.filter(t => ["completed", "done"].includes(t.status)).length;
  res.status(200).json({ tasks: tasks.slice().reverse(), total: tasks.length, active, completed });
});

/** POST /api/v1/devloop/tasks */
devloopRouter.post("/tasks", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const body = req.body as { title?: string; type?: string; domain?: string; priority?: number; notes?: string };
  if (!body.title?.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const now = new Date().toISOString();
  const task: DevTask = {
    task_id: randomUUID(),
    workspace_id: workspaceId,
    title: body.title.trim(),
    type: body.type ?? "feature",
    domain: body.domain ?? "rnd",
    status: "open",
    priority: typeof body.priority === "number" ? body.priority : 50,
    notes: body.notes,
    created_at: now,
    updated_at: now,
  };
  const tasks = readJson<DevTask[]>(tasksKey(workspaceId), []);
  writeJsonAtomic(tasksKey(workspaceId), [...tasks, task]);
  res.status(201).json({ task });
});

/** PATCH /api/v1/devloop/tasks/:id */
devloopRouter.patch("/tasks/:id", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const tasks = readJson<DevTask[]>(tasksKey(workspaceId), []);
  const idx = tasks.findIndex(t => t.task_id === req.params.id);
  if (idx < 0) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  const body = req.body as Partial<Pick<DevTask, "status" | "priority" | "notes" | "title">>;
  tasks[idx] = { ...tasks[idx], ...body, updated_at: new Date().toISOString() };
  writeJsonAtomic(tasksKey(workspaceId), tasks);
  res.status(200).json({ task: tasks[idx] });
});

/** GET /api/v1/devloop/contracts */
devloopRouter.get("/contracts", (_req: Request, res: Response) => {
  res.status(200).json({
    schema_version: "1.0",
    service_contracts: DEVLOOP_SERVICE_CONTRACTS,
    state_machine: {
      task_states: DEVLOOP_TASK_STATES,
      run_states: DEVLOOP_RUN_STATES
    },
    retry_budgets: DEVLOOP_RETRY_BUDGETS
  });
});

/** GET /api/v1/devloop/project/provider-status */
devloopRouter.get("/project/provider-status", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const config = workspaceProjectConfig(workspaceId);
  const repoPath = resolveProjectRepoPath(undefined, config, workspaceId);
  const tokenKey = config.tokenEnvVar || defaultTokenEnvVar(config.provider);
  const tokenPresent = config.provider === "local" ? true : tokenFromEnvRef(tokenKey).length > 0;
  const linkedConfig = linkedConfigFromProject(config);
  const repoConfigured = config.provider === "github"
    ? resolveGitHubRepo(repoPath, githubConfigFromProject(config)) !== null
    : linkedConfig ? linkedProviderConfigured(linkedConfig) : false;
  const configured = config.provider === "local" ? true : tokenPresent && repoConfigured;
  const githubRepo = config.provider === "github" ? resolveGitHubRepo(repoPath, githubConfigFromProject(config)) : null;
  res.status(200).json({
    mode: configured ? config.provider : "local_fallback",
    provider: config.provider,
    configured,
    repo_path: repoPath,
    token_env_var: config.provider === "local" ? null : tokenKey,
    token_present: tokenPresent,
    repo: githubRepo,
    capabilities: {
      issue_source_remote: config.provider !== "local" && configured,
      git_push_remote: config.provider !== "local" && configured,
      pr_creation_remote: config.provider !== "local" && configured
    },
    supported_providers: ["local", "github", "gitlab", "bitbucket", "azure", "gitea"]
  });
});

/** GET /api/v1/devloop/project/provider-recommendation */
devloopRouter.get("/project/provider-recommendation", async (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const config = workspaceProjectConfig(workspaceId);
  const repoPath = resolveProjectRepoPath(undefined, config, workspaceId);
  const tokenKey = config.tokenEnvVar || defaultTokenEnvVar(config.provider);
  const tokenPresent = config.provider === "local" ? true : tokenFromEnvRef(tokenKey).length > 0;
  const linkedConfig = linkedConfigFromProject(config);
  const repoConfigured = config.provider === "github"
    ? resolveGitHubRepo(repoPath, githubConfigFromProject(config)) !== null
    : linkedConfig ? linkedProviderConfigured(linkedConfig) : false;
  const configured = config.provider === "local" ? true : tokenPresent && repoConfigured;
  const recommendation = await recommendProjectProvider({ config, repoPath, configured, tokenPresent });
  res.status(200).json({ recommendation });
});

/** POST /api/v1/devloop/project/provider-recommendation/apply */
devloopRouter.post("/project/provider-recommendation/apply", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const config = workspaceProjectConfig(workspaceId);
  const repoPath = resolveProjectRepoPath(undefined, config, workspaceId);
  const tokenKey = config.tokenEnvVar || defaultTokenEnvVar(config.provider);
  const tokenPresent = config.provider === "local" ? true : tokenFromEnvRef(tokenKey).length > 0;
  const linkedConfig = linkedConfigFromProject(config);
  const repoConfigured = config.provider === "github"
    ? resolveGitHubRepo(repoPath, githubConfigFromProject(config)) !== null
    : linkedConfig ? linkedProviderConfigured(linkedConfig) : false;
  const configured = config.provider === "local" ? true : tokenPresent && repoConfigured;
  const recommendation = await recommendProjectProvider({ config, repoPath, configured, tokenPresent });

  const overrideRaw = typeof req.body?.provider === "string" ? req.body.provider : "";
  const targetProvider = overrideRaw ? normalizeProvider(overrideRaw) : recommendation.recommended_provider;
  const current = readJson<Partial<ProjectSystemConfig>>(projectConfigKey(workspaceId), {});
  const updated: ProjectSystemConfig = {
    ...config,
    ...current,
    provider: targetProvider,
    tokenEnvVar: String(current.tokenEnvVar ?? "").trim() || defaultTokenEnvVar(targetProvider)
  };
  writeJsonAtomic(projectConfigKey(workspaceId), updated);

  res.status(200).json({
    applied_provider: targetProvider,
    recommendation,
    project_config: updated
  });
});

/** POST /api/v1/devloop/product/run-next */
devloopRouter.post("/product/run-next", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const body = runBody(req.body);
  const { workspaceId } = req.ctx!;
  const dataPath = String(process.env.DATA_PATH ?? "/data").trim();
  const productRoot = resolve(String(process.env.DEVLOOP_PRODUCT_ROOT ?? dataPath).trim() || dataPath);
  const localOnly = envTrue("DEVLOOP_PRODUCT_LOCAL_ONLY", true);
  const repoPath = body.repo_path
    ? resolveRepoPath(body.repo_path)
    : join(productRoot, "product-runtime", workspaceId);

  if (localOnly && !pathWithinRoot(repoPath, productRoot)) {
    res.status(400).json({
      error: "product mode is restricted to local container root",
      local_only: true,
      allowed_root: productRoot,
      received_repo_path: repoPath
    });
    return;
  }

  await mkdir(repoPath, { recursive: true });

  const orchestrator = new TaskOrchestrator({
    taskProvider: new LocalBacklogTaskProvider(repoPath),
    workspaceManager: new LocalWorkspaceManager(repoPath),
    artifactStore: new LocalArtifactStore(repoPath),
    stateStore: new LocalStateStore(repoPath),
    plannerAgent: new AIPlannerAgent(),
    codingAgent: new AICodingAgent(),
    ciTestRunner: new CITestRunner(),
    reviewerAgent: new AIReviewerAgent(),
    finalizer: new ProductFinalizer(),
    repoPath
  });

  const result = await orchestrator.runNext({
    mode: "product",
    testProfile: body.profile ?? "default",
    dryRun: body.dry_run !== false
  });

  res.status(200).json({ result });
});

/** POST /api/v1/devloop/project/run-next */
devloopRouter.post("/project/run-next", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const body = runBody(req.body);
  const { workspaceId } = req.ctx!;
  const config = workspaceProjectConfig(workspaceId);
  const repoPath = resolveProjectRepoPath(body.repo_path, config, workspaceId);
  const githubConfig = githubConfigFromProject(config);
  const linkedConfig = linkedConfigFromProject(config);
  const remoteEnabled =
    config.provider === "github"
      ? githubConfigured(repoPath, githubConfig)
      : linkedConfig
        ? linkedProviderConfigured(linkedConfig)
        : false;
  const forceLocalIssueSource = !remoteEnabled;
  await mkdir(repoPath, { recursive: true });

  const orchestrator = new TaskOrchestrator({
    taskProvider: new GitHubIssueProvider(repoPath, {
      provider: config.provider,
      forceLocal: forceLocalIssueSource,
      githubConfig,
      linkedConfig: linkedConfig ?? undefined
    }),
    workspaceManager: new LocalWorkspaceManager(repoPath),
    artifactStore: new LocalArtifactStore(repoPath),
    stateStore: new LocalStateStore(repoPath),
    plannerAgent: new AIPlannerAgent(),
    codingAgent: new AICodingAgent(),
    ciTestRunner: new CITestRunner(),
    reviewerAgent: new AIReviewerAgent(),
    finalizer: new ProjectFinalizer(repoPath, {
      provider: config.provider,
      githubConfig,
      linkedConfig: linkedConfig ?? undefined,
      baseBranch: config.baseBranch
    }),
    repoPath
  });

  const result = await orchestrator.runNext({
    mode: "project",
    testProfile: body.profile ?? "default",
    dryRun: body.dry_run !== false
  });

  res.status(200).json({ result });
});
