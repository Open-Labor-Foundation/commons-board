import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { StateStore, TaskRun } from "./contracts.js";

export class LocalStateStore implements StateStore {
  constructor(private readonly repoPath: string) {}

  async updateRun(run: TaskRun): Promise<void> {
    const runDir = join(this.repoPath, ".ai", "runs", run.run_id);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "state.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  }
}
