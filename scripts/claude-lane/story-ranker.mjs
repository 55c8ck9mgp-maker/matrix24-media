// Claude Lane — story ranker for the daily Reel (Phase 7).
// Scores drafts by global relevance and recency, then returns the top N
// from the last 24 hours.  No external calls; pure functions only.
// Geographic quota: 70 % Americas, 30 % global.
// See docs/CLAUDE_LANE.md "Phase 7 — Daily News Summary Reel".

// ── Americas detection ─────────────────────────────────────────────────────
// Categories that always count as Americas stories.
const AMERICAS_CATEGORIES = new Set([
  'colombia / latin america',
  'latin america',
  'north america',
  'south america',
  'central america',
  'caribbean',
  'americas',
]);

// Country / region keywords that identify an Americas story.
const AMERICAS_KEYWORDS = [
  'colombia', 'mexico', 'méxico', 'brazil', 'brasil', 'argentina', 'chile',
  'peru', 'perú', 'venezuela', 'ecuador', 'bolivia', 'paraguay', 'uruguay',
  'costa rica', 'panama', 'panamá', 'guatemala', 'honduras', 'el salvador',
  'nicaragua', 'cuba', 'haiti', 'haití', 'dominican', 'dominicana',
  'puerto rico', 'jamaica', 'trinidad', 'barbados', 'guyana', 'suriname',
  'united states', 'usa', 'u.s.', 'washington', 'white house', 'congress',
  'canada', 'ottawa', 'toronto', 'montreal',
  'latin america', 'latinoamerica', 'latinoamérica', 'south america',
  'central america', 'caribbean', 'caribe',
];

/**
 * Returns true when the draft appears to originate from the Western Hemisphere
 * (Americas: North America, Central America, South America, Caribbean).
 * Detection is intentionally conservative — false negatives are acceptable;
 * false positives (calling a non-Americas story Americas) are not.
 *
 * @param {object} draft
 * @returns {boolean}
 */
export function isAmericas(draft) {
  // 1. Explicit category match (most reliable signal).
  const cat = String(draft?.category || '').toLowerCase();
  if (AMERICAS_CATEGORIES.has(cat)) return true;

  // 2. Keyword scan over both languages' headlines and summaries.
  const text = [
    draft?.headline_en || '',
    draft?.headline_es || '',
    draft?.summary_en  || '',
    draft?.summary_es  || '',
  ].join(' ').toLowerCase();

  return AMERICAS_KEYWORDS.some(kw => text.includes(kw));
}

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
 * Geographic quota: 70 % Americas (ceil), remainder global.
 *   e.g. n=4 → 3 Americas + 1 global
 *        n=5 → 4 Americas + 1 global
 * When fewer Americas stories than the quota exist the global pool fills in,
 * and vice versa — the quota is a target, not a hard gate.
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

  // Deduplicate by content_id: keep the first occurrence of each id.
  const seen = new Set();
  const unique = recent.filter(d => {
    if (!d?.content_id) return true;         // no id: always keep
    if (seen.has(d.content_id)) return false; // duplicate: drop
    seen.add(d.content_id);
    return true;
  });

  const scored = unique.map(d => ({
    draft: d,
    score: scoreStory(d),
    ts: new Date(d.created_at).getTime(),
    americas: isAmericas(d),
  }));

  // Primary sort: score desc; secondary: recency desc (most recent first).
  scored.sort((a, b) => b.score - a.score || b.ts - a.ts);

  // ── 70 / 30 geographic quota ──────────────────────────────────────────────
  // Target: ceil(n * 0.7) Americas slots; the rest are global.
  // If either pool is too small, the other fills in — quota is a preference,
  // not a hard filter that would leave the Reel empty.
  const targetAmericas = Math.ceil(n * 0.7);  // 4→3, 5→4, 3→3, 2→2

  const americasPool = scored.filter(s => s.americas);
  const globalPool   = scored.filter(s => !s.americas);

  const result = [];

  // Fill Americas slots.
  for (const s of americasPool) {
    if (result.length >= targetAmericas) break;
    result.push(s);
  }

  // Fill global slots (up to n - targetAmericas, then overflow if Americas short).
  const targetGlobal = n - targetAmericas;
  for (const s of globalPool) {
    if (result.length - americasPool.filter(s2 => result.includes(s2)).length >= targetGlobal
        && result.length >= targetAmericas) break;
    if (result.length >= n) break;
    result.push(s);
  }

  // If still under n, fill from whichever pool has leftovers (quota is a target).
  if (result.length < n) {
    const used = new Set(result);
    for (const s of scored) {
      if (result.length >= n) break;
      if (!used.has(s)) result.push(s);
    }
  }

  // Final sort by score desc, recency desc (quota fill may have reordered).
  result.sort((a, b) => b.score - a.score || b.ts - a.ts);

  return result.slice(0, n).map(s => s.draft);
}
