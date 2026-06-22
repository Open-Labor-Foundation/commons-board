import { generateLaunchArtifacts, validateLaunchArtifacts } from "./generate-artifacts.js";
import { LAUNCH_SECTIONS, type LaunchAnswers, type LaunchSection, type LaunchSessionState } from "./types.js";

export class LaunchInterviewStateMachine {
  private sectionIndex = 0;
  private readonly completed = new Set<LaunchSection>();
  private readonly answers: LaunchAnswers = {};
  private finalized = false;

  getState(): LaunchSessionState {
    return {
      currentSection: LAUNCH_SECTIONS[this.sectionIndex],
      completedSections: Array.from(this.completed),
      answers: this.answers,
      readyToFinalize: this.completed.has("L7") && this.answers.L7?.confirmed === true
    };
  }

  submit(section: LaunchSection, payload: NonNullable<LaunchAnswers[LaunchSection]>): void {
    const expected = LAUNCH_SECTIONS[this.sectionIndex];

    if (section !== expected) {
      throw new Error(`invalid section order: expected ${expected}, got ${section}`);
    }

    (this.answers as Record<LaunchSection, unknown>)[section] = payload;
    this.completed.add(section);

    if (this.sectionIndex < LAUNCH_SECTIONS.length - 1) {
      this.sectionIndex += 1;
    }
  }

  skip(section: LaunchSection): void {
    const expected = LAUNCH_SECTIONS[this.sectionIndex];

    if (section !== expected) {
      throw new Error(`invalid section order: expected ${expected}, got ${section}`);
    }

    (this.answers as Record<LaunchSection, unknown>)[section] = {};
    this.completed.add(section);

    if (this.sectionIndex < LAUNCH_SECTIONS.length - 1) {
      this.sectionIndex += 1;
    }
  }

  restateAssumptions(): string {
    const market = this.answers.L2?.industries_of_interest?.[0] ?? "services";
    const problem = this.answers.L2?.problems_to_solve?.[0] ?? "operational inefficiency";
    const offer = this.answers.L3?.offer ?? "operational acceleration package";
    const perTransactionCap = this.answers.L6?.per_transaction_cap ?? 0;

    return [
      `Chosen market/problem inferred: ${market} / ${problem}.`,
      `Offer hypothesis inferred: ${offer}.`,
      `Financial per-transaction cap: ${perTransactionCap}.`,
      "No money movement without approval is treated as default safety constraint."
    ].join(" ");
  }

  finalize() {
    if (this.finalized) {
      throw new Error("session already finalized");
    }

    if (!this.completed.has("L7") || this.answers.L7?.confirmed !== true) {
      throw new Error("cannot finalize before L7 confirmation");
    }

    const corrections = this.answers.L7?.corrections;

    if (corrections) {
      for (const [section, value] of Object.entries(corrections) as Array<[LaunchSection, unknown]>) {
        const current = (this.answers as Record<string, unknown>)[section] as Record<string, unknown> | undefined;
        if (current && typeof current === "object" && value && typeof value === "object") {
          (this.answers as Record<string, unknown>)[section] = { ...current, ...(value as Record<string, unknown>) };
        } else {
          (this.answers as Record<string, unknown>)[section] = value;
        }
      }
    }

    const artifacts = generateLaunchArtifacts(this.answers);
    const validation = validateLaunchArtifacts(artifacts);

    if (!validation.ok) {
      throw new Error(`launch artifact validation failed: ${validation.errors.join(", ")}`);
    }

    this.finalized = true;

    return {
      assumptions: this.restateAssumptions(),
      artifacts
    };
  }
}
