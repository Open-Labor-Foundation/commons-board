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

export type OrgAutonomyTier = "advisor" | "orchestrator" | "autopilot";

/**
 * Syncs this org's autonomy_policy mode to commons-crew's own gating store
 * (pa.setOrgAutonomyTier, exposed as PUT /api/orgs/:orgContext/autonomy-tier)
 * so delegate_to_child approval gating for this org's registered chairs
 * actually reflects the mode the org chose during onboarding, instead of
 * silently defaulting to "advisor" forever. Non-fatal on any failure, same
 * reasoning as registerChair -- commons-crew isn't guaranteed reachable, and
 * a failed sync should never block onboarding.
 */
export async function syncOrgAutonomyTier(orgContext: string, tier: OrgAutonomyTier): Promise<boolean> {
  const config = commonsCrewConfig();
  if (!config) return false;

  try {
    const resp = await fetch(`${config.url}/api/orgs/${encodeURIComponent(orgContext)}/autonomy-tier`, {
      method: "PUT",
      headers: config.headers,
      body: JSON.stringify({ tier })
    });
    if (!resp.ok) {
      console.error(`[commons-crew-client] autonomy-tier sync failed (${resp.status}) for org=${sanitizeForLog(orgContext)}`);
      return false;
    }
    return true;
  } catch (err) {
    // Single-argument form deliberately -- with a second arg present, Node's
    // console.error treats the first string as a printf-style format string,
    // and sanitizeForLog doesn't strip "%" (only control characters), so a
    // crafted orgContext could still trigger format-specifier confusion.
    console.error(`[commons-crew-client] autonomy-tier sync errored for org=${sanitizeForLog(orgContext)}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
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

// commons-crew's own approval endpoint checks that the deciding actor is a
// real member of *its* workspace (workspace_membership_required, then
// requires the "approval_decision" permission specifically). "user_primary"
// is the one member commons-crew's default state seeds -- it's the fallback
// when the real bridge below can't run, not the intended steady state.
const COMMONS_CREW_FALLBACK_ACTOR = "user_primary";

// orgContext/userId (and emailOrLogin, built from them) originate from
// client-supplied request headers (x-workspace-id/x-user-id), not a
// server-verified session -- CodeQL correctly flags them as tainted before
// they reach console.error. Strip control characters (newlines especially)
// before logging so a crafted header can't forge or split log lines; this
// is a log-forging concern specifically, not a path/command injection risk,
// since nothing here reaches a filesystem or shell call.
export function sanitizeForLog(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, "");
}

/**
 * Bridges a real commons-board admin into commons-crew's own user/
 * membership system, rather than always deciding as the seeded
 * "user_primary". commons-crew already has the infrastructure this needs --
 * POST /api/users, POST /api/workspaces/:id/memberships with an
 * "approval_decision" permission a "supporting" member can hold -- so this
 * is a client-side bridge, not a new commons-crew capability.
 *
 * emailOrLogin is deterministic and namespaced by orgContext (not just the
 * board user id) because a single commons-crew deployment could plausibly
 * be shared across multiple commons-board orgs, and board user ids are only
 * unique within one org.
 *
 * Idempotent: looks up the workspace's existing users/memberships first via
 * GET /api/workspace (no workspace id needed to discover it) and only
 * creates what's missing. Returns null on any failure so the caller can
 * fall back to COMMONS_CREW_FALLBACK_ACTOR rather than block a decision
 * on identity-bridging trouble.
 */
export async function ensureBoardMemberIdentity(input: { orgContext: string; userId: string; displayName?: string }): Promise<string | null> {
  const config = commonsCrewConfig();
  if (!config) return null;
  const { url, headers } = config;
  const emailOrLogin = `${input.orgContext}:${input.userId}@commons-board.local`.toLowerCase();
  const displayName = input.displayName?.trim() || input.userId;
  // Sanitized copy for logging only -- the real emailOrLogin above is used
  // for every actual lookup/API call unchanged, this is purely to keep a
  // crafted orgContext/userId from forging or splitting a log line.
  const safeEmailOrLogin = sanitizeForLog(emailOrLogin);

  try {
    const workspaceResp = await fetch(`${url}/api/workspace`, { headers });
    if (!workspaceResp.ok) return null;
    const workspace = (await workspaceResp.json()) as {
      workspace: { id: string };
      users: Array<{ id: string; emailOrLogin: string }>;
      memberships: Array<{ userId: string; status: string }>;
    };

    let userId = workspace.users.find((u) => u.emailOrLogin.toLowerCase() === emailOrLogin)?.id ?? null;

    if (!userId) {
      const createResp = await fetch(`${url}/api/users`, {
        method: "POST",
        headers,
        body: JSON.stringify({ emailOrLogin, displayName, role: "supporting" })
      });
      if (createResp.status === 409) {
        // Lost a race with another request creating the same user between
        // our lookup and this call -- re-fetch rather than fail.
        const retryResp = await fetch(`${url}/api/workspace`, { headers });
        if (!retryResp.ok) return null;
        const retried = (await retryResp.json()) as typeof workspace;
        userId = retried.users.find((u) => u.emailOrLogin.toLowerCase() === emailOrLogin)?.id ?? null;
        if (!userId) return null;
      } else if (!createResp.ok) {
        console.error(`[commons-crew-client] identity bridge: could not create user for ${safeEmailOrLogin} (${createResp.status})`);
        return null;
      } else {
        const created = (await createResp.json()) as { user: { id: string } };
        userId = created.user.id;
      }
    }

    const hasActiveMembership = workspace.memberships.some((m) => m.userId === userId && m.status === "active");
    if (!hasActiveMembership) {
      const membershipResp = await fetch(`${url}/api/workspaces/${workspace.workspace.id}/memberships`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          userId,
          actorUserId: COMMONS_CREW_FALLBACK_ACTOR,
          role: "supporting",
          permissions: ["approval_decision"]
        })
      });
      // 409 workspace_membership_exists is fine -- another request already
      // added it between our check and this call. Anything else is a real
      // failure the caller should fall back on.
      if (!membershipResp.ok && membershipResp.status !== 409) {
        console.error(`[commons-crew-client] identity bridge: could not add membership for ${safeEmailOrLogin} (${membershipResp.status})`);
        return null;
      }
    }

    return userId;
  } catch (err) {
    console.error(`[commons-crew-client] identity bridge errored for ${safeEmailOrLogin}:`, err instanceof Error ? err.message : err);
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
  orgContext: string;
  comment?: string;
}

export interface DispatchResult {
  decision: "approved" | "denied";
  childRunId: string | null;
  layer: string | null;
}

export async function submitDispatchDecision(input: SubmitDispatchDecisionInput): Promise<DispatchResult | null> {
  const config = commonsCrewConfig();
  if (!config) return null;
  const { url, headers } = config;

  const bridgedActor = await ensureBoardMemberIdentity({ orgContext: input.orgContext, userId: input.actorUserId });
  const decidingActor = bridgedActor ?? COMMONS_CREW_FALLBACK_ACTOR;

  try {
    const decisionResp = await fetch(`${url}/api/approvals/${input.approvalId}/decision`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: input.decision, comment: input.comment ?? "Decided via commons-board.", actorUserId: decidingActor })
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

export interface PublishedArtifact {
  id: string;
  runId: string | null;
  taskId: string | null;
  artifactType: string;
  storagePath: string;
  summary: string;
  createdAt: string;
}

/**
 * Fetches published artifacts from a commons-crew run. When a chair's
 * commons-crew run executes a task that produces a deliverable, the
 * publish_artifact tool copies the file into the run's artifact store and
 * records an ArtifactRecord. This function fetches those records so the
 * board can surface them to the user who made the original request.
 *
 * Non-fatal on any failure — returns null rather than throwing, same
 * reasoning as the other bridge functions: commons-crew isn't guaranteed
 * reachable, and a failed fetch should be a visible-but-recoverable state.
 */
export async function fetchPublishedArtifacts(runId: string): Promise<PublishedArtifact[] | null> {
  const config = commonsCrewConfig();
  if (!config) return null;
  const { url, headers } = config;

  try {
    const resp = await fetch(`${url}/api/runs/${runId}/artifacts/published`, { headers });
    if (!resp.ok) {
      console.error(`[commons-crew-client] fetch-artifacts failed for run ${runId} (${resp.status})`);
      return null;
    }
    const data = (await resp.json()) as { artifacts?: PublishedArtifact[] };
    return data.artifacts ?? [];
  } catch (err) {
    console.error(`[commons-crew-client] fetch-artifacts errored for run ${runId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
