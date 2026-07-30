/**
 * Guards workspace/job/session-style identifiers before they're used to
 * build a filesystem path. These are always meant to be UUIDs or slug-like
 * ids -- reject anything containing '/', '\', '..', or other characters
 * that could escape the intended directory when passed to path.join.
 *
 * CodeQL flagged js/path-injection at every path.join call site in
 * job-store.ts, board-chat-job-store.ts, and ai-chat-session-store.ts:
 * workspaceId/jobId/sessionId flow straight from request headers/params
 * (see auth.ts's x-workspace-id header) into path.join with no validation
 * at all. persistence.ts already guards the equivalent case with its own
 * resolvePath() segment check (SEGMENT_PATTERN) -- this is the same
 * approach, extracted so the three job/session stores can share one
 * definition instead of three slightly-different regexes drifting apart.
 */
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

export function assertSafePathSegment(value: string, label: string): string {
  if (typeof value !== "string" || !SAFE_SEGMENT_PATTERN.test(value)) {
    throw new Error(`invalid ${label}: ${JSON.stringify(value)}`);
  }
  return value;
}
