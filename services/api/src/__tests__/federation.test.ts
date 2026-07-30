import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { stripTrailingSlashes } from "../routes/federation.js";

describe("stripTrailingSlashes", () => {
  test("strips a single trailing slash", () => {
    assert.equal(stripTrailingSlashes("https://example.com/board/"), "https://example.com/board");
  });

  test("strips many repeated trailing slashes", () => {
    assert.equal(stripTrailingSlashes("https://example.com/board////"), "https://example.com/board");
  });

  test("leaves a URL with no trailing slash unchanged", () => {
    assert.equal(stripTrailingSlashes("https://example.com/board"), "https://example.com/board");
  });

  test("does not touch slashes that aren't at the end", () => {
    assert.equal(stripTrailingSlashes("https://example.com//board//x"), "https://example.com//board//x");
  });

  test("handles an all-slashes string", () => {
    assert.equal(stripTrailingSlashes("////"), "");
  });

  // Regression test for the fix: the previous /\/+$/ regex was flagged by
  // CodeQL as js/polynomial-redos -- a crafted string with a long run of '/'
  // not at the true end forces the engine to retry the match at every
  // position within that run, each attempt backtracking through the whole
  // run, making it O(n^2). This adversarial input is exactly that shape;
  // the non-regex replacement must stay linear regardless.
  test("stays fast on adversarial input (ReDoS regression)", () => {
    const attack = "a" + "/".repeat(200_000) + "b";
    const start = Date.now();
    const result = stripTrailingSlashes(attack);
    const elapsedMs = Date.now() - start;
    assert.equal(result, attack); // no trailing slash -- 'b' is last char, unchanged
    assert.ok(elapsedMs < 1000, `expected near-instant completion, took ${elapsedMs}ms`);
  });
});
