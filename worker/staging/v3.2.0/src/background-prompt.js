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

const GEOPOLITICAL_FALLBACK =
  "For geopolitical stories with no specific visual brief, use atmospheric " +
  "Arctic landscapes, ice, ocean, subtle geometric shapes and strategic-light " +
  "motifs as a generic, non-literal placeholder.";

const SHARED_RULES = [
  "Create a clean premium editorial background illustration for an international news card.",
  "Use cinematic abstract visual storytelling only.",
  "Do NOT create maps with labels.",
  "Do NOT create charts, documents, newspapers, screens, signs or interface panels.",
  "Do NOT include flags containing symbols or writing.",
  "Absolutely no readable or unreadable text anywhere in the image.",
  "No letters, numbers, pseudo-writing, glyphs, captions, labels or typography.",
  "Background artwork only.",
  "Professional international newsroom aesthetic.",
  "Realistic lighting, restrained composition, sophisticated blue and neutral tones.",
  "Leave the lower third visually simple and dark for headline overlay."
];

// SDXL cannot draw legible text, so any part of a brief asking for labels,
// headlines, sources, maps, charts or scoreboards yields garbled lettering.
// Editorial briefs routinely contain these (many were written for an
// infographic), so those clauses are dropped before the brief reaches the
// model. The rest of the brief, which describes the scene, is kept.
const TEXT_REQUEST =
  /\b(labels?|labell?ed|headline|subhead|sources?|captions?|text|typography|lettering|writing|logos?|watermark|maps?|charts?|scoreboards?|signs?|banners?)\b/i;

// Keep the brief short: SDXL's text encoders only read the first ~77 tokens,
// so a long brief would push the no-text rules out of range.
const MAX_BRIEF_CHARS = 320;

/**
 * @param {unknown} brief
 * @returns {string}
 */
export function cleanVisualBrief(brief) {
  if (typeof brief !== "string") return "";

  const sentences = brief
    .replace(/\bMATRIX\s*24\b\s*/g, "")
    .replace(/\bvertical\s+4:5\b|\b4:5\b/gi, "")
    .replace(/\binfographics?\b/gi, "illustration")
    // A sentence ends at . ! ? followed by a capital, so "Sept. 23" and
    // "U.S. and" stay whole.
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((sentence) =>
      sentence
        .replace(/[.!?]+$/, "")
        .split(/[,;]\s*/)
        .map((clause) => clause.trim())
        .filter((clause) => clause && !TEXT_REQUEST.test(clause))
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

  const parts = [
    "Editorial background illustration, no text or lettering.",
    `Story subject: ${headline}.`,
    `Category: ${category}.`
  ];

  if (visualBrief) {
    // The editorial draft's own visual brief takes priority over any
    // generic category fallback, geopolitical or not.
    parts.push(`Specific visual brief for this story: ${visualBrief}`);
  } else if (isGeopolitical) {
    parts.push(GEOPOLITICAL_FALLBACK);
  }

  return [...parts, ...SHARED_RULES].join(" ");
}
