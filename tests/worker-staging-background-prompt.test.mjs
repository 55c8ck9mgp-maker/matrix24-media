import test from "node:test";
import assert from "node:assert/strict";

import { buildBackgroundPrompt, buildNegativePrompt, cleanVisualBrief } from "../worker/staging/v3.2.0/src/background-prompt.js";

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

test("geopolitical stories with no brief get a neutral fallback scene, not ice", () => {
  const prompt = buildBackgroundPrompt({
    headline: "Regional tensions rise",
    category: "Security / Geopolitics",
    image_generation_prompt: ""
  });

  assert.match(prompt, /world-affairs scene/);
  assert.doesNotMatch(prompt, /Arctic|\bice\b|glacier/i);
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
  assert.match(prompt, /no text/);
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

  assert.ok(prompt.indexOf("no text") < prompt.indexOf("drone-route markers"));
  assert.doesNotMatch(prompt, /Arctic/i);
});

test("a brief made only of text requests falls back like a missing brief", () => {
  const prompt = buildBackgroundPrompt({
    headline: "Regional tensions rise",
    category: "Security / Geopolitics",
    image_generation_prompt: "Headline: TENSIONS RISE. Sources: Reuters."
  });

  assert.doesNotMatch(prompt, /TENSIONS|Reuters/);
  assert.match(prompt, /world-affairs scene/);
});

const JAVELIN_BRIEF =
  "AI-generated non-documentary editorial illustration of an outdoor athletics stadium javelin throw " +
  "competition, a stylized generic athlete mid-throw silhouette with no identifiable facial likeness, a neutral " +
  "scoreboard element, evening stadium lights, restrained professional sports-newsroom aesthetic, no real team " +
  "logos or flags with symbols, no fabricated documentary details, vertical 4:5 composition. Include a small " +
  "clear label: AI-GENERATED EDITORIAL VISUAL.";

test("the scene comes first and the prompt stays short enough for SDXL's encoder", () => {
  const prompt = buildBackgroundPrompt({
    headline: "Sri Lanka's Pathirage wins Asian Games javelin gold; India takes silver and bronze",
    category: "Sports",
    image_generation_prompt: JAVELIN_BRIEF
  });

  assert.match(prompt, /^Editorial background, no text\. An outdoor athletics stadium javelin/);
  assert.ok(prompt.length <= 420, `prompt is ${prompt.length} chars`);
  assert.doesNotMatch(prompt, /blue|cinematic|abstract|Arctic/i, "no style rule may push a cold palette");
});

test("negating clauses and provenance boilerplate are dropped from the brief", () => {
  const brief = cleanVisualBrief(JAVELIN_BRIEF);

  assert.match(brief, /evening stadium lights/);
  for (const banned of [/\bno\b/i, /AI-generated/i, /non-documentary/i, /scoreboard/, /flags/, /label/i]) {
    assert.doesNotMatch(brief, banned);
  }
});

test("the negative prompt excludes ice unless the story is about cold places", () => {
  const sports = buildNegativePrompt({ headline: "Javelin gold", image_generation_prompt: JAVELIN_BRIEF });
  assert.match(sports, /\bice\b/);
  assert.match(sports, /\btext\b/);

  const arctic = buildNegativePrompt({ headline: "Arctic security deal signed" });
  assert.doesNotMatch(arctic, /\bice\b|glacier/);
  assert.match(arctic, /\btext\b/);
});
