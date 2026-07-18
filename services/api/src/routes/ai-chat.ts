/**
 * Freeform AI chat — direct multi-turn session with the configured model.
 * No board routing, no chair fan-out. Context carried across turns via full history.
 *
 * Routes:
 *   POST /api/v1/ai/chat                    — single-turn (sync fallback)
 *   POST /api/v1/ai/chat/stream             — streaming SSE (preferred)
 *   GET  /api/v1/ai/chat/sessions            — list all sessions
 *   GET  /api/v1/ai/chat/sessions/:sessionId — get full session with messages
 */
import { Router, type Request, type Response } from "express";
import { requireContext } from "../lib/auth.js";
import { completeChat, parseThinking } from "../lib/model-client.js";
import { resolveApiKey } from "../lib/provider/index.js";
import { getArtifact } from "../lib/artifact-store.js";
import { listBoardChatThreads } from "../lib/board-chat-job-store.js";
import { loadSettings } from "../lib/settings-store.js";
import {
  createAiChatSession,
  getAiChatSession,
  appendAiChatMessages,
  updateAiChatSessionModel,
  listAiChatSessions,
} from "../lib/ai-chat-session-store.js";

export const aiChatRouter = Router();
aiChatRouter.use(requireContext);

type ChatBody = {
  message: string;
  session_id?: string;
  system?: string;
};

const KNOWN_ENDPOINTS: Record<string, string> = {
  featherless: "https://api.featherless.ai/v1",
  openai: "https://api.openai.com/v1",
};

/**
 * Builds a contextual system prompt grounded in this workspace's actual data:
 * org profile, board configuration, recent board threads, and recent AI chat sessions.
 * This replaces generic "I don't know your context" answers with platform-aware responses.
 */
async function buildContextualSystem(workspaceId: string): Promise<string> {
  const today = new Date().toISOString().split("T")[0];
  const lines: string[] = [];

  // ── Identity ───────────────────────────────────────────────────────────────
  const profileRecord = await getArtifact(workspaceId, "business_profile");
  const profile = profileRecord?.payload as Record<string, unknown> | null ?? null;

  const orgName = profile
    ? String(profile.org_name ?? profile.name ?? profile.organization_name ?? "").trim()
    : "";

  lines.push(
    `You are a direct AI assistant embedded in commons-board${orgName ? ` for ${orgName}` : ""}, an autonomous governance platform.`,
    `Current date: ${today}.`,
  );

  // ── Organization context ───────────────────────────────────────────────────
  if (profile) {
    const contextParts: string[] = [];
    const strField = (key: string) => {
      const v = profile[key];
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };

    if (orgName) contextParts.push(`Name: ${orgName}`);
    const type = strField("business_type") ?? strField("org_type") ?? strField("type");
    if (type) contextParts.push(`Type: ${type}`);
    const industry = strField("industry") ?? strField("sector");
    if (industry) contextParts.push(`Industry: ${industry}`);
    const mission = strField("mission") ?? strField("mission_statement");
    if (mission) contextParts.push(`Mission: ${mission.slice(0, 200)}`);
    const description = strField("description") ?? strField("about") ?? strField("summary");
    if (description) contextParts.push(`About: ${description.slice(0, 300)}`);
    const stage = strField("stage") ?? strField("company_stage");
    if (stage) contextParts.push(`Stage: ${stage}`);
    const size = strField("size") ?? strField("team_size") ?? strField("employee_count");
    if (size) contextParts.push(`Size: ${size}`);

    if (contextParts.length > 0) {
      lines.push("", "== ORGANIZATION ==");
      for (const part of contextParts) lines.push(part);
    }
  }

  // ── Board configuration ────────────────────────────────────────────────────
  const blueprintRecord = await getArtifact(workspaceId, "agent_blueprint");
  const blueprint = blueprintRecord?.payload as { chairs?: Array<{ name: string; domain: string; description?: string }> } | null ?? null;
  const chairs = blueprint?.chairs ?? [];
  if (chairs.length > 0) {
    lines.push("", "== ACTIVE BOARD ==");
    for (const c of chairs) {
      lines.push(`- ${c.name} (${c.domain})${c.description ? `: ${c.description.slice(0, 120)}` : ""}`);
    }
  }

  // ── Recent board conversations ─────────────────────────────────────────────
  const boardThreads = listBoardChatThreads(workspaceId).slice(0, 6);
  if (boardThreads.length > 0) {
    lines.push("", "== RECENT BOARD CONVERSATIONS ==");
    for (const t of boardThreads) {
      const preview = t.first_message.replace(/\s+/g, " ").trim().slice(0, 100);
      const headline = t.last_headline ? ` → ${t.last_headline.slice(0, 80)}` : "";
      lines.push(`- "${preview}"${headline}`);
    }
  }

  // ── Recent AI chat sessions ────────────────────────────────────────────────
  const aiSessions = listAiChatSessions(workspaceId).slice(0, 6);
  if (aiSessions.length > 0) {
    lines.push("", "== RECENT AI CHAT SESSIONS ==");
    for (const s of aiSessions) {
      lines.push(`- "${s.title.slice(0, 100)}" (${s.message_count / 2 | 0} turns)`);
    }
  }

  // ── Platform capabilities (ground truth about what's already stored) ───────
  lines.push(
    "",
    "== WHAT THIS PLATFORM ALREADY STORES ==",
    "commons-board persists everything automatically. There is no need for Notion, Firebase, spreadsheets, or blockchain workarounds:",
    "- AI Chat sessions (this session included) — saved, resumable, full history recalled on return",
    "- Board chat threads — full deliberations with all board chairs, stored with per-chair reasoning",
    "- Governance decisions and board minutes — immutable decision log",
    "- Board documents and artifacts — versioned, schema-validated",
    "- Pending approvals, votes, and amendments",
    "- Treasury, revenue, and billing metrics",
    "",
    "When someone asks about memory, storing information, or referencing past conversations: the answer is that it is already handled. Direct them to the relevant section of the platform, not to external tools.",
  );

  // ── Behavioral instructions ────────────────────────────────────────────────
  lines.push(
    "",
    "You have broad knowledge across business strategy, operations, finance, legal, HR, IT, security, and organizational design.",
    "Answer from this organization's specific context whenever possible. Be direct, concrete, and practical.",
    "Do not suggest tools or workflows the platform already provides. Do not recommend external databases, blockchain storage, or manual copy-paste workflows when the platform already handles persistence.",
    "When referencing dates or timeframes, use the current date above as the baseline.",
  );

  return lines.join("\n");
}

/** POST /api/v1/ai/chat/stream — streaming SSE */
aiChatRouter.post("/stream", async (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const body = req.body as ChatBody;

  if (!body.message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const settings = await loadSettings(workspaceId);
  const config = settings.providers.find((p) => p.provider_id === settings.active_provider_id);
  if (!config) {
    res.status(503).json({ error: "no provider configured — add one in Settings" });
    return;
  }
  if (config.kind !== "hosted_api") {
    res.status(501).json({ error: "streaming requires a hosted_api provider" });
    return;
  }

  let session = body.session_id ? getAiChatSession(workspaceId, body.session_id) : null;
  if (!session) session = createAiChatSession(workspaceId, body.message, config.model);

  const history = session.messages.map((m) => ({ role: m.role, content: m.content }));
  const system = body.system ?? await buildContextualSystem(workspaceId);

  const base = (config.endpoint ?? KNOWN_ENDPOINTS[config.provider_id] ?? "").replace(/\/$/, "");
  const key = resolveApiKey(config);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const upstream = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(120_000),
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: system },
          ...history,
          { role: "user", content: body.message },
        ],
        stream: true,
        temperature: 0.7,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      res.write(`data: ${JSON.stringify({ error: `provider HTTP ${upstream.status}` })}\n\n`);
      res.end();
      return;
    }

    let rawText = "";
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
          };
          const token = chunk.choices?.[0]?.delta?.content ?? "";
          if (token) {
            rawText += token;
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
        } catch { /* malformed SSE chunk — skip */ }
      }
    }

    const { answer, thinking } = parseThinking(rawText);
    const now = new Date().toISOString();
    appendAiChatMessages(workspaceId, session.session_id, [
      { role: "user", content: body.message, created_at: now },
      { role: "assistant", content: answer, thinking: thinking || undefined, created_at: now },
    ]);
    updateAiChatSessionModel(workspaceId, session.session_id, config.model);

    res.write(`data: ${JSON.stringify({ done: true, session_id: session.session_id, model: config.model })}\n\n`);
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "streaming failed";
    try { res.write(`data: ${JSON.stringify({ error: msg })}\n\n`); res.end(); } catch { /* already closed */ }
  }
});

/** POST /api/v1/ai/chat — sync fallback */
aiChatRouter.post("/", async (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const body = req.body as ChatBody;

  if (!body.message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  let session = body.session_id ? getAiChatSession(workspaceId, body.session_id) : null;
  if (!session) session = createAiChatSession(workspaceId, body.message, null);

  const history = session.messages.map((m) => ({ role: m.role, content: m.content }));

  try {
    const { answer, thinking, model } = await completeChat(workspaceId, await buildContextualSystem(workspaceId), history, body.message);
    const now = new Date().toISOString();
    appendAiChatMessages(workspaceId, session.session_id, [
      { role: "user", content: body.message, created_at: now },
      { role: "assistant", content: answer, thinking: thinking || undefined, created_at: now },
    ]);
    updateAiChatSessionModel(workspaceId, session.session_id, model);
    res.json({ session_id: session.session_id, reply: answer, model });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "inference failed" });
  }
});

/** GET /api/v1/ai/chat/sessions */
aiChatRouter.get("/sessions", (req: Request, res: Response) => {
  res.json({ sessions: listAiChatSessions(req.ctx!.workspaceId) });
});

/** GET /api/v1/ai/chat/sessions/:sessionId */
aiChatRouter.get("/sessions/:sessionId", (req: Request, res: Response) => {
  const session = getAiChatSession(req.ctx!.workspaceId, req.params.sessionId);
  if (!session) { res.status(404).json({ error: "session not found" }); return; }
  res.json(session);
});
