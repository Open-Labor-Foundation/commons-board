import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDataDir, removeTestDataDir } from "./helpers.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";

describe("persistence", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestDataDir();
  });

  afterEach(() => {
    removeTestDataDir(dir);
  });

  test("readJson returns fallback when file does not exist", () => {
    const val = readJson("no-such-key", { default: true });
    assert.deepEqual(val, { default: true });
  });

  test("writeJsonAtomic + readJson roundtrip", () => {
    const payload = { items: [1, 2, 3], name: "test" };
    writeJsonAtomic("my-key/default", payload);
    const result = readJson<typeof payload>("my-key/default", {} as typeof payload);
    assert.deepEqual(result, payload);
  });

  test("writeJsonAtomic overwrites previous value", () => {
    writeJsonAtomic("counter/default", { count: 1 });
    writeJsonAtomic("counter/default", { count: 2 });
    const result = readJson<{ count: number }>("counter/default", { count: 0 });
    assert.equal(result.count, 2);
  });

  test("readJson returns fallback on malformed JSON", async () => {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    writeFileSync(join(dir, "bad.json"), "not-json", "utf8");
    const result = readJson<string>("bad", "fallback");
    assert.equal(result, "fallback");
  });

  test("writeJsonAtomic handles nested key paths", () => {
    writeJsonAtomic("level4-actions/workspace-1", [{ id: "a1" }]);
    const result = readJson<Array<{ id: string }>>("level4-actions/workspace-1", []);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "a1");
  });
});
