import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./env.js";

export type AiChatMessage = {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  created_at: string;
};

export type AiChatSession = {
  session_id: string;
  workspace_id: string;
  title: string;
  messages: AiChatMessage[];
  model: string | null;
  created_at: string;
  updated_at: string;
};

export type AiChatSessionSummary = {
  session_id: string;
  title: string;
  message_count: number;
  model: string | null;
  created_at: string;
  updated_at: string;
};

function sessionsDir(workspaceId: string): string {
  return path.join(loadConfig().dataDir, "ai-chat-sessions", workspaceId);
}

function sessionPath(workspaceId: string, sessionId: string): string {
  return path.join(sessionsDir(workspaceId), `${sessionId}.json`);
}

export function createAiChatSession(
  workspaceId: string,
  firstMessage: string,
  model: string | null
): AiChatSession {
  fs.mkdirSync(sessionsDir(workspaceId), { recursive: true });
  const session: AiChatSession = {
    session_id: randomUUID(),
    workspace_id: workspaceId,
    title: firstMessage.replace(/\s+/g, " ").trim().slice(0, 80),
    messages: [],
    model,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(sessionPath(workspaceId, session.session_id), JSON.stringify(session));
  return session;
}

export function getAiChatSession(workspaceId: string, sessionId: string): AiChatSession | null {
  try {
    return JSON.parse(fs.readFileSync(sessionPath(workspaceId, sessionId), "utf-8")) as AiChatSession;
  } catch {
    return null;
  }
}

export function appendAiChatMessages(
  workspaceId: string,
  sessionId: string,
  messages: AiChatMessage[]
): void {
  const session = getAiChatSession(workspaceId, sessionId);
  if (!session) return;
  fs.writeFileSync(
    sessionPath(workspaceId, sessionId),
    JSON.stringify({
      ...session,
      messages: [...session.messages, ...messages],
      updated_at: new Date().toISOString(),
    })
  );
}

export function updateAiChatSessionModel(
  workspaceId: string,
  sessionId: string,
  model: string
): void {
  const session = getAiChatSession(workspaceId, sessionId);
  if (!session || session.model) return; // only set once
  fs.writeFileSync(sessionPath(workspaceId, sessionId), JSON.stringify({ ...session, model }));
}

export function listAiChatSessions(workspaceId: string): AiChatSessionSummary[] {
  const dir = sessionsDir(workspaceId);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as AiChatSession;
          return [{
            session_id: s.session_id,
            title: s.title,
            message_count: s.messages.length,
            model: s.model,
            created_at: s.created_at,
            updated_at: s.updated_at,
          }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  } catch {
    return [];
  }
}
