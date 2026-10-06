// Claude Lane reconciler: resolves publishing / publish_unknown only with positive
// evidence (a feed post whose caption starts with the record's exact caption).
// No match writes nothing; it never publishes or retries (CLAUDE.md invariants 2, 6).
import { composeCaption, checkLaneTransition, validateLaneRecord } from './lane-record.mjs';
import { normalizeCaption } from '../instagram-graph.mjs';

export const MIN_AGE_MS = 15 * 60 * 1000;

export async function reconcile({ store, ig, now = Date.now(), live = false }) {
  const entries = (await store.list()).filter(e => ['publishing', 'publish_unknown'].includes(e.record.status));
  const due = entries.filter(e => now - Date.parse(e.record.reserved_at || e.record.created_at) >= MIN_AGE_MS);
  if (!due.length) return { outcome: 'nothing_to_reconcile', pending: entries.length };
  let feed;
  try { feed = await ig.listRecentMedia({ maxItems: 100 }); } catch { return { outcome: 'feed_unknown' }; }
  const results = [];
  for (const { record, sha } of due) {
    const want = normalizeCaption(composeCaption(record));
    const hits = feed.filter(m => normalizeCaption(m.caption).startsWith(want));
    if (hits.length !== 1) { results.push({ id: record.content_id, matches: hits.length }); continue; }
    const m = hits[0];
    const done = { ...record, status: 'published', ig_media_id: m.id, permalink: m.permalink ?? null,
      history: [...record.history, { at: new Date(now).toISOString(), event: 'reconciled', ig_media_id: m.id }] };
    if (!checkLaneTransition(record, done).ok || validateLaneRecord(done).length) {
      results.push({ id: record.content_id, error: 'invalid_reconcile_write' }); continue;
    }
    if (!live) { results.push({ id: record.content_id, would_mark_published: m.id }); continue; }
    const w = await store.write(done, sha, `claude-lane: reconcile ${record.content_id} -> published`);
    results.push({ id: record.content_id, published: w.ok ? m.id : 'write_failed' });
  }
  return { outcome: 'reconciled', results };
}
