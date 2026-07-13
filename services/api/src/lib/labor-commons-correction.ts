/**
 * Practitioner corrections into labor-commons: labor-commons currently
 * only grows one way -- AI inference against the NAICS backlog. This is
 * the other intended growth path (corrections and additions from actual
 * practitioners in a given profession) that ARCHITECTURE.md names as
 * having no working mechanism.
 *
 * A correction becomes a real PR against labor-commons, reviewed by a
 * human -- it does not merge itself. GOVERNANCE.md's model (an
 * independent certification gate, independent review) applies to it the
 * same as any other change to the catalog; this module's only job is
 * getting a practitioner's proposed edit into that review queue correctly
 * attributed and well-justified, nothing more.
 *
 * Deliberately does NOT reuse CB_LABOR_COMMONS_PATH's checkout for the
 * git operations below. That path is read concurrently by every other
 * request this service serves (getSpecialist, searchBySections, etc. all
 * read spec.yaml directly off disk at whatever's currently checked out);
 * checking out a correction branch there, even briefly, would make every
 * concurrent read see the wrong content, and two correction requests
 * would stomp on each other's branches. Each correction gets its own
 * ephemeral `git worktree`, isolated by construction, cleaned up whether
 * it succeeds or fails.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { parseDocument } from "yaml";
import { specYamlPath, catalogPathFor } from "./labor-commons-client.js";

const execFileAsync = promisify(execFile);

// catalogPathFor's slugs are already validated by labor-commons-client.ts
// (throws on anything but a real catalog-slug shape), but that guarantee
// isn't visible from this file's own join() call in isolation -- this is
// the same resolve-and-check-prefix pattern applied a second time, at the
// actual sink, so this file's own path safety doesn't depend on trusting
// what a different module did earlier.
function assertWithinWorktree(worktreeDir: string, candidate: string): string {
  const worktreeRoot = resolve(worktreeDir) + sep;
  const resolved = resolve(candidate);
  if (!resolved.startsWith(worktreeRoot)) {
    throw new Error("Resolved correction path escapes the ephemeral worktree -- rejected.");
  }
  return candidate;
}

export interface SpecCorrectionInput {
  sectionSlug: string;
  agentSlug: string;
  /** Dot-path into the spec, e.g. ["metadata", "specialty_boundary"]. */
  fieldPath: string[];
  proposedValue: string;
  justification: string;
  /** commons-board user id of the practitioner proposing this -- recorded in the PR body, not the git author (stays olf-steward[bot], same as every other automated OLF commit). */
  submittedBy: string;
}

export interface SpecCorrectionResult {
  prUrl: string;
  branch: string;
}

const BOT_NAME = "olf-steward[bot]";
const BOT_EMAIL = "299857430+olf-steward[bot]@users.noreply.github.com";

async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, { cwd, env: process.env });
  return stdout.trim();
}

export async function proposeSpecCorrection(input: SpecCorrectionInput): Promise<SpecCorrectionResult | null> {
  const lcPath = process.env.CB_LABOR_COMMONS_PATH;
  const ghToken = process.env.CB_LABOR_COMMONS_GH_TOKEN;
  if (!lcPath || !ghToken) return null;

  // Overridable so tests can point the push and the PR-creation call at a
  // local bare repo / local HTTP server instead of real GitHub -- not
  // meant to be set in a real deployment, where the defaults are correct.
  const remoteUrl = process.env.CB_LABOR_COMMONS_REMOTE_URL
    ?? `https://x-access-token:${ghToken}@github.com/Open-Labor-Foundation/labor-commons.git`;
  const ghApiBase = process.env.CB_LABOR_COMMONS_GH_API_BASE ?? "https://api.github.com";

  const specPath = specYamlPath(input.sectionSlug, input.agentSlug);
  if (!existsSync(specPath)) return null;

  const worktreeDir = mkdtempSync(join(tmpdir(), "lc-correction-"));
  const branch = `correction/${input.agentSlug}-${randomUUID().slice(0, 8)}`;

  try {
    await run("git", ["fetch", "origin", "main"], lcPath);
    await run("git", ["worktree", "add", worktreeDir, "-b", branch, "origin/main"], lcPath);

    const worktreeSpecPath = assertWithinWorktree(worktreeDir, join(worktreeDir, catalogPathFor(input.sectionSlug, input.agentSlug)));
    if (!existsSync(worktreeSpecPath)) return null;

    const raw = readFileSync(worktreeSpecPath, "utf8");
    const doc = parseDocument(raw);
    const currentValue = doc.getIn(input.fieldPath);
    if (currentValue === undefined) {
      console.error(`[labor-commons-correction] field path ${input.fieldPath.join(".")} does not exist in ${specPath}`);
      return null;
    }
    doc.setIn(input.fieldPath, input.proposedValue);
    writeFileSync(worktreeSpecPath, String(doc), "utf8");

    const relativePath = catalogPathFor(input.sectionSlug, input.agentSlug);
    await run("git", ["add", relativePath], worktreeDir);

    const commitMessage = [
      `Practitioner correction: ${input.agentSlug} ${input.fieldPath.join(".")}`,
      "",
      input.justification,
      "",
      `Submitted via commons-board by ${input.submittedBy}.`
    ].join("\n");
    await run(
      "git",
      ["-c", `user.name=${BOT_NAME}`, "-c", `user.email=${BOT_EMAIL}`, "commit", "-m", commitMessage],
      worktreeDir
    );

    await run("git", ["push", remoteUrl, `HEAD:${branch}`], worktreeDir);

    const prBody = [
      `**Submitted by:** ${input.submittedBy} (via commons-board's practitioner-correction path)`,
      "",
      `**Field:** \`${input.fieldPath.join(".")}\``,
      "",
      "**Justification:**",
      input.justification,
      "",
      "**Previous value:**",
      "```",
      String(currentValue),
      "```",
      "",
      "**Proposed value:**",
      "```",
      input.proposedValue,
      "```",
      "",
      "This PR must pass labor-commons-curator's certification gate and independent review before merging -- see [open-labor-foundation/GOVERNANCE.md](https://github.com/Open-Labor-Foundation/open-labor-foundation/blob/main/GOVERNANCE.md)."
    ].join("\n");

    const prResp = await fetch(`${ghApiBase}/repos/Open-Labor-Foundation/labor-commons/pulls`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ghToken}`,
        "content-type": "application/json",
        accept: "application/vnd.github+json"
      },
      body: JSON.stringify({
        title: `Practitioner correction: ${input.agentSlug} ${input.fieldPath.join(".")}`,
        head: branch,
        base: "main",
        body: prBody
      })
    });
    if (!prResp.ok) {
      console.error(`[labor-commons-correction] PR creation failed (${prResp.status}) for ${input.agentSlug}`);
      return null;
    }
    const pr = (await prResp.json()) as { html_url?: string };
    if (!pr.html_url) return null;

    return { prUrl: pr.html_url, branch };
  } catch (err) {
    console.error(`[labor-commons-correction] errored for ${input.agentSlug}:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    try {
      await run("git", ["worktree", "remove", worktreeDir, "--force"], lcPath);
    } catch {
      rmSync(worktreeDir, { recursive: true, force: true });
    }
  }
}
