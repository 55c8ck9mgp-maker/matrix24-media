import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";


const release = fs.readFileSync("worker/releases/v3.2.2/worker.js", "utf8");

// The staged builder now tracks v3.2.3; tests/worker-release-v3.2.3.test.mjs
// checks it against that release. v3.2.2 stays as the rollback target.

test("v3.2.2 reports its version", () => {
  assert.match(release, /const VERSION = "3\.2\.2";/);
});

test("generateBackground uses the builder and no longer forces the Arctic look", () => {
  const generate = release.slice(
    release.indexOf("async function generateBackground("),
    release.indexOf("function buildCardHtml(")
  );
  assert.match(generate, /buildBackgroundPrompt\(story\)/);
  assert.doesNotMatch(generate, /Arctic/);
});
