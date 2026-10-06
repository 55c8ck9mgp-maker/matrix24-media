// Cross-lane duplicate detection for the Claude Lane (docs/CLAUDE_LANE.md rule 2).
// Conservative by design: when in doubt the lane skips its own story.

const STOP = new Set(('the a an and or of to in on for with by at from as is are was were be after over into '
  + 'el la los las un una y o de del en con por para al se su sus que tras sobre').split(' '));

export function normalizeUrl(u) {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, '').toLowerCase()}${x.pathname.replace(/\/+$/, '')}`;
  } catch { return null; }
}

export function tokens(text) {
  return new Set(String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOP.has(t)));
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// share of the headline's tokens that appear in a longer text (feed caption)
export function coverage(headline, text) {
  const h = tokens(headline); const t = tokens(text);
  if (h.size < 4) return 0;
  let hit = 0;
  for (const x of h) if (t.has(x)) hit++;
  return hit / h.size;
}

export const HEADLINE_JACCARD = 0.5;
export const FEED_COVERAGE = 0.6;
export const FEED_WINDOW_MS = 72 * 3600 * 1000;

// others: [{ id, headline, source_urls }] from queue/, editorial/verified/ and
// other lane records. feed: [{ id, caption, timestamp }].
export function findDuplicate(record, { others = [], feed = [], now = Date.now() } = {}) {
  const urls = new Set((record.source_urls || []).map(normalizeUrl).filter(Boolean));
  const head = tokens(record.headline);
  for (const o of others) {
    if (o.id === record.content_id) continue;
    const shared = (o.source_urls || []).map(normalizeUrl).find(u => u && urls.has(u));
    if (shared) return { reason: 'shared_source_url', with: o.id, detail: shared };
    const score = jaccard(head, tokens(o.headline));
    if (score >= HEADLINE_JACCARD) return { reason: 'similar_headline', with: o.id, detail: score.toFixed(2) };
  }
  for (const m of feed) {
    const t = Date.parse(m.timestamp);
    if (!Number.isFinite(t) || now - t > FEED_WINDOW_MS) continue;
    const cov = Math.max(coverage(record.headline, m.caption), coverage(record.headline_es || '', m.caption));
    if (cov >= FEED_COVERAGE) return { reason: 'similar_recent_post', with: m.id, detail: cov.toFixed(2) };
  }
  return null;
}
