/**
 * Onboarding checklist — surfaces activation progress for a workspace.
 *
 * Routes:
 *   GET /api/v1/onboarding/checklist
 */
import { Router, type Request, type Response } from "express";
import { getArtifact } from "../lib/artifact-store.js";
import { requireContext } from "../lib/auth.js";

export const onboardingRouter = Router();

onboardingRouter.use(requireContext);

onboardingRouter.get("/checklist", (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;

  const hasProfile = getArtifact(orgId, "business_profile") !== null;
  const hasObjectives = getArtifact(orgId, "objective_config") !== null;
  const hasAutonomy = getArtifact(orgId, "autonomy_policy") !== null;
  const hasCadence = getArtifact(orgId, "cadence_protocol") !== null;
  const hasBlueprint = getArtifact(orgId, "agent_blueprint") !== null;
  const hasCollective = getArtifact(orgId, "collective_config") !== null;

  const profileArtifact = getArtifact(orgId, "business_profile");
  const governanceMode =
    profileArtifact && typeof profileArtifact.payload === "object" && profileArtifact.payload !== null
      ? (profileArtifact.payload as Record<string, unknown>).governance_mode
      : null;

  const checklist = [
    { id: "complete_interview", label: "Complete onboarding interview", done: hasProfile },
    { id: "set_objectives", label: "Configure objectives and KPIs", done: hasObjectives },
    { id: "set_autonomy", label: "Configure autonomy policy", done: hasAutonomy },
    { id: "set_cadence", label: "Set cadence schedule", done: hasCadence },
    { id: "configure_board", label: "Configure board (chair assignments)", done: hasBlueprint },
    ...(governanceMode === "collective"
      ? [{ id: "configure_collective", label: "Configure collective membership and voting", done: hasCollective }]
      : [])
  ];

  res.status(200).json({ governance_mode: governanceMode ?? "unknown", checklist });
});
