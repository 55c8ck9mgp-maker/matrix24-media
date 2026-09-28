import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildBackgroundPrompt } from "../worker/staging/v3.2.0/src/background-prompt.js";

const release = fs.readFileSync("worker/releases/v3.2.2/worker.js", "utf8");
const staged = fs.readFileSync("worker/staging/v3.2.0/src/background-prompt.js", "utf8");

function inlinedBlock() {
  const start = release.indexOf("const GEOPOLITICAL_FALLBACK");
  const end = release.indexOf("// END background-prompt");
  assert.ok(start > 0 && end > start, "release must contain the background-prompt block");
  return release.slice(start, end);
}

test("v3.2.2 reports its version", () => {
  assert.match(release, /const VERSION = "3\.2\.2";/);
});

test("the inlined prompt builder matches the staged, tested module", () => {
  const stagedBody = staged
    .slice(staged.indexOf("const GEOPOLITICAL_FALLBACK"))
    .replace(/export function/g, "function");
  assert.equal(inlinedBlock().trimEnd(), stagedBody.trimEnd());
});

test("generateBackground uses the builder and no longer forces the Arctic look", () => {
  const generate = release.slice(
    release.indexOf("async function generateBackground("),
    release.indexOf("function buildCardHtml(")
  );
  assert.match(generate, /buildBackgroundPrompt\(story\)/);
  assert.doesNotMatch(generate, /Arctic/);
});

test("the inlined builder produces the same prompt as the module for real queue briefs", () => {
  const inlined = new Function(`${inlinedBlock()}; return buildBackgroundPrompt;`)();
  for (const file of fs.readdirSync("queue").filter((name) => name.endsWith(".json"))) {
    const story = JSON.parse(fs.readFileSync(`queue/${file}`, "utf8"));
    assert.equal(inlined(story), buildBackgroundPrompt(story), file);
  }
});
