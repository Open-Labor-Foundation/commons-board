import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { CodingRequest, CodingResult } from "./contracts.js";

async function safeWriteFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function safeAppendFile(filePath: string, appendContent: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  let current = "";
  try {
    current = await readFile(filePath, "utf8");
  } catch {
    current = "";
  }
  const spacer = current.endsWith("\n") || current.length === 0 ? "" : "\n";
  await writeFile(filePath, `${current}${spacer}${appendContent}`, "utf8");
}

export class AICodingAgent {
  async apply(input: CodingRequest): Promise<CodingResult> {
    const changedFiles: string[] = [];
    const metadata = input.task.metadata ?? {};

    const writeFileSpec =
      typeof metadata["write_file"] === "object" && metadata["write_file"]
        ? (metadata["write_file"] as { path?: unknown; content?: unknown })
        : null;
    if (writeFileSpec && typeof writeFileSpec.path === "string") {
      const target = join(input.workspace_path, writeFileSpec.path);
      await safeWriteFile(target, String(writeFileSpec.content ?? ""));
      changedFiles.push(writeFileSpec.path);
    }

    const appendFileSpec =
      typeof metadata["append_file"] === "object" && metadata["append_file"]
        ? (metadata["append_file"] as { path?: unknown; content?: unknown })
        : null;
    if (appendFileSpec && typeof appendFileSpec.path === "string") {
      const target = join(input.workspace_path, appendFileSpec.path);
      await safeAppendFile(target, String(appendFileSpec.content ?? ""));
      changedFiles.push(appendFileSpec.path);
    }

    if (changedFiles.length === 0) {
      const generatedPath = join(".ai", "generated", `${input.task.id}.md`);
      const target = join(input.workspace_path, generatedPath);
      const content = [
        `# Auto-generated change summary for ${input.task.id}`,
        ``,
        `Task: ${input.task.title}`,
        ``,
        `Plan summary: ${input.plan.summary}`,
        ``,
        `Repair mode: ${input.repair_context.enabled ? "yes" : "no"}`
      ].join("\n");
      await safeWriteFile(target, content);
      changedFiles.push(generatedPath);
    }

    return {
      status: "success",
      changed_files: changedFiles,
      summary: `Applied ${changedFiles.length} file changes for ${input.task.id}`,
      notes: input.repair_context.enabled
        ? [
            `repair_context_failures=${input.repair_context.test_failures.length}`,
            `repair_context_comments=${(input.repair_context.review_comments ?? []).length}`
          ]
        : ["initial implementation pass"]
    };
  }
}
