/**
 * Board synthesizer — merges chair responses into a unified board-level answer.
 *
 * Ported from mother-board services/board-synthesizer.ts.
 * Sanitized:
 *   - "Mother-Board" → "commons-board"
 *   - resolveCliJsonObject() → model-client.ts completeText()
 *   - workspaceId required for model routing
 */
import { completeText, NoProviderConfiguredError } from "../lib/model-client.js";
import type { BoardDomain, BoardInterpretationSpec } from "@commons-board/shared";

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
}): Promise<
  | { ok: true; payload: BoardSynthesisResult; raw: string }
  | { ok: false; error: string; detail: string }
> {
  const today = new Date().toISOString().split("T")[0];
  const system = [
    "You are the commons-board synthesizer.",
    `Current date: ${today}.`,
    "Your job is to turn chair-specific downstream responses into one board-facing answer.",
    "Do not merely repeat every chair. Merge them into a useful executive response while preserving differences in viewpoint.",
    "Default to natural prose. Do not use repetitive headings unless the human explicitly asked for a memo, packet, or formal structure.",
    "Prefer concrete decisions, approvals, owners, and next steps over generic discussion.",
    "When referencing dates or timeframes, use the current date above as the baseline — never reference years before it.",
    `Session mode: ${input.sessionMode}`,
    `Interpretation spec: ${JSON.stringify(input.interpretation)}`
  ].join("\n\n");

  const userPrompt = [
    `Latest prompt: ${truncateText(input.prompt, 1800)}`,
    `Chair results: ${JSON.stringify(input.chairResults).slice(0, 8000)}`,
    "",
    "Return valid JSON only with keys: headline (string), summary_markdown (string), recommended_workflows (string[])."
  ].join("\n\n");

  try {
    const raw = await completeText(input.workspaceId, system, userPrompt, { model: input.model });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ok: false, error: "no_json", detail: "synthesizer returned no JSON object" };
    }
    const payload = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    return {
      ok: true,
      raw,
      payload: {
        headline: String(payload.headline ?? "").trim() || "commons-board response",
        summary_markdown: String(payload.summary_markdown ?? "").trim() || "## Board synthesis\n- commons-board collected chair responses.",
        recommended_workflows: Array.isArray(payload.recommended_workflows)
          ? (payload.recommended_workflows as unknown[]).map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
          : []
      }
    };
  } catch (err) {
    // Any inference failure (no provider, rate limit, network error) falls back to template synthesis
    // so the board always returns chair results when available rather than a 502.
    const sections = input.chairResults.map((r) =>
      `### ${r.chair.name} (${r.chair.domain.toUpperCase()})\n\n${r.summary_markdown}`
    );
    const footer = err instanceof NoProviderConfiguredError
      ? "_Configure an AI inference provider in Settings to enable synthesized board responses._"
      : `_Board synthesis unavailable (${err instanceof Error ? err.message : "unknown error"}) — showing per-chair responses._`;
    return {
      ok: true,
      raw: "",
      payload: {
        headline: "Board deliberation complete",
        summary_markdown: [
          "## Board Response\n",
          ...sections,
          "\n---",
          footer
        ].join("\n\n"),
        recommended_workflows: []
      }
    };
  }
}
