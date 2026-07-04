/**
 * Collective treasury routes — income tracking, member distributions, and
 * reserve management for collective-mode organizations.
 *
 * OLF-original (no Pre-OLF equivalent).
 *
 * Business and collective economics are symmetric in OLF: both modes can track
 * revenue and make allocations. The treasury is relevant in both modes but
 * distributions to collective members are only meaningful in collective mode.
 * The route does not gate on governance mode — callers can decide relevance.
 *
 * Governance: distribution execution emits the `distribution_executed`
 * governance event and requires admin approval.
 *
 * Routes:
 *   GET  /api/v1/treasury/balance                        — current treasury state
 *   POST /api/v1/treasury/income                         — record income
 *   GET  /api/v1/treasury/income                         — list income entries
 *   POST /api/v1/treasury/distributions                  — create a pending distribution
 *   GET  /api/v1/treasury/distributions                  — list distributions
 *   POST /api/v1/treasury/distributions/:id/execute      — execute a pending distribution
 *   POST /api/v1/treasury/contributions                  — record a member contribution
 *   GET  /api/v1/treasury/contributions                  — list contributions
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { GovernanceEvent } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { appendEvent } from "../lib/decision-log.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";

export const treasuryRouter = Router();
treasuryRouter.use(requireContext);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type IncomeEntry = {
  id: string;
  workspaceId: string;
  source: string;
  amount: number;
  currency: string;
  description: string;
  period: string;
  createdAt: string;
};

type DistributionStatus = "pending" | "executed" | "cancelled";

type MemberAllocation = {
  memberId: string;
  role: "steward" | "coordinator" | "member" | "observer";
  amount: number;
};

type DistributionRecord = {
  id: string;
  workspaceId: string;
  status: DistributionStatus;
  period: string;
  totalAmount: number;
  currency: string;
  memberAllocations: MemberAllocation[];
  reserveAmount: number;
  reserveRateBps: number;
  executedAt: string | null;
  authorizedBy: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type ContributionRecord = {
  id: string;
  workspaceId: string;
  memberId: string;
  contributionType: "labor" | "capital" | "knowledge" | "other";
  value: number;
  currency: string;
  description: string;
  period: string;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Persistence keys
// ---------------------------------------------------------------------------

const incomeKey = (w: string) => `treasury-income/${w}`;
const distributionsKey = (w: string) => `treasury-distributions/${w}`;
const contributionsKey = (w: string) => `treasury-contributions/${w}`;

// ---------------------------------------------------------------------------
// Balance computation
// ---------------------------------------------------------------------------

function computeBalance(workspaceId: string): {
  totalIncome: number;
  totalDistributed: number;
  totalContributions: number;
  reserveBalance: number;
  availableForDistribution: number;
  currency: string;
  lastDistributionAt: string | null;
} {
  const incomeEntries = readJson<IncomeEntry[]>(incomeKey(workspaceId), []);
  const distributions = readJson<DistributionRecord[]>(distributionsKey(workspaceId), []);
  const contributions = readJson<ContributionRecord[]>(contributionsKey(workspaceId), []);

  const totalIncome = incomeEntries.reduce((sum, e) => sum + e.amount, 0);
  const executedDistributions = distributions.filter((d) => d.status === "executed");
  const totalDistributed = executedDistributions.reduce((sum, d) => sum + d.totalAmount, 0);
  const totalContributions = contributions.reduce((sum, c) => sum + c.value, 0);
  const reserveBalance = executedDistributions.reduce((sum, d) => sum + d.reserveAmount, 0);
  const availableForDistribution = Math.max(0, totalIncome - totalDistributed);
  const lastExecution = executedDistributions.sort((a, b) =>
    (a.executedAt ?? "") < (b.executedAt ?? "") ? 1 : -1
  )[0];

  const currency = incomeEntries[0]?.currency ?? distributions[0]?.currency ?? "USD";

  return {
    totalIncome,
    totalDistributed,
    totalContributions,
    reserveBalance,
    availableForDistribution,
    currency,
    lastDistributionAt: lastExecution?.executedAt ?? null
  };
}

// ---------------------------------------------------------------------------
// Distribution calculation
// ---------------------------------------------------------------------------

const ROLE_WEIGHTS: Record<MemberAllocation["role"], number> = {
  steward: 3,
  coordinator: 2,
  member: 1,
  observer: 0
};

function calculateAllocations(
  members: Array<{ memberId: string; role: MemberAllocation["role"] }>,
  distributableAmount: number
): MemberAllocation[] {
  const eligibleMembers = members.filter((m) => ROLE_WEIGHTS[m.role] > 0);
  if (eligibleMembers.length === 0) return [];
  const totalWeight = eligibleMembers.reduce((sum, m) => sum + ROLE_WEIGHTS[m.role], 0);
  return eligibleMembers.map((m) => ({
    memberId: m.memberId,
    role: m.role,
    amount: Number(((distributableAmount * ROLE_WEIGHTS[m.role]) / totalWeight).toFixed(2))
  }));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** GET /api/v1/treasury/balance */
treasuryRouter.get("/balance", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  res.status(200).json(computeBalance(workspaceId));
});

/** POST /api/v1/treasury/income */
treasuryRouter.post("/income", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const body = req.body as {
    source?: string;
    amount?: number;
    currency?: string;
    description?: string;
    period?: string;
  };

  if (typeof body.amount !== "number" || body.amount <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }

  const entry: IncomeEntry = {
    id: randomUUID(),
    workspaceId,
    source: String(body.source ?? "unspecified"),
    amount: Number(body.amount),
    currency: String(body.currency ?? "USD").toUpperCase(),
    description: String(body.description ?? ""),
    period: String(body.period ?? new Date().toISOString().slice(0, 7)),
    createdAt: new Date().toISOString()
  };

  const all = readJson<IncomeEntry[]>(incomeKey(workspaceId), []);
  writeJsonAtomic(incomeKey(workspaceId), [...all, entry]);
  res.status(201).json(entry);
});

/** GET /api/v1/treasury/income */
treasuryRouter.get("/income", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const entries = readJson<IncomeEntry[]>(incomeKey(workspaceId), []).slice().reverse();
  res.status(200).json({ income: entries, total: entries.length });
});

/** POST /api/v1/treasury/distributions */
treasuryRouter.post("/distributions", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const body = req.body as {
    period?: string;
    totalAmount?: number;
    currency?: string;
    reserveRateBps?: number;
    members?: Array<{ memberId: string; role: MemberAllocation["role"] }>;
    notes?: string;
  };

  if (typeof body.totalAmount !== "number" || body.totalAmount <= 0) {
    res.status(400).json({ error: "totalAmount must be a positive number" });
    return;
  }

  const reserveRateBps = Number(body.reserveRateBps ?? 1000); // default 10%
  const reserveAmount = Number(((body.totalAmount * reserveRateBps) / 10000).toFixed(2));
  const distributableAmount = Number((body.totalAmount - reserveAmount).toFixed(2));
  const members = body.members ?? [];
  const memberAllocations = calculateAllocations(members, distributableAmount);

  const now = new Date().toISOString();
  const distribution: DistributionRecord = {
    id: randomUUID(),
    workspaceId,
    status: "pending",
    period: String(body.period ?? now.slice(0, 7)),
    totalAmount: body.totalAmount,
    currency: String(body.currency ?? "USD").toUpperCase(),
    memberAllocations,
    reserveAmount,
    reserveRateBps,
    executedAt: null,
    authorizedBy: null,
    notes: String(body.notes ?? ""),
    createdAt: now,
    updatedAt: now
  };

  const all = readJson<DistributionRecord[]>(distributionsKey(workspaceId), []);
  writeJsonAtomic(distributionsKey(workspaceId), [...all, distribution]);
  res.status(201).json(distribution);
});

/** GET /api/v1/treasury/distributions */
treasuryRouter.get("/distributions", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const distributions = readJson<DistributionRecord[]>(distributionsKey(workspaceId), []).slice().reverse();
  res.status(200).json({ distributions, total: distributions.length });
});

/** POST /api/v1/treasury/distributions/:id/execute */
treasuryRouter.post("/distributions/:id/execute", requireRole(["admin"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const { id } = req.params;

  const all = readJson<DistributionRecord[]>(distributionsKey(workspaceId), []);
  const idx = all.findIndex((d) => d.id === id);
  if (idx === -1) {
    res.status(404).json({ error: "distribution not found" });
    return;
  }
  if (all[idx].status !== "pending") {
    res.status(409).json({ error: `distribution already in status: ${all[idx].status}` });
    return;
  }

  const now = new Date().toISOString();
  const executed: DistributionRecord = {
    ...all[idx],
    status: "executed",
    executedAt: now,
    authorizedBy: userId,
    updatedAt: now
  };
  all[idx] = executed;
  writeJsonAtomic(distributionsKey(workspaceId), all);

  appendEvent({
    event_id: randomUUID(),
    org_id: workspaceId,
    event_type: "distribution_executed",
    actor: userId,
    artifact_type: null,
    artifact_id: null,
    details: {
      distribution_id: executed.id,
      period: executed.period,
      total_amount: executed.totalAmount,
      currency: executed.currency,
      reserve_amount: executed.reserveAmount,
      member_count: executed.memberAllocations.length
    },
    at: now
  } satisfies GovernanceEvent);

  res.status(200).json(executed);
});

/** POST /api/v1/treasury/contributions */
treasuryRouter.post("/contributions", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const body = req.body as {
    memberId?: string;
    contributionType?: ContributionRecord["contributionType"];
    value?: number;
    currency?: string;
    description?: string;
    period?: string;
  };

  if (!body.memberId) {
    res.status(400).json({ error: "memberId is required" });
    return;
  }

  const VALID_TYPES = new Set(["labor", "capital", "knowledge", "other"]);
  const contributionType = VALID_TYPES.has(String(body.contributionType))
    ? (body.contributionType as ContributionRecord["contributionType"])
    : "other";

  const contribution: ContributionRecord = {
    id: randomUUID(),
    workspaceId,
    memberId: String(body.memberId),
    contributionType,
    value: Number(body.value ?? 0),
    currency: String(body.currency ?? "USD").toUpperCase(),
    description: String(body.description ?? ""),
    period: String(body.period ?? new Date().toISOString().slice(0, 7)),
    createdAt: new Date().toISOString()
  };

  const all = readJson<ContributionRecord[]>(contributionsKey(workspaceId), []);
  writeJsonAtomic(contributionsKey(workspaceId), [...all, contribution]);
  res.status(201).json(contribution);
});

/** GET /api/v1/treasury/contributions */
treasuryRouter.get("/contributions", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const contributions = readJson<ContributionRecord[]>(contributionsKey(workspaceId), []).slice().reverse();
  res.status(200).json({ contributions, total: contributions.length });
});
