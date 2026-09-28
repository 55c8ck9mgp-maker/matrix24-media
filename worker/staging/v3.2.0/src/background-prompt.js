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

/**
 * @param {{headline?: string, category?: string, image_generation_prompt?: string}} story
 * @returns {string}
 */
export function buildBackgroundPrompt(story = {}) {
  const headline = story.headline || "Global news update";
  const category = story.category || "World News";
  const visualBrief =
    typeof story.image_generation_prompt === "string"
      ? story.image_generation_prompt.trim()
      : "";
  const isGeopolitical = /security|geopolitic/i.test(category);

  const parts = [
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
