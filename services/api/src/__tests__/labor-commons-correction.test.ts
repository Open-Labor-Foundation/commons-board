import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proposeSpecCorrection } from "../lib/labor-commons-correction.js";

const execFileAsync = promisify(execFile);
async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

const FIXTURE_SPEC = `schema_version: '1.0'
kind: agent_definition
metadata:
  agent_id: test-specialist-v1
  slug: test-specialist
  name: Test specialist
  specialty_boundary: 'Owns test work.

    '
  status: validated
purpose:
  summary: A specialist that exists only for this test.
`;

/**
 * Hermetic: no real GitHub involved. A local bare repo stands in for
 * labor-commons' remote (CB_LABOR_COMMONS_REMOTE_URL), and a local HTTP
 * server stands in for the GitHub API (CB_LABOR_COMMONS_GH_API_BASE) --
 * both overrides exist specifically so this doesn't have to touch real
 * infrastructure to prove the mechanism works.
 */
describe("proposeSpecCorrection", () => {
  let tempRoot: string;
  let bareRepoPath: string;
  let localCheckoutPath: string;
  let server: Server;
  let apiBaseUrl: string;
  let lastPrRequestBody: Record<string, unknown> | null;

  beforeEach(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "lc-correction-test-"));
    bareRepoPath = join(tempRoot, "labor-commons-bare.git");
    localCheckoutPath = join(tempRoot, "labor-commons-checkout");

    await execFileAsync("git", ["init", "--bare", "-b", "main", bareRepoPath]);

    mkdirSync(localCheckoutPath, { recursive: true });
    await git(["init", "-b", "main"], localCheckoutPath);
    await git(["remote", "add", "origin", bareRepoPath], localCheckoutPath);

    const specDir = join(localCheckoutPath, "catalog", "naics-overlays", "test-industry", "test-specialist");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "spec.yaml"), FIXTURE_SPEC, "utf8");

    await git(["add", "."], localCheckoutPath);
    await git(["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "seed"], localCheckoutPath);
    await git(["push", "origin", "main"], localCheckoutPath);

    lastPrRequestBody = null;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        lastPrRequestBody = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ html_url: "https://github.com/Open-Labor-Foundation/labor-commons/pull/999" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a network address");
    apiBaseUrl = `http://127.0.0.1:${address.port}`;

    process.env.CB_LABOR_COMMONS_PATH = localCheckoutPath;
    process.env.CB_LABOR_COMMONS_GH_TOKEN = "test-token";
    process.env.CB_LABOR_COMMONS_REMOTE_URL = bareRepoPath;
    process.env.CB_LABOR_COMMONS_GH_API_BASE = apiBaseUrl;
  });

  afterEach(async () => {
    delete process.env.CB_LABOR_COMMONS_PATH;
    delete process.env.CB_LABOR_COMMONS_GH_TOKEN;
    delete process.env.CB_LABOR_COMMONS_REMOTE_URL;
    delete process.env.CB_LABOR_COMMONS_GH_API_BASE;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("returns null when not configured", async () => {
    delete process.env.CB_LABOR_COMMONS_PATH;
    const result = await proposeSpecCorrection({
      sectionSlug: "test-industry",
      agentSlug: "test-specialist",
      fieldPath: ["purpose", "summary"],
      proposedValue: "x",
      justification: "x",
      submittedBy: "user-1"
    });
    assert.equal(result, null);
  });

  test("opens a real branch on the remote with the field correctly changed, rest of the file untouched", async () => {
    const result = await proposeSpecCorrection({
      sectionSlug: "test-industry",
      agentSlug: "test-specialist",
      fieldPath: ["purpose", "summary"],
      proposedValue: "An updated, more accurate summary from a real practitioner.",
      justification: "The old summary didn't mention the tax-filing deadline exception.",
      submittedBy: "user-42"
    });

    assert.ok(result);
    assert.equal(result!.prUrl, "https://github.com/Open-Labor-Foundation/labor-commons/pull/999");
    assert.match(result!.branch, /^correction\/test-specialist-/);

    // Prove the pushed branch really exists on the "remote" with the real change.
    const pushedContent = await git(["show", `${result!.branch}:catalog/naics-overlays/test-industry/test-specialist/spec.yaml`], bareRepoPath);
    assert.match(pushedContent, /An updated, more accurate summary from a real practitioner\./);
    assert.match(pushedContent, /agent_id: test-specialist-v1/, "rest of the document must be preserved");
    assert.match(pushedContent, /specialty_boundary:/, "unrelated fields must be preserved");

    // Prove the PR request carried the right content.
    assert.equal((lastPrRequestBody as { head?: string })?.head, result!.branch);
    assert.equal((lastPrRequestBody as { base?: string })?.base, "main");
    assert.match((lastPrRequestBody as { body?: string })?.body ?? "", /user-42/);
    assert.match((lastPrRequestBody as { body?: string })?.body ?? "", /tax-filing deadline exception/);
  });

  test("does not disturb the shared local checkout's own branch", async () => {
    const branchBefore = await git(["rev-parse", "--abbrev-ref", "HEAD"], localCheckoutPath);
    await proposeSpecCorrection({
      sectionSlug: "test-industry",
      agentSlug: "test-specialist",
      fieldPath: ["purpose", "summary"],
      proposedValue: "changed",
      justification: "test",
      submittedBy: "user-1"
    });
    const branchAfter = await git(["rev-parse", "--abbrev-ref", "HEAD"], localCheckoutPath);
    assert.equal(branchBefore, branchAfter, "the shared checkout other requests read from must stay on its original branch");

    const worktrees = await git(["worktree", "list"], localCheckoutPath);
    assert.equal(worktrees.split("\n").length, 1, "the ephemeral worktree must be cleaned up");
  });

  test("returns null for a field path that doesn't exist, without pushing anything", async () => {
    const result = await proposeSpecCorrection({
      sectionSlug: "test-industry",
      agentSlug: "test-specialist",
      fieldPath: ["metadata", "not_a_real_field"],
      proposedValue: "x",
      justification: "x",
      submittedBy: "user-1"
    });
    assert.equal(result, null);
    assert.equal(lastPrRequestBody, null);
  });

  test("returns null for a specialist that doesn't exist", async () => {
    const result = await proposeSpecCorrection({
      sectionSlug: "test-industry",
      agentSlug: "does-not-exist",
      fieldPath: ["purpose", "summary"],
      proposedValue: "x",
      justification: "x",
      submittedBy: "user-1"
    });
    assert.equal(result, null);
  });
});
