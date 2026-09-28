// Pure, side-effect-free prompt builder for the media background image.
//
// Fixes a known debt (see docs/reliability audit history): production's
// generateBackground() reads story.image_generation_prompt into a local
// `visualBrief` variable but never actually includes it in the prompt sent
// to Workers AI, and forces a fixed "Arctic landscape" aesthetic onto every
// geopolitical-category story regardless of what the editorial draft asked
// for. This module is the corrected version, as a pure function so it can
// be unit tested without touching env.AI or any network call. It is not
// wired into a deployed Worker yet — that requires Cloudflare deploy access
// this session does not have.

// Used only for security/geopolitics stories with no usable brief. Earlier
// versions used "Arctic landscapes, ice, ocean" here, and every story with a
// cold palette came out looking frozen, so the fallback is now a neutral scene.
const GEOPOLITICAL_FALLBACK =
  "Atmospheric world-affairs scene at dusk, distant city skyline, subtle geometric light motifs.";

// Short on purpose: SDXL's text encoders read only about 77 tokens, so style
// rules placed after a long brief never reach the model. The palette follows
// the scene; v3.2.2 asked for "blue and neutral tones" on every image, which
// together with a cinematic-abstract style turned scenes cold and icy.
const STYLE =
  "Editorial illustration, realistic natural lighting, colors true to the scene, simple dark lower third.";

// Cold-weather terms join the negative prompt unless the story itself is
// about ice, snow or the polar regions.
const COLD_SUBJECT = /\b(arctic|antarctic|polar|ice|icy|iceberg|glaciers?|snow\w*|frozen|freez\w*|winter|blizzard)\b/i;

const NEGATIVE_BASE =
  "text, fake text, gibberish, pseudo text, letters, alphabet, numbers, labels, map labels, place names, " +
  "typography, captions, newspaper, document, UI, signs, watermark, logo, chart, infographic, blurry, distorted, gore";

const NEGATIVE_COLD = "ice, snow, frozen, glacier, iceberg, arctic landscape, frost";

// SDXL cannot draw legible text, so any part of a brief asking for labels,
// headlines, sources, maps, charts or scoreboards yields garbled lettering.
// Editorial briefs routinely contain these (many were written for an
// infographic), so those clauses are dropped before the brief reaches the
// model. The rest of the brief, which describes the scene, is kept.
const TEXT_REQUEST =
  /\b(labels?|labell?ed|headline|subhead|sources?|captions?|text|typography|lettering|writing|logos?|watermark|maps?|charts?|scoreboards?|signs?|banners?)\b/i;

// Clauses that only negate ("no flags", "without logos") are dropped: CLIP has
// no notion of "no", so they add the very thing they forbid. What must stay
// out of the image goes in the negative prompt instead.
const NEGATION = /^(no|not|without|do not|don't|avoid)\b/i;

// Keep the brief short: SDXL's text encoders only read the first ~77 tokens,
// and the brief shares them with the subject and style line.
const MAX_BRIEF_CHARS = 200;

/**
 * @param {unknown} brief
 * @returns {string}
 */
export function cleanVisualBrief(brief) {
  if (typeof brief !== "string") return "";

  const sentences = brief
    .replace(/\bMATRIX\s*24\b\s*/g, "")
    .replace(/\bvertical\s+4:5(\s+composition)?\b|\b4:5(\s+composition)?\b/gi, "")
    .replace(/\binfographics?\b/gi, "illustration")
    // Provenance boilerplate belongs in the caption, not the image prompt.
    .replace(/\bAI[- ]generated\b\s*/gi, "")
    .replace(/\bnon[- ]documentary\b\s*/gi, "")
    .replace(/\beditorial illustration of\s+/gi, "")
    // A sentence ends at . ! ? followed by a capital, so "Sept. 23" and
    // "U.S. and" stay whole.
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((sentence) =>
      sentence
        .replace(/[.!?]+$/, "")
        .split(/[,;]\s*/)
        // "silhouette with no facial likeness" keeps its subject, loses the tail.
        .map((clause) => clause.replace(/\s+(with no|without)\b.*$/i, "").trim())
        .filter((clause) => clause && !TEXT_REQUEST.test(clause) && !NEGATION.test(clause))
    )
    .filter((clauses) => clauses.length);

  // Fill the budget clause by clause, so one long sentence cannot starve
  // the scene description that follows it.
  const out = [];
  let length = 0;
  for (const clauses of sentences) {
    const taken = [];
    for (const clause of clauses) {
      const cost = clause.length + 2;
      if (length + cost > MAX_BRIEF_CHARS) break;
      taken.push(clause);
      length += cost;
    }
    if (!taken.length) break;
    const text = taken.join(", ");
    out.push(text.charAt(0).toUpperCase() + text.slice(1) + ".");
    if (taken.length < clauses.length) break;
  }
  return out.join(" ").replace(/\s{2,}/g, " ").trim();
}

/**
 * @param {{headline?: string, category?: string, image_generation_prompt?: string}} story
 * @returns {string}
 */
export function buildBackgroundPrompt(story = {}) {
  const headline = story.headline || "Global news update";
  const category = story.category || "World News";
  const visualBrief = cleanVisualBrief(story.image_generation_prompt);
  const isGeopolitical = /security|geopolitic/i.test(category);

  // The scene goes first so it is always inside the encoder's window.
  // The editorial draft's own brief takes priority over any fallback.
  const scene = visualBrief || (isGeopolitical ? GEOPOLITICAL_FALLBACK : "");

  return [
    "Editorial background, no text.",
    scene,
    `Subject: ${headline}.`,
    STYLE
  ].filter(Boolean).join(" ");
}

/**
 * @param {{headline?: string, image_generation_prompt?: string}} story
 * @returns {string}
 */
export function buildNegativePrompt(story = {}) {
  const subject = `${story.headline || ""} ${story.image_generation_prompt || ""}`;
  return COLD_SUBJECT.test(subject) ? NEGATIVE_BASE : `${NEGATIVE_BASE}, ${NEGATIVE_COLD}`;
}
