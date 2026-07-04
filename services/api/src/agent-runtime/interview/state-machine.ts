import { generateArtifacts } from "./generate-artifacts.js";
import {
  INTERVIEW_SECTIONS,
  type GovernanceModeValue,
  type InterviewAnswers,
  type InterviewSection,
  type InterviewSessionState
} from "./types.js";

/** Shallow per-section merge of a corrections patch onto a base set of answers. */
export function applyCorrections(
  base: InterviewAnswers,
  corrections: Partial<InterviewAnswers> | undefined
): InterviewAnswers {
  if (!corrections) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const [section, value] of Object.entries(corrections)) {
    const current = merged[section];
    if (current && typeof current === "object" && value && typeof value === "object") {
      merged[section] = { ...(current as Record<string, unknown>), ...(value as Record<string, unknown>) };
    } else {
      merged[section] = value;
    }
  }
  return merged as InterviewAnswers;
}

export class InterviewStateMachine {
  private sectionIndex = 0;
  private readonly completed = new Set<InterviewSection>();
  private readonly answers: InterviewAnswers = {};
  private finalized = false;
  private governanceMode: GovernanceModeValue | null = null;

  constructor(
    readonly sessionId: string,
    readonly orgId: string
  ) {}

  getState(): InterviewSessionState {
    return {
      session_id: this.sessionId,
      org_id: this.orgId,
      current_section: INTERVIEW_SECTIONS[this.sectionIndex],
      completed_sections: Array.from(this.completed),
      governance_mode: this.governanceMode,
      answers: this.answers,
      ready_to_finalize: this.completed.has("S9") && this.answers.S9?.confirmed === true
    };
  }

  submit(section: InterviewSection, payload: NonNullable<InterviewAnswers[InterviewSection]>): void {
    const expected = INTERVIEW_SECTIONS[this.sectionIndex];
    if (section !== expected) {
      throw new Error(`invalid section order: expected ${expected}, got ${section}`);
    }

    (this.answers as Record<InterviewSection, unknown>)[section] = payload;
    this.completed.add(section);

    if (section === "S0") {
      const gm = (payload as { governance_mode?: unknown }).governance_mode;
      if (gm === "business" || gm === "collective") {
        this.governanceMode = gm;
      }
    }

    this.advance();
  }

  skip(section: InterviewSection): void {
    const expected = INTERVIEW_SECTIONS[this.sectionIndex];
    if (section !== expected) {
      throw new Error(`invalid section order: expected ${expected}, got ${section}`);
    }

    (this.answers as Record<InterviewSection, unknown>)[section] = {};
    this.completed.add(section);
    this.advance();
  }

  private advance(): void {
    if (this.sectionIndex < INTERVIEW_SECTIONS.length - 1) {
      this.sectionIndex += 1;
    }

    // Auto-skip S8 (collective structure) when governance mode is business.
    if (INTERVIEW_SECTIONS[this.sectionIndex] === "S8" && this.governanceMode === "business") {
      this.answers.S8 = {};
      this.completed.add("S8");
      if (this.sectionIndex < INTERVIEW_SECTIONS.length - 1) {
        this.sectionIndex += 1;
      }
    }
  }

  restateAssumptions(): string {
    const mode = this.governanceMode ?? "business";
    const orgName = this.answers.S1?.org_name ?? "Your Organization";
    const autonomyMode = this.answers.S5?.autonomy_mode ?? "advisor";
    const execMode = this.answers.S5?.execution_mode ?? "sim";
    const timezone = this.answers.S6?.timezone ?? "America/Chicago";

    return [
      `Organization: ${orgName} (${mode} governance).`,
      `Autonomy mode: ${autonomyMode}; execution starts in ${execMode} mode.`,
      `Cadence timezone: ${timezone}.`,
      "HR agent and per-person analytics disabled by default.",
      "All actions logged to immutable decision log before execution."
    ].join(" ");
  }

  async finalize(): Promise<{ assumptions: string; artifacts: Awaited<ReturnType<typeof generateArtifacts>> }> {
    if (this.finalized) throw new Error("session already finalized");
    if (!this.completed.has("S9") || this.answers.S9?.confirmed !== true) {
      throw new Error("cannot finalize before S9 confirmation");
    }

    Object.assign(this.answers, applyCorrections(this.answers, this.answers.S9?.corrections));
    const artifacts = await generateArtifacts(this.answers, this.orgId);
    this.finalized = true;

    return { assumptions: this.restateAssumptions(), artifacts };
  }
}
