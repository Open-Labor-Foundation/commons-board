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
 * pattern, shared here so the three job/session stores don't drift.
 *
 * The actual guard is inlined at each *Dir/*Path call site (an `if
 * (!SAFE_SEGMENT_PATTERN.test(x)) throw` directly in the function that
 * calls path.join) rather than calling out to a shared assert function --
 * CodeQL's path-injection sanitizer recognition is intraprocedural, so a
 * guard hidden behind an opaque function call wasn't being recognized as
 * closing the taint path even though it genuinely does (confirmed: all 21
 * call sites stayed flagged after the first version of this fix, which did
 * exactly that). SAFE_SEGMENT_PATTERN is still exported so the three files
 * share one definition instead of three copies drifting apart; only the
 * control-flow shape of the check itself needed to move.
 */
export const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
