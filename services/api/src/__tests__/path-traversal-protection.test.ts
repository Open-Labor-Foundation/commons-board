import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDataDir, removeTestDataDir } from "./helpers.js";
import { createJob, getJob } from "../lib/job-store.js";
import { createBoardChatJob, getBoardChatJob } from "../lib/board-chat-job-store.js";
import { createAiChatSession, getAiChatSession } from "../lib/ai-chat-session-store.js";

// Regression coverage for CodeQL js/path-injection: workspaceId/jobId/sessionId
// flow straight from request headers/params (see auth.ts's x-workspace-id
// header) into path.join with no prior validation. Each store's *Dir/*Path
// helper now calls assertSafePathSegment before building a path -- these
// tests prove that actually rejects traversal, not just that it compiles.
describe("path traversal protection (job-store, board-chat-job-store, ai-chat-session-store)", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestDataDir();
  });

  afterEach(() => {
    removeTestDataDir(dir);
  });

  test("job-store: createJob rejects a traversal workspaceId", () => {
    assert.throws(() => createJob("../../../etc", "agent-1", "chair-1", { description: "x" }));
  });

  test("job-store: getJob rejects a traversal jobId (getJob wraps the whole read in try/catch, so the validation throw surfaces as a null return, not an exception -- either way, no file outside the jobs dir is ever touched)", () => {
    assert.equal(getJob("workspace-1", "../../../etc/passwd"), null);
  });

  test("job-store: a real workspace/job id still round-trips", () => {
    const job = createJob("workspace-1", "agent-1", "chair-1", { description: "real task" });
    const fetched = getJob("workspace-1", job.job_id);
    assert.equal(fetched?.job_id, job.job_id);
  });

  test("board-chat-job-store: createBoardChatJob rejects a traversal workspaceId", () => {
    assert.throws(() => createBoardChatJob("../../../etc", "thread-1", "hello"));
  });

  test("board-chat-job-store: getBoardChatJob rejects a traversal jobId (surfaces as null, same try/catch shape as job-store)", () => {
    assert.equal(getBoardChatJob("workspace-1", "../../../etc/passwd"), null);
  });

  test("board-chat-job-store: a real workspace/job id still round-trips", () => {
    const job = createBoardChatJob("workspace-1", "thread-1", "hello");
    const fetched = getBoardChatJob("workspace-1", job.job_id);
    assert.equal(fetched?.job_id, job.job_id);
  });

  test("ai-chat-session-store: createAiChatSession rejects a traversal workspaceId", () => {
    assert.throws(() => createAiChatSession("../../../etc", "hello", null));
  });

  test("ai-chat-session-store: getAiChatSession rejects a traversal sessionId (surfaces as null, same try/catch shape as job-store)", () => {
    assert.equal(getAiChatSession("workspace-1", "../../../etc/passwd"), null);
  });

  test("ai-chat-session-store: a real workspace/session id still round-trips", () => {
    const session = createAiChatSession("workspace-1", "hello", null);
    const fetched = getAiChatSession("workspace-1", session.session_id);
    assert.equal(fetched?.session_id, session.session_id);
  });
});
