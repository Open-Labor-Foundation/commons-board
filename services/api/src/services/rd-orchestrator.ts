/**
 * R&D experiment orchestrator — builds experiment analysis packets for
 * governance handoff decisions.
 *
 * Ported from mother-board services/rd-orchestrator.ts.
 * No OLF-specific sanitization needed — pure function, no org branding.
 */
import { randomUUID } from "node:crypto";

export type RdExperimentPacket = {
  packet_id: string;
  experiment_id?: string;
  hypothesis: string;
  stage: "queued" | "active" | "validated" | "rejected";
  observed_result: string;
  confidence: number;
  governance_handoff_required: boolean;
  recommended_owner_domain: "rnd" | "ops" | "strategy";
  major_factors: string[];
  next_actions: string[];
  created_at: string;
};

export function buildRdExperimentPacket(input: {
  experimentId?: string;
  hypothesis: string;
  observedResult: string;
  outcomeLift?: number;
  roiScore?: number;
  consecutiveUnderperform?: number;
  confidence?: number;
  majorFactors?: string[];
  nextActions?: string[];
}): RdExperimentPacket {
  const outcomeLift = Number(input.outcomeLift ?? 0);
  const roiScore = Number(input.roiScore ?? 0);
  const consecutiveUnderperform = Number(input.consecutiveUnderperform ?? 0);

  const stage: RdExperimentPacket["stage"] =
    outcomeLift >= 0.1 && roiScore >= 0.2
      ? "validated"
      : outcomeLift < 0 || roiScore < 0 || consecutiveUnderperform >= 2
        ? "rejected"
        : "active";

  const computedConfidence = Number(
    Math.max(0, Math.min(1, 0.5 + outcomeLift * 0.9 + roiScore * 0.4 - consecutiveUnderperform * 0.12)).toFixed(3)
  );
  const resolvedConfidence = Number((input.confidence ?? computedConfidence).toFixed(3));
  const governanceHandoffRequired = stage === "validated" || stage === "rejected";
  const recommendedOwnerDomain: RdExperimentPacket["recommended_owner_domain"] =
    stage === "validated" ? "ops" : stage === "rejected" ? "strategy" : "rnd";

  return {
    packet_id: randomUUID(),
    experiment_id: input.experimentId,
    hypothesis: input.hypothesis,
    stage,
    observed_result: input.observedResult,
    confidence: resolvedConfidence,
    governance_handoff_required: governanceHandoffRequired,
    recommended_owner_domain: recommendedOwnerDomain,
    major_factors: input.majorFactors ?? ["signal_quality", "sample_window", "control_alignment"],
    next_actions:
      input.nextActions ??
      (stage === "validated"
        ? ["handoff to ops for scaled rollout", "set production KPI guardrails", "publish governance checkpoint"]
        : stage === "rejected"
          ? ["run root cause review", "archive weak variant", "propose pivot hypothesis"]
          : ["expand sample size", "run holdout validation", "publish governance checkpoint"]),
    created_at: new Date().toISOString()
  };
}
