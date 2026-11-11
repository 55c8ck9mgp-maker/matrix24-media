// Claude Lane — story ranker for the daily Reel (Phase 7).
// Scores drafts by global relevance and recency, then returns the top N
// from the last 24 hours.  No external calls; pure functions only.
// See docs/CLAUDE_LANE.md "Phase 7 — Daily News Summary Reel".

const HIGH_IMPACT_KEYWORDS = [
  'war', 'attack', 'killed', 'dead', 'crisis', 'nuclear',
  'sanctions', 'election', 'president', 'prime minister',
  'ceasefire', 'invasion', 'earthquake', 'tsunami', 'flood',
  'climate', 'inflation', 'recession', 'trade', 'tariff',
  'summit', 'treaty', 'nato', 'united nations', 'g7', 'g20',
  'imf', 'world bank', 'terrorist', 'protest', 'revolution',
  'explosion', 'arrested', 'resign', 'collapse', 'emergency',
  'pandemic', 'outbreak', 'missile', 'forces', 'troops',
];

/**
 * Score a single draft for global relevance.
 * - 10 pts per HIGH_IMPACT_KEYWORDS keyword match (case-insensitive) in
 *   headline_en + summary_en; capped at 50 pts from keywords.
 * - +30 pts when draft.breaking === true.
 * Returns a non-negative integer.
 */
export function scoreStory(draft) {
  const text = [
    draft?.headline_en || '',
    draft?.summary_en || '',
    draft?.headline_es || '',
    draft?.summary_es || '',
  ].join(' ').toLowerCase();

  let keywordScore = 0;
  for (const kw of HIGH_IMPACT_KEYWORDS) {
    if (text.includes(kw)) keywordScore += 10;
    if (keywordScore >= 50) break;
  }

  // Bonus exceeds keyword cap (50) so any breaking story outranks any non-breaking story.
  const breakingBonus = draft?.breaking === true ? 60 : 0;
  return keywordScore + breakingBonus;
}

/**
 * Select the top N globally-relevant stories from the last 24 hours.
 *
 * @param {object[]} drafts     Raw draft objects (must have created_at ISO string).
 * @param {number}   n          Number of stories to return (default 4).
 * @param {object}   opts
 * @param {Date}     opts.now       Reference "now" (default: new Date()).
 * @param {number}   opts.windowMs  Look-back window in ms (default: 24 h).
 * @returns {object[]} Up to n drafts, sorted by score desc then recency desc.
 */
export function selectTopStories(
  drafts,
  n = 4,
  { now = new Date(), windowMs = 24 * 3600 * 1000 } = {},
) {
  const cutoff = new Date(now.getTime() - windowMs);

  const recent = drafts.filter(d => {
    if (!d?.created_at) return false;
    const t = new Date(d.created_at);
    return !isNaN(t) && t >= cutoff;
  });

  const scored = recent.map(d => ({
    draft: d,
    score: scoreStory(d),
    ts: new Date(d.created_at).getTime(),
  }));

  // Primary sort: score desc; secondary: recency desc (most recent first).
  scored.sort((a, b) => b.score - a.score || b.ts - a.ts);

  return scored.slice(0, n).map(s => s.draft);
}
