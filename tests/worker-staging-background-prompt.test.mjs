import test from "node:test";
import assert from "node:assert/strict";

import { buildBackgroundPrompt } from "../worker/staging/v3.2.0/src/background-prompt.js";

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
