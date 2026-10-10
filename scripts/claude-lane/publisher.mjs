// Claude Lane publisher engine (docs/CLAUDE_LANE.md). Pure orchestration over
// injected dependencies so every rule is testable without network or GitHub:
//   store: { list(): [{record, sha}], write(record, sha, message): {ok, sha?, conflict?} }
//   ig:    createInstagramClient(...) from scripts/instagram-graph.mjs
//   readQuota(): { total, used }   (content_publishing_limit, read-only)
// mode 'dry-run' performs reads only and returns the plan it would execute.
import { validateLaneRecord, checkLaneTransition, composeCaption } from './lane-record.mjs';
import { findDuplicate } from './dedupe.mjs';

// No daily cap (Justen, 2026-10-06): volume follows the news. Limits are the
// account's Instagram quota floor and a minimum spacing between posts.
export const MIN_SPACING_MS = 15 * 60 * 1000;
export const MIN_QUOTA_REMAINING = 10;
// Pause between the container reporting FINISHED and the single media_publish
// call. Meta answered 9007/2207027 ("media not ready") right after FINISHED on
// 2026-10-09 (and a bare 400 on 2026-10-08), leaving publish_unknown records.
// The pause is read-only waiting; it never adds a second publish call.
export const PUBLISH_SETTLE_MS = 20 * 1000;

const utcDay = ms => new Date(ms).toISOString().slice(0, 10);

function next(prev, patch, event, nowIso) {
  return { ...prev, ...patch, history: [...(prev.history || []), { at: nowIso, ...event }] };
}

function assertWritable(prev, rec) {
  const errors = validateLaneRecord(rec);
  if (errors.length) throw new Error(`INVALID_LANE_RECORD:${rec.content_id}:${errors.join(',')}`);
  const t = checkLaneTransition(prev, rec);
  if (!t.ok) throw new Error(`INVALID_LANE_TRANSITION:${rec.content_id}:${t.error}`);
}

// Private container steps for the record's media format. Nothing here publishes.
// Image: unchanged. Carousel: each child is created and finished before the
// parent. Reel: processing is slower, so it gets a longer wait. Any failure
// returns ok:false before publish, so the claim is released as not_invoked.
export async function createMedia(ig, candidate, caption) {
  const fmt = candidate.media_format ?? 'image';
  if (fmt === 'image') {
    return ig.createContainer({ imageUrl: candidate.image_url, caption });
  }
  if (fmt === 'carousel') {
    const ids = [];
    for (const [i, url] of (candidate.carousel_urls ?? []).entries()) {
      const c = await ig.createChildContainer({ imageUrl: url });
      if (!c.ok) return { ok: false, reason: `carousel_child_${i}_${c.reason}` };
      const w = await ig.waitContainer(c.containerId);
      if (!w.ok) return { ok: false, reason: `carousel_child_${i}_${w.reason}` };
      ids.push(c.containerId);
    }
    return ig.createCarouselContainer({ childIds: ids, caption });
  }
  if (fmt === 'reel') {
    const c = await ig.createReelContainer({ videoUrl: candidate.video_url, caption });
    return c.ok ? { ok: true, containerId: c.containerId, waitOpts: { attempts: 60, intervalMs: 5000 } } : c;
  }
  return { ok: false, reason: 'unknown_media_format' };
}

export async function runPublisher({
  mode = 'dry-run', enabled = false, store, ig, readQuota, others = [],
  now = Date.now(), newAttemptId = () => crypto.randomUUID(),
  settleMs = 0, sleep = ms => new Promise(r => setTimeout(r, ms)),
}) {
  if (mode !== 'dry-run' && mode !== 'live') return { outcome: 'bad_mode' };
  const live = mode === 'live';
  if (live && enabled !== true) return { outcome: 'disabled' };
  const nowIso = new Date(now).toISOString();

  const entries = await store.list();
  const unresolved = entries.filter(e => ['publishing', 'publish_unknown'].includes(e.record.status));
  if (unresolved.length) return { outcome: 'unresolved_attempt', ids: unresolved.map(e => e.record.content_id) };

  const ready = entries.filter(e => e.record.status === 'ready_to_publish')
    .sort((a, b) => a.record.created_at.localeCompare(b.record.created_at));
  if (!ready.length) return { outcome: 'no_candidate' };
  const { record: candidate, sha } = ready[0];

  const lastReserved = Math.max(0, ...entries.map(e => Date.parse(e.record.reserved_at || '') || 0));
  if (now - lastReserved < MIN_SPACING_MS) return { outcome: 'spacing', next_after: new Date(lastReserved + MIN_SPACING_MS).toISOString() };
  const today = entries.filter(e => e.record.reserved_at && utcDay(Date.parse(e.record.reserved_at)) === utcDay(now)).length;

  let quota;
  try { quota = await readQuota(); } catch { return { outcome: 'quota_unknown' }; }
  if (!Number.isFinite(quota?.total) || !Number.isFinite(quota?.used)) return { outcome: 'quota_unknown' };
  if (quota.total - quota.used < MIN_QUOTA_REMAINING) return { outcome: 'quota_low', quota };

  let feed;
  try { feed = await ig.listRecentMedia({ maxItems: 100 }); } catch { return { outcome: 'feed_unknown' }; }

  const laneOthers = entries.filter(e => e.record.content_id !== candidate.content_id && e.record.status !== 'skipped_duplicate')
    .map(e => ({ id: e.record.content_id, headline: e.record.headline, source_urls: e.record.source_urls }));
  const dup = findDuplicate(candidate, { others: [...others, ...laneOthers], feed, now });
  if (dup) {
    const skipped = next(candidate, { status: 'skipped_duplicate' }, { event: 'skipped_duplicate', ...dup }, nowIso);
    assertWritable(candidate, skipped);
    if (!live) return { outcome: 'would_skip_duplicate', content_id: candidate.content_id, duplicate: dup };
    const w = await store.write(skipped, sha, `claude-lane: skip duplicate ${candidate.content_id}`);
    return { outcome: w.ok ? 'skipped_duplicate' : 'write_conflict', content_id: candidate.content_id, duplicate: dup };
  }

  const caption = composeCaption(candidate);
  const attempt = newAttemptId();
  const reserved = next(candidate, { status: 'publishing', publish_attempt_id: attempt, reserved_at: nowIso },
    { event: 'reserved', publish_attempt_id: attempt }, nowIso);
  assertWritable(candidate, reserved);
  if (!live) {
    return { outcome: 'would_publish', content_id: candidate.content_id, image_url: candidate.image_url, media_format: candidate.media_format ?? 'image',
      caption_length: caption.length, caption, quota_remaining: quota.total - quota.used, today };
  }

  // Durable claim BEFORE any Instagram call (rule 3).
  const claim = await store.write(reserved, sha, `claude-lane: reserve ${candidate.content_id}`);
  if (!claim.ok) return { outcome: 'claim_conflict', content_id: candidate.content_id };

  const release = async reason => {
    const back = next(reserved, { status: 'ready_to_publish', publish_attempt_id: null, reserved_at: null },
      { event: 'not_invoked', publish_attempt_id: attempt, reason }, new Date(Date.now()).toISOString());
    assertWritable(reserved, back);
    const w = await store.write(back, claim.sha, `claude-lane: release ${candidate.content_id} (${reason})`);
    return { outcome: w.ok ? 'not_invoked' : 'release_write_failed', content_id: candidate.content_id, reason };
  };

  const made = await createMedia(ig, candidate, caption);
  if (!made.ok) return release(made.reason);
  const readyState = await ig.waitContainer(made.containerId, made.waitOpts);
  if (!readyState.ok) return release(readyState.reason);
  if (settleMs > 0) await sleep(settleMs);

  // The only public side effect. Exactly once per attempt (rules 3 and 4).
  const pub = await ig.publishContainer(made.containerId);
  if (pub.outcome === 'published') {
    let permalink = null;
    try { permalink = (await ig.getMedia(pub.mediaId))?.permalink ?? null; } catch { permalink = null; }
    const done = next(reserved, { status: 'published', ig_media_id: pub.mediaId, permalink },
      { event: 'published', publish_attempt_id: attempt, ig_media_id: pub.mediaId }, new Date(Date.now()).toISOString());
    assertWritable(reserved, done);
    const w = await store.write(done, claim.sha, `claude-lane: published ${candidate.content_id}`);
    return { outcome: w.ok ? 'published' : 'published_record_write_failed', content_id: candidate.content_id, ig_media_id: pub.mediaId, permalink };
  }
  const unknown = next(reserved, { status: 'publish_unknown' },
    { event: 'publish_unknown', publish_attempt_id: attempt, reason: pub.reason }, new Date(Date.now()).toISOString());
  assertWritable(reserved, unknown);
  const w = await store.write(unknown, claim.sha, `claude-lane: publish_unknown ${candidate.content_id}`);
  return { outcome: w.ok ? 'publish_unknown' : 'unknown_record_write_failed', content_id: candidate.content_id, reason: pub.reason };
}
