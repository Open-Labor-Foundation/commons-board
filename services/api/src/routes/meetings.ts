/**
 * Meetings and executive sessions API.
 *
 * Routes:
 *   POST   /api/v1/meetings                        — create meeting
 *   GET    /api/v1/meetings                        — list meetings for workspace
 *   GET    /api/v1/meetings/:id                    — get meeting + messages
 *   POST   /api/v1/meetings/:id/messages           — add message to meeting
 *   POST   /api/v1/meetings/:id/respond            — AI chair response for meeting
 *   POST   /api/v1/meetings/:id/close              — close meeting with summary
 *
 *   POST   /api/v1/meetings/sessions               — create executive session
 *   GET    /api/v1/meetings/sessions/:id           — get session + messages
 *   POST   /api/v1/meetings/sessions/:id/messages  — add message to session
 *   POST   /api/v1/meetings/sessions/:id/respond   — AI response for session
 *
 * Ported from mother-board meetings API, sanitized for commons-board conventions.
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { BoardDomain, GovernanceEvent } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import { appendEvent } from "../lib/decision-log.js";
import { getArtifact } from "../lib/artifact-store.js";
import { getSessionState, applyInterpretation } from "../services/board-session-state.js";
import { interpretChatMessage } from "../services/chat-interpreter.js";
import { buildReasonedBoardResponse } from "../services/chair-reasoning.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Meeting = {
  id: string;
  workspace_id: string;
  project_id?: string;
  title: string;
  agenda: string;
  desired_decision?: string;
  participants: string[];
  status: "open" | "closed";
  summary?: string;
  rationale?: string;
  vote?: string;
  next_actions?: string[];
  created_at: string;
  closed_at?: string;
};

type MeetingMessage = {
  id: string;
  meeting_id: string;
  workspace_id: string;
  author_type: "USER" | "AGENT";
  author_id: string;
  content: string;
  structured_json?: Record<string, unknown>;
  created_at: string;
};

type ExecutiveSession = {
  id: string;
  workspace_id: string;
  project_id?: string;
  executive_agent: string;
  status: "open" | "closed";
  created_at: string;
};

type ExecSessionMessage = {
  id: string;
  session_id: string;
  workspace_id: string;
  author_type: "USER" | "AGENT";
  author_id: string;
  content: string;
  structured_json?: Record<string, unknown>;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function meetingsKey(workspaceId: string): string {
  return `meetings/${workspaceId}`;
}

function meetingMessagesKey(workspaceId: string, meetingId: string): string {
  return `meeting-messages/${workspaceId}/${meetingId}`;
}

function execSessionsKey(workspaceId: string): string {
  return `exec-sessions/${workspaceId}`;
}

function execSessionMessagesKey(workspaceId: string, sessionId: string): string {
  return `exec-session-messages/${workspaceId}/${sessionId}`;
}

// ---------------------------------------------------------------------------
// Chair resolution helper (shared by meeting/respond and session/respond)
// ---------------------------------------------------------------------------

type ChairEntry = {
  chair_id: string;
  name: string;
  domain: string;
  labor_commons_refs?: Array<{ specialist_slug: string; role: string }>;
};

function resolveChair(
  workspaceId: string,
  targetChairId?: string,
  targetDomain?: BoardDomain
): { chair: ChairEntry | null; laborCommonsSlug: string | undefined } {
  const blueprintRecord = getArtifact(workspaceId, "agent_blueprint");
  const blueprint = blueprintRecord
    ? (blueprintRecord.payload as Record<string, unknown>)
    : { chairs: [] };

  const chairs = Array.isArray((blueprint as Record<string, unknown>).chairs)
    ? (blueprint.chairs as ChairEntry[])
    : [];

  const chair =
    chairs.find((c) =>
      targetChairId ? c.chair_id === targetChairId : c.domain === targetDomain
    ) ?? null;

  const laborCommonsSlug = chair?.labor_commons_refs?.find((r) => r.role === "primary")
    ?.specialist_slug;

  return { chair, laborCommonsSlug };
}

// ---------------------------------------------------------------------------
// AI respond helper — builds synthetic request/roadmap and calls chair reasoning
// ---------------------------------------------------------------------------

async function buildAIResponse(
  workspaceId: string,
  threadId: string,
  userMessage: string,
  userId: string
): Promise<{
  messageId: string;
  responseText: string;
  domain: string;
  chairId: string | null;
  routing: { spec: unknown; routing_note: string; reused_context: boolean };
} | { error: string }> {
  const sessionState = getSessionState(workspaceId, threadId);

  const { spec, routing_note, reused_context } = interpretChatMessage({
    message: userMessage,
    workspaceId,
    threadId,
    sessionState
  });

  applyInterpretation(workspaceId, threadId, spec);

  const targetChairId = spec.target_chair_id ?? undefined;
  const targetDomain: BoardDomain = spec.target_chair_domain ?? "ops";

  const { chair, laborCommonsSlug } = resolveChair(workspaceId, targetChairId, targetDomain);

  const now = new Date().toISOString();

  const syntheticRequest = {
    id: randomUUID(),
    org_id: workspaceId,
    title: userMessage.slice(0, 120).trim(),
    request: userMessage,
    requested_by: userId,
    target_chair_id: chair?.chair_id ?? "",
    target_domain: targetDomain,
    routing_mode: "auto" as const,
    status: "submitted" as const,
    priority: "medium" as const,
    constraints: [],
    success_criteria: [],
    dependency_ids: [],
    approval_required: false,
    risk_level: "low" as const,
    created_at: now,
    updated_at: now
  };

  const syntheticRoadmap = {
    id: randomUUID(),
    org_id: workspaceId,
    request_id: syntheticRequest.id,
    version: 1,
    domain: targetDomain,
    owner_chair_id: chair?.chair_id ?? "",
    summary: `Board response for "${syntheticRequest.title}"`,
    assumptions: [],
    risks: [],
    mitigation_plan: [],
    resource_requests: [],
    phases: [],
    created_by: userId,
    created_at: now
  };

  let chairResult: { responseText: string; responseMeta: { confidence: number; citations: string[] } };

  try {
    chairResult = await buildReasonedBoardResponse({
      request: syntheticRequest,
      roadmap: syntheticRoadmap,
      laborCommonsSlug
    });
  } catch {
    return { error: "chair reasoning failed" };
  }

  return {
    messageId: randomUUID(),
    responseText: chairResult.responseText,
    domain: targetDomain,
    chairId: chair?.chair_id ?? null,
    routing: { spec, routing_note, reused_context }
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const meetingsRouter = Router();
meetingsRouter.use(requireContext);

// ---------------------------------------------------------------------------
// Meeting routes — /sessions prefix must be registered before /:id to avoid
// the literal string "sessions" being matched as a meeting id.
// ---------------------------------------------------------------------------

/** POST /api/v1/meetings/sessions — create executive session */
meetingsRouter.post(
  "/sessions",
  requireRole(["admin", "operator"]),
  (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const body = req.body as { executive_agent?: string; project_id?: string };

    if (!body.executive_agent?.trim()) {
      res.status(400).json({ error: "executive_agent is required" });
      return;
    }

    const session: ExecutiveSession = {
      id: randomUUID(),
      workspace_id: ctx.workspaceId,
      project_id: body.project_id,
      executive_agent: body.executive_agent.trim(),
      status: "open",
      created_at: new Date().toISOString()
    };

    const sessions = readJson<ExecutiveSession[]>(execSessionsKey(ctx.workspaceId), []);
    sessions.push(session);
    writeJsonAtomic(execSessionsKey(ctx.workspaceId), sessions);

    appendEvent({
      event_id: randomUUID(),
      org_id: ctx.workspaceId,
      event_type: "exec_session_created",
      actor: ctx.userId,
      artifact_type: null,
      artifact_id: session.id,
      details: { executive_agent: session.executive_agent, project_id: session.project_id ?? null },
      at: new Date().toISOString()
    } satisfies GovernanceEvent);

    res.status(201).json({ session });
  }
);

/** GET /api/v1/meetings/sessions/:id — get session + messages */
meetingsRouter.get("/sessions/:id", (req: Request, res: Response) => {
  const ctx = req.ctx!;
  const { id } = req.params;

  const sessions = readJson<ExecutiveSession[]>(execSessionsKey(ctx.workspaceId), []);
  const session = sessions.find((s) => s.id === id);

  if (!session) {
    res.status(404).json({ error: "exec session not found" });
    return;
  }

  const messages = readJson<ExecSessionMessage[]>(
    execSessionMessagesKey(ctx.workspaceId, id),
    []
  );

  res.status(200).json({ session, messages });
});

/** POST /api/v1/meetings/sessions/:id/messages — add message to session */
meetingsRouter.post(
  "/sessions/:id/messages",
  requireRole(["admin", "operator"]),
  (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const { id } = req.params;

    const sessions = readJson<ExecutiveSession[]>(execSessionsKey(ctx.workspaceId), []);
    const session = sessions.find((s) => s.id === id);

    if (!session) {
      res.status(404).json({ error: "exec session not found" });
      return;
    }
    if (session.status === "closed") {
      res.status(409).json({ error: "exec session is closed" });
      return;
    }

    const body = req.body as {
      author_type?: string;
      author_id?: string;
      content?: string;
      structured_json?: Record<string, unknown>;
    };

    if (!body.content?.trim()) {
      res.status(400).json({ error: "content is required" });
      return;
    }
    if (body.author_type !== "USER" && body.author_type !== "AGENT") {
      res.status(400).json({ error: "author_type must be USER or AGENT" });
      return;
    }

    const message: ExecSessionMessage = {
      id: randomUUID(),
      session_id: id,
      workspace_id: ctx.workspaceId,
      author_type: body.author_type,
      author_id: body.author_id ?? ctx.userId,
      content: body.content.trim(),
      structured_json: body.structured_json,
      created_at: new Date().toISOString()
    };

    const messages = readJson<ExecSessionMessage[]>(
      execSessionMessagesKey(ctx.workspaceId, id),
      []
    );
    messages.push(message);
    writeJsonAtomic(execSessionMessagesKey(ctx.workspaceId, id), messages);

    res.status(201).json({ message });
  }
);

/** POST /api/v1/meetings/sessions/:id/respond — AI response for session */
meetingsRouter.post(
  "/sessions/:id/respond",
  requireRole(["admin", "operator"]),
  async (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const { id } = req.params;

    const sessions = readJson<ExecutiveSession[]>(execSessionsKey(ctx.workspaceId), []);
    const session = sessions.find((s) => s.id === id);

    if (!session) {
      res.status(404).json({ error: "exec session not found" });
      return;
    }
    if (session.status === "closed") {
      res.status(409).json({ error: "exec session is closed" });
      return;
    }

    const messages = readJson<ExecSessionMessage[]>(
      execSessionMessagesKey(ctx.workspaceId, id),
      []
    );

    const lastUserMessage = [...messages].reverse().find((m) => m.author_type === "USER");
    if (!lastUserMessage) {
      res.status(422).json({ error: "no USER message found in session to respond to" });
      return;
    }

    const result = await buildAIResponse(
      ctx.workspaceId,
      `exec-session-${id}`,
      lastUserMessage.content,
      ctx.userId
    );

    if ("error" in result) {
      res.status(502).json({ error: result.error });
      return;
    }

    const agentMessage: ExecSessionMessage = {
      id: result.messageId,
      session_id: id,
      workspace_id: ctx.workspaceId,
      author_type: "AGENT",
      author_id: result.chairId ?? `${result.domain}-chair`,
      content: result.responseText,
      created_at: new Date().toISOString()
    };

    messages.push(agentMessage);
    writeJsonAtomic(execSessionMessagesKey(ctx.workspaceId, id), messages);

    res.status(200).json({
      message_id: agentMessage.id,
      response_text: result.responseText,
      domain: result.domain,
      chair_id: result.chairId,
      routing: result.routing
    });
  }
);

// ---------------------------------------------------------------------------
// Meeting CRUD
// ---------------------------------------------------------------------------

/** POST /api/v1/meetings — create meeting */
meetingsRouter.post(
  "/",
  requireRole(["admin", "operator"]),
  (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const body = req.body as {
      title?: string;
      agenda?: string;
      desired_decision?: string;
      participants?: string[];
      project_id?: string;
    };

    if (!body.title?.trim()) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    if (!body.agenda?.trim()) {
      res.status(400).json({ error: "agenda is required" });
      return;
    }

    const meeting: Meeting = {
      id: randomUUID(),
      workspace_id: ctx.workspaceId,
      project_id: body.project_id,
      title: body.title.trim(),
      agenda: body.agenda.trim(),
      desired_decision: body.desired_decision?.trim(),
      participants: Array.isArray(body.participants) ? body.participants : [],
      status: "open",
      created_at: new Date().toISOString()
    };

    const meetings = readJson<Meeting[]>(meetingsKey(ctx.workspaceId), []);
    meetings.push(meeting);
    writeJsonAtomic(meetingsKey(ctx.workspaceId), meetings);

    appendEvent({
      event_id: randomUUID(),
      org_id: ctx.workspaceId,
      event_type: "meeting_created",
      actor: ctx.userId,
      artifact_type: null,
      artifact_id: meeting.id,
      details: {
        title: meeting.title,
        project_id: meeting.project_id ?? null,
        participant_count: meeting.participants.length
      },
      at: new Date().toISOString()
    } satisfies GovernanceEvent);

    res.status(201).json({ meeting });
  }
);

/** GET /api/v1/meetings — list meetings for workspace */
meetingsRouter.get("/", (req: Request, res: Response) => {
  const ctx = req.ctx!;
  const meetings = readJson<Meeting[]>(meetingsKey(ctx.workspaceId), []);
  res.status(200).json({ meetings, total: meetings.length });
});

/** GET /api/v1/meetings/:id — get meeting + messages */
meetingsRouter.get("/:id", (req: Request, res: Response) => {
  const ctx = req.ctx!;
  const { id } = req.params;

  const meetings = readJson<Meeting[]>(meetingsKey(ctx.workspaceId), []);
  const meeting = meetings.find((m) => m.id === id);

  if (!meeting) {
    res.status(404).json({ error: "meeting not found" });
    return;
  }

  const messages = readJson<MeetingMessage[]>(
    meetingMessagesKey(ctx.workspaceId, id),
    []
  );

  res.status(200).json({ meeting, messages });
});

/** POST /api/v1/meetings/:id/messages — add message to meeting */
meetingsRouter.post(
  "/:id/messages",
  requireRole(["admin", "operator"]),
  (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const { id } = req.params;

    const meetings = readJson<Meeting[]>(meetingsKey(ctx.workspaceId), []);
    const meeting = meetings.find((m) => m.id === id);

    if (!meeting) {
      res.status(404).json({ error: "meeting not found" });
      return;
    }
    if (meeting.status === "closed") {
      res.status(409).json({ error: "meeting is closed" });
      return;
    }

    const body = req.body as {
      author_type?: string;
      author_id?: string;
      content?: string;
      structured_json?: Record<string, unknown>;
    };

    if (!body.content?.trim()) {
      res.status(400).json({ error: "content is required" });
      return;
    }
    if (body.author_type !== "USER" && body.author_type !== "AGENT") {
      res.status(400).json({ error: "author_type must be USER or AGENT" });
      return;
    }

    const message: MeetingMessage = {
      id: randomUUID(),
      meeting_id: id,
      workspace_id: ctx.workspaceId,
      author_type: body.author_type,
      author_id: body.author_id ?? ctx.userId,
      content: body.content.trim(),
      structured_json: body.structured_json,
      created_at: new Date().toISOString()
    };

    const messages = readJson<MeetingMessage[]>(
      meetingMessagesKey(ctx.workspaceId, id),
      []
    );
    messages.push(message);
    writeJsonAtomic(meetingMessagesKey(ctx.workspaceId, id), messages);

    res.status(201).json({ message });
  }
);

/** POST /api/v1/meetings/:id/respond — AI chair response for meeting */
meetingsRouter.post(
  "/:id/respond",
  requireRole(["admin", "operator"]),
  async (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const { id } = req.params;

    const meetings = readJson<Meeting[]>(meetingsKey(ctx.workspaceId), []);
    const meeting = meetings.find((m) => m.id === id);

    if (!meeting) {
      res.status(404).json({ error: "meeting not found" });
      return;
    }
    if (meeting.status === "closed") {
      res.status(409).json({ error: "meeting is closed" });
      return;
    }

    const messages = readJson<MeetingMessage[]>(
      meetingMessagesKey(ctx.workspaceId, id),
      []
    );

    const lastUserMessage = [...messages].reverse().find((m) => m.author_type === "USER");
    if (!lastUserMessage) {
      res.status(422).json({ error: "no USER message found in meeting to respond to" });
      return;
    }

    const result = await buildAIResponse(
      ctx.workspaceId,
      `meeting-${id}`,
      lastUserMessage.content,
      ctx.userId
    );

    if ("error" in result) {
      res.status(502).json({ error: result.error });
      return;
    }

    const agentMessage: MeetingMessage = {
      id: result.messageId,
      meeting_id: id,
      workspace_id: ctx.workspaceId,
      author_type: "AGENT",
      author_id: result.chairId ?? `${result.domain}-chair`,
      content: result.responseText,
      created_at: new Date().toISOString()
    };

    messages.push(agentMessage);
    writeJsonAtomic(meetingMessagesKey(ctx.workspaceId, id), messages);

    appendEvent({
      event_id: randomUUID(),
      org_id: ctx.workspaceId,
      event_type: "meeting_respond_completed",
      actor: ctx.userId,
      artifact_type: null,
      artifact_id: id,
      details: {
        domain: result.domain,
        chair_id: result.chairId ?? null,
        message_id: agentMessage.id
      },
      at: new Date().toISOString()
    } satisfies GovernanceEvent);

    res.status(200).json({
      message_id: agentMessage.id,
      response_text: result.responseText,
      domain: result.domain,
      chair_id: result.chairId,
      routing: result.routing
    });
  }
);

/** POST /api/v1/meetings/:id/close — close meeting */
meetingsRouter.post(
  "/:id/close",
  requireRole(["admin", "operator"]),
  (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const { id } = req.params;

    const meetings = readJson<Meeting[]>(meetingsKey(ctx.workspaceId), []);
    const meetingIndex = meetings.findIndex((m) => m.id === id);

    if (meetingIndex === -1) {
      res.status(404).json({ error: "meeting not found" });
      return;
    }

    const meeting = meetings[meetingIndex];

    if (meeting.status === "closed") {
      res.status(409).json({ error: "meeting is already closed" });
      return;
    }

    const body = req.body as {
      summary?: string;
      rationale?: string;
      vote?: string;
      next_actions?: string[];
    };

    if (!body.summary?.trim()) {
      res.status(400).json({ error: "summary is required to close a meeting" });
      return;
    }

    const closedAt = new Date().toISOString();

    const updated: Meeting = {
      ...meeting,
      status: "closed",
      summary: body.summary.trim(),
      rationale: body.rationale?.trim(),
      vote: body.vote?.trim(),
      next_actions: Array.isArray(body.next_actions) ? body.next_actions : undefined,
      closed_at: closedAt
    };

    meetings[meetingIndex] = updated;
    writeJsonAtomic(meetingsKey(ctx.workspaceId), meetings);

    appendEvent({
      event_id: randomUUID(),
      org_id: ctx.workspaceId,
      event_type: "meeting_closed",
      actor: ctx.userId,
      artifact_type: null,
      artifact_id: id,
      details: {
        title: updated.title,
        vote: updated.vote ?? null,
        has_next_actions: Array.isArray(updated.next_actions) && updated.next_actions.length > 0
      },
      at: closedAt
    } satisfies GovernanceEvent);

    res.status(200).json({ meeting: updated });
  }
);
