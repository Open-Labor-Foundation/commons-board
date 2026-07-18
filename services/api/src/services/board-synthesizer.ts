/**
 * Board synthesizer — merges chair responses into a unified board-level answer.
 *
 * Ported from mother-board services/board-synthesizer.ts.
 * Sanitized:
 *   - "Mother-Board" → "commons-board"
 *   - resolveCliJsonObject() → model-client.ts completeText()
 *   - workspaceId required for model routing
 */
import { NoProviderConfiguredError, parseThinking } from "../lib/model-client.js";
import { enqueueInference } from "../lib/inference-queue.js";
import type { BoardDomain, BoardInterpretationSpec } from "@commons-board/shared";
import type { DeliverableSummary, WorkerDeliverable } from "./delegation-types.js";

type ChairConsultResult = {
  chair: { id: string; name: string; domain: BoardDomain };
  headline: string;
  summary_markdown: string;
  actions: unknown[];
  approvals: unknown[];
};

export type BoardSynthesisResult = {
  headline: string;
  summary_markdown: string;
  recommended_workflows: string[];
  deliverables: DeliverableSummary[];
};

function truncateText(input: string, max = 6000): string {
  const normalized = String(input ?? "");
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

export async function synthesizeBoardResponse(input: {
  workspaceId: string;
  prompt: string;
  interpretation: BoardInterpretationSpec;
  chairResults: ChairConsultResult[];
  sessionMode: "board" | "chair";
  timeoutMs?: number;
  /** Model to use for synthesis — overrides provider default. */
  model?: string;
  /** Worker deliverables to incorporate into the synthesis. Empty array = current behavior. */
  deliverables?: WorkerDeliverable[];
}): Promise<
  | { ok: true; payload: BoardSynthesisResult; raw: string }
  | { ok: false; error: string; detail: string }
> {
  const deliverables = input.deliverables ?? [];
  const hasDeliverables = deliverables.length > 0;
  const today = new Date().toISOString().split("T")[0];

  const systemLines = [
    "You are the commons-board synthesizer.",
    `Current date: ${today}.`,
    "Your job is to turn chair-specific downstream responses into one board-facing answer.",
    "Do not merely repeat every chair. Merge them into a useful executive response while preserving differences in viewpoint.",
    "Default to natural prose. Do not use repetitive headings unless the human explicitly asked for a memo, packet, or formal structure.",
    "Prefer concrete decisions, approvals, owners, and next steps over generic discussion.",
    "When referencing dates or timeframes, use the current date above as the baseline — never reference years before it.",
    `Session mode: ${input.sessionMode}`,
    `Interpretation spec: ${JSON.stringify(input.interpretation)}`
  ];

  if (hasDeliverables) {
    systemLines.push(
      "",
      "Worker deliverables are available. Incorporate them into your summary.",
      "If a worker produced a document, reference it. If a worker failed, note the gap.",
      "The operator should understand what was actually produced vs. what was only advised."
    );
  }

  const system = systemLines.join("\n\n");

  const userPromptParts = [
    `Latest prompt: ${truncateText(input.prompt, 1800)}`,
    `Chair results: ${JSON.stringify(input.chairResults).slice(0, 8000)}`,
  ];

  if (hasDeliverables) {
    const deliverableSummaries = deliverables.map((d) => {
      const output = d.status === "completed"
        ? truncateText(d.output, 4000)
        : `(status: ${d.status}${d.error ? `, error: ${d.error}` : ""})`;
      return `- Worker: ${d.worker_name} | Task: ${d.task_id} | Output type: ${d.output_type} | Status: ${d.status}\n  Output:\n${output}`;
    });
    userPromptParts.push(
      `Worker deliverables:\n${deliverableSummaries.join("\n\n")}`
    );
  }

  userPromptParts.push(
    "",
    "Return valid JSON only with keys: headline (string), summary_markdown (string), recommended_workflows (string[])."
  );

  const userPrompt = userPromptParts.join("\n\n");

  // Build deliverable summaries for the result (regardless of LLM success).
  const deliverableSummaries: DeliverableSummary[] = deliverables.map((d) => ({
    task_id: d.task_id,
    worker_name: d.worker_name,
    output_type: d.output_type,
    status: d.status,
    excerpt: d.status === "completed"
      ? truncateText(d.output, 500)
      : d.error ?? d.status,
    full_output_available: d.status === "completed" && d.output.length > 0,
  }));

  try {
    const result = await enqueueInference({
      callType: "board_synthesis",
      workspaceId: input.workspaceId,
      prompt: userPrompt,
      systemPrompt: system,
      model: input.model,
    });
    // Strip any chain-of-thought blocks so the JSON extraction regex matches
    // the actual JSON object, not content inside a thinking block.
    const raw = parseThinking(result.text).answer;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ok: false, error: "no_json", detail: "synthesizer returned no JSON object" };
    }
    const payload = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    let summaryMarkdown = String(payload.summary_markdown ?? "").trim() || "## Board synthesis\n- commons-board collected chair responses.";

    // Append a Worker Deliverables section to the final output.
    if (hasDeliverables) {
      summaryMarkdown = appendDeliverablesSection(summaryMarkdown, deliverables);
    }

    return {
      ok: true,
      raw,
      payload: {
        headline: String(payload.headline ?? "").trim() || "commons-board response",
        summary_markdown: summaryMarkdown,
        recommended_workflows: Array.isArray(payload.recommended_workflows)
          ? (payload.recommended_workflows as unknown[]).map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
          : [],
        deliverables: deliverableSummaries
      }
    };
  } catch (err) {
    // Any inference failure (no provider, rate limit, network error) falls back to template synthesis
    // so the board always returns chair results when available rather than a 502.
    const sections = input.chairResults.map((r) =>
      `${r.chair.name} (${r.chair.domain.toUpperCase()}): ${r.summary_markdown}`
    );
    const footer = err instanceof NoProviderConfiguredError
      ? "_Configure an AI inference provider in Settings to enable synthesized board responses._"
      : `_Board synthesis unavailable (${err instanceof Error ? err.message : "unknown error"}) — showing per-chair responses._`;

    let summaryMarkdown = [...sections, footer].join("\n\n");

    if (hasDeliverables) {
      summaryMarkdown = appendDeliverablesSection(summaryMarkdown, deliverables);
    }

    return {
      ok: true,
      raw: "",
      payload: {
        headline: "Board deliberation complete",
        summary_markdown: summaryMarkdown,
        recommended_workflows: [],
        deliverables: deliverableSummaries
      }
    };
  }
}

/**
 * Appends a "Worker Deliverables" section to the summary markdown, listing
 * each deliverable with its worker name, task, and output (or error).
 */
function appendDeliverablesSection(
  summaryMarkdown: string,
  deliverables: WorkerDeliverable[]
): string {
  const lines: string[] = ["", "---", "## Worker Deliverables", ""];

  for (const d of deliverables) {
    const statusLabel = d.status === "completed" ? "✅" : d.status === "failed" ? "❌" : "⏭️";
    lines.push(`### ${statusLabel} ${d.worker_name} — ${d.output_type}`);

    if (d.status === "completed") {
      lines.push("", truncateText(d.output, 4000));
    } else {
      lines.push("", `_${d.status}${d.error ? `: ${d.error}` : ""}_`);
    }
    lines.push("");
  }

  return `${summaryMarkdown}\n${lines.join("\n")}`;
}
