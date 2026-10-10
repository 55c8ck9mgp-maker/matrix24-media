// Claude Lane carousel PLAN (staging only, not wired into the publisher).
// Pure functions: validate a multi-slide story and describe the Graph API
// steps. Nothing here calls Instagram. See docs/CLAUDE_LANE.md "Carousels
// (staging)". Production invariants: one media_publish per attempt, no blind
// retry, and a carousel is published only after every child is FINISHED.
export const MIN_SLIDES = 2;
export const MAX_SLIDES = 10;
export const MAX_CAPTION = 2200;

export function planCarousel({ slides, caption }) {
  if (!Array.isArray(slides) || slides.length < MIN_SLIDES || slides.length > MAX_SLIDES) {
    return { ok: false, reason: 'slide_count_out_of_range' };
  }
  for (const s of slides) {
    if (typeof s !== 'string' || !s.startsWith('https://')) return { ok: false, reason: 'slide_url_not_https' };
  }
  if (typeof caption !== 'string' || caption.length === 0 || caption.length > MAX_CAPTION) {
    return { ok: false, reason: 'caption_invalid' };
  }
  return {
    ok: true,
    steps: [
      // 1. One child container per slide. None is published on its own.
      ...slides.map((image_url, i) => ({ op: 'create_child', index: i, body: { image_url, is_carousel_item: true } })),
      // 2. Wait until every child reports FINISHED. Any error stops here.
      { op: 'wait_children', count: slides.length },
      // 3. Parent carousel container that references the children by id.
      { op: 'create_parent', body: { media_type: 'CAROUSEL', caption, children: 'child_ids' } },
      // 4. Wait for the parent to be FINISHED, then ONE publish call.
      { op: 'wait_parent' },
      { op: 'publish_once' },
    ],
  };
}

// If any step before publish_once fails, nothing is published. The lane
// releases the claim as not_invoked only when no publish call was made.
export function failureOutcome(failedOp) {
  if (failedOp === 'publish_once') return 'publish_unknown';
  return 'not_invoked';
}
