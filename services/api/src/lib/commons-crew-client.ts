/**
 * Registers a chair as a real commons-crew instance (pa.createChairRun,
 * exposed as POST /api/chairs) — the governance identity that gives a chair
 * an audit trail, autonomy tiers, and delegate_to_child capability. This is
 * independent of specialist resolution (see labor-commons-client.ts /
 * specialist-resolver.ts), which still picks which specialist to preview
 * for a chair; commons-crew is not guaranteed to be deployed alongside
 * every commons-board instance, so failures here must never block
 * onboarding.
 */

export type CommonsCrewChairRole =
  | "finance" | "legal" | "hr" | "marketing" | "operations" | "product" | "it" | "security";

export interface RegisterChairInput {
  orgContext: string;
  chairRole: CommonsCrewChairRole;
  surface: "cli" | "web";
  title: string;
}

export interface RegisteredChair {
  runId: string;
  sessionId: string;
}

function commonsCrewConfig(): { url: string; headers: Record<string, string> } | null {
  const url = process.env.CB_COMMONS_CREW_URL;
  if (!url) return null;
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = process.env.CB_COMMONS_CREW_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return { url, headers };
}

export async function registerChair(input: RegisterChairInput): Promise<RegisteredChair | null> {
  const config = commonsCrewConfig();
  if (!config) return null;

  try {
    const resp = await fetch(`${config.url}/api/chairs`, {
      method: "POST",
      headers: config.headers,
      body: JSON.stringify(input)
    });

    if (!resp.ok) {
      console.error(`[commons-crew-client] chair registration failed (${resp.status}) for ${input.chairRole}/${input.orgContext}`);
      return null;
    }

    const data = (await resp.json()) as { session?: { id?: string }; run?: { id?: string } };
    if (!data.run?.id || !data.session?.id) return null;

    return { runId: data.run.id, sessionId: data.session.id };
  } catch (err) {
    console.error(`[commons-crew-client] chair registration errored for ${input.chairRole}/${input.orgContext}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Proposes dispatching one piece of work to an already-registered chair's
 * commons-crew run, via delegate_to_child -- this is what makes a chair's
 * registration (see registerChair) load-bearing rather than dormant.
 *
 * This function only PROPOSES. It does not decide the approval and does
 * not execute -- delegate_to_child is a class_c, real-world-impact action,
 * and commons-crew's whole governance model exists to put a human decision
 * between "proposed" and "executed" for exactly this class of action.
 * Auto-approving here on the caller's behalf would defeat that gate
 * entirely. The actual decision belongs to submitDispatchDecision, which
 * takes the decision as a required input from an authenticated admin/
 * operator caller -- it never invents one.
 *
 * A chair's seeded delegation approval is one-shot (commons-crew's
 * createProposal refuses to rebind an already-bound approval to a
 * different act), so every proposal after the first requests a fresh
 * approval via POST /api/runs/:runId/delegation-approvals rather than
 * assuming the chair's original approval is still usable. See
 * commons-crew's docs/architecture.md, "Requesting delegation approval
 * again".
 *
 * Non-fatal on any failure -- returns null rather than throwing, same
 * reasoning as registerChair: commons-crew isn't guaranteed reachable, and
 * a failed proposal should be a visible-but-recoverable board-request
 * state, not a crashed request.
 */
export interface ProposeDispatchInput {
  runId: string;
  workDescription: string;
}

export interface ProposedDispatch {
  approvalId: string;
  proposalId: string;
  taskId: string;
  runId: string;
}

interface RunApprovalSummary {
  id: string;
  taskId: string;
  status: string;
}

export async function proposeDispatchToChair(input: ProposeDispatchInput): Promise<ProposedDispatch | null> {
  const config = commonsCrewConfig();
  if (!config) return null;
  const { url, headers } = config;

  try {
    const runResp = await fetch(`${url}/api/runs/${input.runId}`, { headers });
    if (!runResp.ok) {
      console.error(`[commons-crew-client] propose-dispatch failed: could not load run ${input.runId} (${runResp.status})`);
      return null;
    }
    const runData = (await runResp.json()) as {
      run?: { workItemId?: string };
      approvals?: RunApprovalSummary[];
    };
    const workItemId = runData.run?.workItemId;
    if (!workItemId) return null;

    let approval = (runData.approvals ?? []).find((a) => a.status === "pending") ?? null;
    if (!approval) {
      // Fastify's JSON body parser rejects a POST with content-type:
      // application/json and a truly empty body, so an explicit "{}" is
      // required even though this endpoint doesn't read one.
      const requestResp = await fetch(`${url}/api/runs/${input.runId}/delegation-approvals`, { method: "POST", headers, body: "{}" });
      if (!requestResp.ok) {
        console.error(`[commons-crew-client] propose-dispatch failed: could not request a delegation approval for run ${input.runId} (${requestResp.status})`);
        return null;
      }
      approval = (await requestResp.json()) as RunApprovalSummary;
    }

    const proposalResp = await fetch(`${url}/api/actions/proposals`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workItemId,
        runId: input.runId,
        taskId: approval.taskId,
        toolId: "delegate_to_child",
        actionClass: "class_c",
        targetRef: input.workDescription,
        idempotencyKey: `board-dispatch-${input.runId}-${approval.id}`
      })
    });
    if (!proposalResp.ok) {
      console.error(`[commons-crew-client] propose-dispatch failed: could not create delegate_to_child proposal for run ${input.runId} (${proposalResp.status})`);
      return null;
    }
    const proposal = (await proposalResp.json()) as { id?: string };
    if (!proposal.id) return null;

    return { approvalId: approval.id, proposalId: proposal.id, taskId: approval.taskId, runId: input.runId };
  } catch (err) {
    console.error(`[commons-crew-client] propose-dispatch errored for run ${input.runId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Forwards an EXPLICIT human decision (from an authenticated admin/operator
 * caller -- see routes/motherboard.ts's requireRole gate) to commons-crew's
 * own approval endpoint. `decision` is a required parameter with no
 * default: this function cannot approve anything on its own, only relay a
 * decision that was already made by a real person. Only executes the
 * underlying delegate_to_child proposal if that decision was "approved".
 */
export interface SubmitDispatchDecisionInput {
  approvalId: string;
  proposalId: string;
  runId: string;
  decision: "approved" | "denied";
  actorUserId: string;
  comment?: string;
}

export interface DispatchResult {
  decision: "approved" | "denied";
  childRunId: string | null;
  layer: string | null;
}

// commons-crew's own approval endpoint checks that the deciding actor is a
// real member of *its* workspace (workspace_membership_required) -- it has
// no concept of commons-board's org/user identities, and there's no actor-
// identity bridge between the two systems yet. "user_primary" is the one
// member commons-crew's default single-tenant workspace state seeds, so
// that's what's sent on the wire; input.actorUserId is still the real
// commons-board admin who decided, recorded faithfully in commons-board's
// own GovernanceEvent audit log by the caller (see routes/motherboard.ts) --
// it's just not (yet) forwarded as commons-crew's actor of record. Bridging
// real per-org identity into commons-crew's workspace-membership model is a
// distinct, not-yet-built piece of cross-repo identity work.
const COMMONS_CREW_DEFAULT_ACTOR = "user_primary";

export async function submitDispatchDecision(input: SubmitDispatchDecisionInput): Promise<DispatchResult | null> {
  const config = commonsCrewConfig();
  if (!config) return null;
  const { url, headers } = config;

  try {
    const decisionResp = await fetch(`${url}/api/approvals/${input.approvalId}/decision`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: input.decision, comment: input.comment ?? "Decided via commons-board.", actorUserId: COMMONS_CREW_DEFAULT_ACTOR })
    });
    if (!decisionResp.ok) {
      console.error(`[commons-crew-client] decision failed: could not record ${input.decision} for approval ${input.approvalId} (${decisionResp.status})`);
      return null;
    }

    if (input.decision === "denied") {
      return { decision: "denied", childRunId: null, layer: null };
    }

    const executeResp = await fetch(`${url}/api/actions/${input.proposalId}/execute`, { method: "POST", headers, body: "{}" });
    if (!executeResp.ok) {
      console.error(`[commons-crew-client] decision failed: could not execute proposal ${input.proposalId} (${executeResp.status})`);
      return null;
    }

    // execute()'s own record has no structured payload -- the delegated
    // child's id surfaces on the parent run's own event log instead.
    const eventsResp = await fetch(`${url}/api/runs/${input.runId}/events`, { headers });
    if (!eventsResp.ok) return null;
    const eventsData = (await eventsResp.json()) as {
      events: Array<{ eventType: string; payload: { childRunId?: string; layer?: string } }>;
    };
    const childEvents = eventsData.events.filter((e) => e.eventType === "delegation.child_created");
    const latest = childEvents[childEvents.length - 1]; // event log is append-only, oldest-first
    if (!latest?.payload.childRunId) return null;

    return { decision: "approved", childRunId: latest.payload.childRunId, layer: latest.payload.layer ?? "unknown" };
  } catch (err) {
    console.error(`[commons-crew-client] decision errored for approval ${input.approvalId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
