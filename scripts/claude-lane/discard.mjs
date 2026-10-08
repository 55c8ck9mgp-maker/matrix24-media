// Claude Lane owner recovery: publish_unknown -> discarded.
// Runs only from the owner's manual workflow (claude-lane-discard.yml). It never
// publishes, retries or re-queues: a discarded story is terminal, so this cannot
// cause a second publication (CLAUDE.md invariants 1-3). It refuses unless a
// complete, fresh read of the feed shows no post that could be this story,
// reaching back past the attempt's reservation time (invariants 6-7).
import { composeCaption, checkLaneTransition, validateLaneRecord } from './lane-record.mjs';
import { normalizeCaption } from '../instagram-graph.mjs';

export const MIN_AGE_MS = 15 * 60 * 1000;

const words = s => normalizeCaption(s).toLowerCase();

// Exact match (what the reconciler uses) or any looser hint that the post exists.
export function feedMatches(record, feed) {
  const exact = normalizeCaption(composeCaption(record));
  const hints = [record.caption_es, record.caption_en, record.headline_es, record.headline]
    .filter(x => typeof x === 'string' && x.trim().length >= 25)
    .map(x => words(x).slice(0, 60));
  return feed.filter(m => {
    const cap = normalizeCaption(m?.caption);
    if (cap.startsWith(exact)) return true;
    const low = cap.toLowerCase();
    return hints.some(h => low.includes(h));
  });
}

export async function discardUnknown({ store, ig, contentId, confirm, decidedBy, reason = '', now = Date.now(), live = false }) {
  if (typeof contentId !== 'string' || !contentId) return { outcome: 'refused', why: 'missing_content_id' };
  if (confirm !== contentId) return { outcome: 'refused', why: 'confirmation_mismatch' };
  if (typeof decidedBy !== 'string' || !decidedBy.trim()) return { outcome: 'refused', why: 'missing_decided_by' };

  const entry = (await store.list()).find(e => e.record.content_id === contentId);
  if (!entry) return { outcome: 'refused', why: 'not_found' };
  const { record, sha } = entry;
  if (record.status !== 'publish_unknown') return { outcome: 'refused', why: `status_${record.status}` };
  const reservedAt = Date.parse(record.reserved_at || '');
  if (!Number.isFinite(reservedAt)) return { outcome: 'refused', why: 'missing_reserved_at' };
  if (now - reservedAt < MIN_AGE_MS) return { outcome: 'refused', why: 'too_recent' };

  let feed;
  try { feed = await ig.listRecentMedia({ maxItems: 100 }); } catch { return { outcome: 'refused', why: 'feed_unknown' }; }
  if (!Array.isArray(feed) || !feed.length) return { outcome: 'refused', why: 'feed_empty' };
  // The read must reach back before the attempt; otherwise the post could exist
  // just beyond the window we looked at.
  const oldest = Math.min(...feed.map(m => Date.parse(m?.timestamp)).filter(Number.isFinite));
  if (!Number.isFinite(oldest) || oldest >= reservedAt) return { outcome: 'refused', why: 'feed_window_too_short' };

  const hits = feedMatches(record, feed);
  if (hits.length) return { outcome: 'refused', why: 'possible_match_in_feed', matches: hits.map(m => m.id) };

  const at = new Date(now).toISOString();
  const discarded = {
    ...record,
    status: 'discarded',
    history: [...record.history, {
      at, event: 'owner_discard', publish_attempt_id: record.publish_attempt_id,
      decided_by: decidedBy.trim(), feed_checked: feed.length, feed_matches: 0,
      ...(reason ? { reason: String(reason).slice(0, 200) } : {}),
    }],
  };
  const t = checkLaneTransition(record, discarded);
  if (!t.ok) return { outcome: 'refused', why: t.error };
  const errs = validateLaneRecord(discarded);
  if (errs.length) return { outcome: 'refused', why: 'invalid_record', errors: errs };
  if (!live) return { outcome: 'would_discard', content_id: contentId, feed_checked: feed.length };
  const w = await store.write(discarded, sha, `claude-lane: owner discard ${contentId} (decided by ${decidedBy.trim()})`);
  return { outcome: w.ok ? 'discarded' : 'write_conflict', content_id: contentId, feed_checked: feed.length };
}
