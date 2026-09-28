import test from "node:test";
import assert from "node:assert/strict";

import { buildBackgroundPrompt, cleanVisualBrief } from "../worker/staging/v3.2.0/src/background-prompt.js";

test("uses the editorial visual brief when present, non-geopolitical category", () => {
  const prompt = buildBackgroundPrompt({
    headline: "Heavy rain floods Uttar Pradesh",
    category: "World",
    image_generation_prompt:
      "AI-generated non-documentary illustration of monsoon flooding, vertical 4:5."
  });

  assert.match(prompt, /monsoon flooding/);
  assert.doesNotMatch(prompt, /Arctic/i);
});

test("uses the editorial visual brief when present, even for geopolitical category", () => {
  const prompt = buildBackgroundPrompt({
    headline: "Ceasefire talks resume",
    category: "Security / Geopolitics",
    image_generation_prompt: "Abstract negotiation table under warm light, no flags."
  });

  assert.match(prompt, /negotiation table/);
  assert.doesNotMatch(
    prompt,
    /Arctic/i,
    "a specific brief must not be overridden by the generic Arctic fallback"
  );
});

test("falls back to the generic Arctic aesthetic only for geopolitical stories with no brief", () => {
  const prompt = buildBackgroundPrompt({
    headline: "Regional tensions rise",
    category: "Security / Geopolitics",
    image_generation_prompt: ""
  });

  assert.match(prompt, /Arctic/i);
});

test("non-geopolitical stories with no brief get no Arctic fallback", () => {
  const prompt = buildBackgroundPrompt({
    headline: "New economic data released",
    category: "Economy"
  });

  assert.doesNotMatch(prompt, /Arctic/i);
});

test("missing headline/category still produce a usable prompt", () => {
  const prompt = buildBackgroundPrompt({});
  assert.match(prompt, /Global news update/);
  assert.match(prompt, /World News/);
});

const KYIV_BRIEF =
  "Original MATRIX 24 4:5 editorial infographic about Russian drone strikes on Kyiv on Sept. 23, 2026. " +
  "Neutral factual treatment. Use a stylized map of Kyiv and Ukraine, abstract drone-route markers, " +
  "rail and fuel infrastructure symbols, and restrained emergency-response motifs. Do not depict " +
  "fabricated casualties, combat scenes or people as documentary imagery. Headline: DRONE STRIKES HIT " +
  "KYIV. Subhead: At least two killed as infrastructure is struck. Sources: Reuters / AP. Clearly label " +
  "AI-GENERATED EDITORIAL VISUAL — NOT DOCUMENTARY PHOTO.";

test("drops brief clauses that ask for text, maps, labels or sources", () => {
  const brief = cleanVisualBrief(KYIV_BRIEF);

  assert.match(brief, /drone-route markers/);
  assert.match(brief, /Sept\. 23, 2026/, "an abbreviation must not end the sentence");
  for (const banned of [/map/i, /Headline/, /Subhead/, /Sources/, /label/i, /MATRIX 24/, /4:5/, /infographic/i]) {
    assert.doesNotMatch(brief, banned);
  }
});

test("caps a long brief on a clause boundary and keeps the scene description", () => {
  const brief = cleanVisualBrief(
    "AI-generated editorial illustration, not documentary photography. " +
      "A rain-soaked Bangkok urban streetscape with anonymous vehicles moving through shallow floodwater, " +
      "recognizable tropical city atmosphere without copying a real photograph, dramatic monsoon clouds, " +
      "restrained professional global-news aesthetic, vertical composition, no fake documentary scene, " +
      "no identifiable people, no recognizable brands."
  );

  assert.ok(brief.length <= 320, `brief is ${brief.length} chars`);
  assert.match(brief, /Bangkok urban streetscape/);
  assert.match(brief, /\.$/);
});

test("non-string briefs clean to empty", () => {
  assert.equal(cleanVisualBrief(undefined), "");
  assert.equal(cleanVisualBrief(42), "");
});

test("the no-text instruction comes before the brief in the prompt", () => {
  const prompt = buildBackgroundPrompt({
    headline: "Drone strikes hit Kyiv",
    category: "World / Europe",
    image_generation_prompt: KYIV_BRIEF
  });

  assert.ok(prompt.indexOf("no text or lettering") < prompt.indexOf("Specific visual brief"));
  assert.doesNotMatch(prompt, /Arctic/i);
});

test("a brief made only of text requests falls back like a missing brief", () => {
  const prompt = buildBackgroundPrompt({
    headline: "Regional tensions rise",
    category: "Security / Geopolitics",
    image_generation_prompt: "Headline: TENSIONS RISE. Sources: Reuters."
  });

  assert.doesNotMatch(prompt, /Specific visual brief/);
  assert.match(prompt, /Arctic/i);
});
