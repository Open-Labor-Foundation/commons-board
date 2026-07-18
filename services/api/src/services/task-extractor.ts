/**
 * Task extractor — parses chair prose responses for actionable tasks that
 * should be delegated to worker agents.
 *
 * Uses a structured LLM call to identify tasks that match a worker's
 * task_scope. On any failure (LLM error, JSON parse error, validation error),
 * returns an empty array — task extraction never blocks the existing flow.
 *
 * See planning/delegation-architecture.md, Section A.
 */
import { randomUUID } from "node:crypto";
import { NoProviderConfiguredError, parseThinking } from "../lib/model-client.js";
import { enqueueInference } from "../lib/inference-queue.js";
import { summarizeChairResponse } from "./chair-reasoning.js";
import type { BoardDomain } from "@commons-board/shared";
import type {
  DelegatableTask,
  DelegationChairResponse,
  DelegationWorkerAgent,
  OutputType,
} from "./delegation-types.js";

const VALID_OUTPUT_TYPES: OutputType[] = [
  "document",
  "analysis",
  "checklist",
  "structured_data",
  "code",
  "real_world_action",
];

/**
 * Input for extractDelegatableTasks. Takes the chair responses produced by the
 * board chat flow and the worker agents available on the board.
 */
export interface TaskExtractorInput {
  workspaceId: string;
  /** Chair responses to parse for delegatable tasks. */
  chairResponses: DelegationChairResponse[];
  /** Worker agents available to receive tasks. */
  workerAgents: DelegationWorkerAgent[];
  /** Summary of the board request context (the operator's message). */
  requestContext: string;
  /** The board domain being addressed. */
  domain: BoardDomain;
  /** Per-extractor model override. */
  model?: string;
}

/**
 * Extracts delegatable tasks from chair prose responses via an LLM call.
 *
 * The LLM is given the chair responses, the available worker agents (with
 * their task_scope), and the request context. It returns a JSON array of
 * tasks. Each task is validated against the DelegatableTask schema.
 *
 * Returns an empty array on any failure — never blocks the existing flow.
 */
export async function extractDelegatableTasks(
  input: TaskExtractorInput
): Promise<DelegatableTask[]> {
  // No workers → nothing to delegate to.
  if (input.workerAgents.length === 0) {
    return [];
  }
  // No chair responses → nothing to extract from.
  if (input.chairResponses.length === 0) {
    return [];
  }

  // Summarize each chair response before extraction. Chair deliberation
  // responses can be 1000+ words; sending all of them as a single extraction
  // prompt caused timeouts on featherless because the combined prompt was too
  // large for one inference call to complete within the provider's window.
  // Summarizing first reduces the extraction prompt from ~6000+ words to
  // ~1500 words.
  //
  // summarizeChairResponse is non-blocking: on any error it returns the
  // original text unchanged, so extraction can still proceed (degraded but
  // functional). The calls run in parallel since they are independent.
  const summarizedResponses = await Promise.all(
    input.chairResponses.map((r) =>
      summarizeChairResponse(r.response_text, input.workspaceId, r.chair_id)
    )
  );

  const system = buildExtractorSystemPrompt(input);
  const userPrompt = buildExtractorUserPrompt(input, summarizedResponses);

  let raw: string;
  try {
    const result = await enqueueInference({
      callType: "task_extraction",
      workspaceId: input.workspaceId,
      prompt: userPrompt,
      systemPrompt: system,
      model: input.model,
      temperature: 0.1,
      maxTokens: 4096,
    });
    // Strip any chain-of-thought blocks so the JSON extraction regex matches
    // the actual JSON object, not content inside a thinking block.
    raw = parseThinking(result.text).answer;
  } catch (err) {
    if (err instanceof NoProviderConfiguredError) {
      // No provider configured — can't extract tasks. Non-blocking.
      return [];
    }
    console.warn(
      `[delegation] task extraction LLM call failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }

  const tasks = parseAndValidateTasks(raw, input);
  return tasks;
}

function buildExtractorSystemPrompt(input: TaskExtractorInput): string {
  const workerList = input.workerAgents
    .map((w) => {
      const scope = w.task_scope.length > 0 ? w.task_scope.join(", ") : "(no scope defined)";
      const ref = w.labor_commons_ref ?? "(no specialist spec)";
      return `- agent_id: ${w.agent_id} | name: ${w.name} | domain: ${w.domain} | task_scope: ${scope} | specialist: ${ref}`;
    })
    .join("\n");

  return [
    "You are a task extraction system for a governing board.",
    "Your job: read chair responses and identify specific, actionable tasks that should be delegated to worker agents.",
    "",
    "Available worker agents (assign tasks only to these agent_ids):",
    workerList,
    "",
    "Rules:",
    "1. Only extract tasks that a worker agent can actually execute based on its task_scope.",
    "2. Each task must have a clear, specific description of what the worker should produce.",
    "3. Assign each task to exactly one worker agent (assigned_worker_id must be one of the agent_ids above).",
    "4. If no worker's task_scope matches a piece of advice, do NOT extract it as a task — it stays as chair advice.",
    "5. Use depends_on (array of task_ids) only when one task genuinely needs another's output first. Default to empty array.",
    "6. Be conservative: better to extract fewer high-quality tasks than many vague ones.",
    "",
    "Return STRICT JSON only — no markdown, no explanation. The response must be a JSON object with this shape:",
    '{"tasks": [',
    "  {",
    '    "description": "what the worker should produce",',
    '    "assigned_worker_id": "agent_id from the list above",',
    '    "expected_output_type": "document | analysis | checklist | structured_data | code | real_world_action",',
    '    "expected_output_description": "what done looks like",',
    '    "context": "relevant context from the chair response and request",',
    '    "depends_on": [],',
    '    "source_chair_id": "the chair_id that proposed this",',
    '    "source_excerpt": "short quote from the chair response that motivated this task"',
    "  }",
    "]}",
    "",
    "If no tasks should be delegated, return: {\"tasks\": []}",
  ].join("\n");
}

function buildExtractorUserPrompt(
  input: TaskExtractorInput,
  summarizedResponses: string[]
): string {
  const chairSummaries = input.chairResponses
    .map((c, i) => {
      return [
        `--- Chair: ${c.chair_name} (id: ${c.chair_id}, domain: ${c.domain}) ---`,
        summarizedResponses[i] ?? c.response_text,
      ].join("\n");
    })
    .join("\n\n");

  return [
    `Board request context: ${input.requestContext}`,
    `Board domain: ${input.domain}`,
    "",
    "Chair responses:",
    chairSummaries,
    "",
    "Extract delegatable tasks as strict JSON.",
  ].join("\n");
}

/**
 * Parse the LLM response as JSON and validate each task against the
 * DelegatableTask schema. Returns an empty array on any parse/validation
 * failure.
 */
function parseAndValidateTasks(
  raw: string,
  input: TaskExtractorInput
): DelegatableTask[] {
  let parsed: unknown;
  try {
    // Extract the JSON object from the response (the LLM may wrap it in prose).
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[delegation] task extraction returned no JSON object");
      return [];
    }
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn(
      `[delegation] task extraction JSON parse failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }

  const tasksObj = parsed as { tasks?: unknown };
  if (!tasksObj || !Array.isArray(tasksObj.tasks)) {
    console.warn("[delegation] task extraction response has no 'tasks' array");
    return [];
  }

  const validAgentIds = new Set(input.workerAgents.map((w) => w.agent_id));
  const validChairIds = new Set(input.chairResponses.map((c) => c.chair_id));

  const tasks: DelegatableTask[] = [];
  for (const rawTask of tasksObj.tasks) {
    const validated = validateTask(rawTask, validAgentIds, validChairIds);
    if (validated) {
      tasks.push(validated);
    }
  }

  return tasks;
}

/**
 * Validate a single raw task object against the DelegatableTask schema.
 * Returns null if invalid (and logs a warning). Generates the task_id.
 */
function validateTask(
  raw: unknown,
  validAgentIds: Set<string>,
  validChairIds: Set<string>
): DelegatableTask | null {
  if (!raw || typeof raw !== "object") {
    console.warn("[delegation] task validation: expected object, got non-object");
    return null;
  }
  const obj = raw as Record<string, unknown>;

  const description = typeof obj.description === "string" ? obj.description.trim() : "";
  if (!description) {
    console.warn("[delegation] task validation: missing or empty description");
    return null;
  }

  const assignedWorkerId = typeof obj.assigned_worker_id === "string" ? obj.assigned_worker_id.trim() : "";
  if (!assignedWorkerId || !validAgentIds.has(assignedWorkerId)) {
    console.warn(
      `[delegation] task validation: invalid or unknown assigned_worker_id: ${assignedWorkerId}`
    );
    return null;
  }

  const outputTypeRaw = typeof obj.expected_output_type === "string" ? obj.expected_output_type : "";
  if (!isOutputType(outputTypeRaw)) {
    console.warn(`[delegation] task validation: invalid expected_output_type: ${outputTypeRaw}`);
    return null;
  }

  const sourceChairId = typeof obj.source_chair_id === "string" ? obj.source_chair_id.trim() : "";
  if (!sourceChairId || !validChairIds.has(sourceChairId)) {
    console.warn(
      `[delegation] task validation: invalid or unknown source_chair_id: ${sourceChairId}`
    );
    return null;
  }

  const dependsOn = Array.isArray(obj.depends_on)
    ? obj.depends_on.filter((d): d is string => typeof d === "string" && d.trim().length > 0)
    : [];

  return {
    task_id: randomUUID(),
    description,
    assigned_worker_id: assignedWorkerId,
    expected_output_type: outputTypeRaw,
    expected_output_description:
      typeof obj.expected_output_description === "string" ? obj.expected_output_description.trim() : "",
    context: typeof obj.context === "string" ? obj.context.trim() : "",
    depends_on: dependsOn,
    source_chair_id: sourceChairId,
    source_excerpt: typeof obj.source_excerpt === "string" ? obj.source_excerpt.trim() : "",
  };
}

function isOutputType(value: string): value is OutputType {
  return (VALID_OUTPUT_TYPES as string[]).includes(value);
}