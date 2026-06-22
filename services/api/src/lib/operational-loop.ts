/**
 * Operational loop — stage machine for governed action lifecycle.
 *
 * Ported from mother-board lib/operational-loop.ts with no org-specific content.
 * Stages: operation → verification → rnd/governance → governance → deployment
 */

export type LoopStage = "operation" | "verification" | "rnd" | "governance" | "deployment";

export type LoopCheckpoint = {
  request_id: string;
  stage: LoopStage;
  entered_at: string;
  context: Record<string, unknown>;
};

const transitions: Record<LoopStage, LoopStage[]> = {
  operation:    ["verification"],
  verification: ["rnd", "governance"],
  rnd:          ["governance"],
  governance:   ["deployment"],
  deployment:   []
};

export function canTransitionLoopStage(from: LoopStage, to: LoopStage): boolean {
  return (transitions[from] ?? []).includes(to);
}

export function stageSequence(approvalRequired: boolean): LoopStage[] {
  if (approvalRequired) {
    return ["operation", "verification", "governance", "deployment"];
  }
  return ["operation", "verification", "rnd", "governance", "deployment"];
}

export function buildLoopCheckpoints(input: {
  requestId: string;
  approvalRequired: boolean;
  context?: Record<string, unknown>;
}): LoopCheckpoint[] {
  const now = new Date().toISOString();
  return stageSequence(input.approvalRequired).map((stage) => ({
    request_id: input.requestId,
    stage,
    entered_at: now,
    context: input.context ?? {}
  }));
}

export function loopBottlenecks(
  events: Array<{ stage?: unknown; status?: unknown }>
): Array<{ stage: LoopStage; count: number }> {
  const counts = new Map<LoopStage, number>([
    ["operation", 0], ["verification", 0], ["rnd", 0], ["governance", 0], ["deployment", 0]
  ]);
  for (const event of events) {
    if (event.status !== "blocked" && event.status !== "pending") continue;
    const stage = String(event.stage ?? "") as LoopStage;
    if (counts.has(stage)) counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  return [...counts.entries()].map(([stage, count]) => ({ stage, count })).filter((e) => e.count > 0);
}

export function stageForBoardStatus(
  status: "submitted" | "triaged" | "planned" | "approved" | "executing" | "blocked" | "completed" | "rejected"
): LoopStage | null {
  if (status === "submitted" || status === "triaged" || status === "planned") return "operation";
  if (status === "approved") return "verification";
  if (status === "executing") return "governance";
  if (status === "completed") return "deployment";
  return null;
}
