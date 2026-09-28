import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildBackgroundPrompt, buildNegativePrompt } from "../worker/staging/v3.2.0/src/background-prompt.js";

const release = fs.readFileSync("worker/releases/v3.2.3/worker.js", "utf8");
const staged = fs.readFileSync("worker/staging/v3.2.0/src/background-prompt.js", "utf8");
const FIRST = "// Used only for security/geopolitics";

function inlinedBlock() {
  const start = release.indexOf(FIRST);
  const end = release.indexOf("// END background-prompt");
  assert.ok(start > 0 && end > start, "release must contain the background-prompt block");
  return release.slice(start, end);
}

test("v3.2.3 reports its version", () => {
  assert.match(release, /const VERSION = "3\.2\.3";/);
});

test("the inlined prompt builder matches the staged, tested module", () => {
  const stagedBody = staged.slice(staged.indexOf(FIRST)).replace(/export function/g, "function");
  assert.equal(inlinedBlock().trimEnd(), stagedBody.trimEnd());
});

test("generateBackground uses both builders and hard-codes no Arctic look", () => {
  const generate = release.slice(
    release.indexOf("async function generateBackground("),
    release.indexOf("function buildCardHtml(")
  );
  assert.match(generate, /buildBackgroundPrompt\(story\)/);
  assert.match(generate, /negative_prompt:\s*buildNegativePrompt\(story\)/);
  assert.doesNotMatch(generate, /Arctic/);
});

test("the inlined builders match the module for real queue briefs", () => {
  const [prompt, negative] = new Function(
    `${inlinedBlock()}; return [buildBackgroundPrompt, buildNegativePrompt];`
  )();
  for (const file of fs.readdirSync("queue").filter((name) => name.endsWith(".json"))) {
    const story = JSON.parse(fs.readFileSync(`queue/${file}`, "utf8"));
    assert.equal(prompt(story), buildBackgroundPrompt(story), file);
    assert.equal(negative(story), buildNegativePrompt(story), file);
  }
});

test("only the prompt builders, negative prompt and VERSION differ from v3.2.2", () => {
  const previous = fs.readFileSync("worker/releases/v3.2.2/worker.js", "utf8");
  const outside = (source) =>
    source
      .slice(0, source.indexOf("// BEGIN background-prompt"))
      .replace(/const VERSION = "[^"]+";/, "") +
    source
      .slice(source.indexOf("// END background-prompt"))
      .replace(/negative_prompt:[\s\S]*?width: 1080/, "");
  assert.equal(outside(release), outside(previous));
});
