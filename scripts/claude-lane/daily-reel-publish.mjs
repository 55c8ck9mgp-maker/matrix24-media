// Claude Lane — daily news-summary Reel publisher engine (Phase 7 hardening,
// watchdog 2026-11-11). Pure orchestration over injected dependencies, so every
// rule is testable without network or GitHub. It applies the same lane rules as
// publisher.mjs (docs/CLAUDE_LANE.md):
//   - nothing while any lane record is publishing / publish_unknown;
//   - at most one daily Reel per UTC day (its content_id is the day's id, and an
//     existing record in ANY status means the day is done — this is what makes
//     the extra backup cron slots and manual runs safe);
//   - 15 min spacing and the content_publishing_limit floor;
//   - a durable, compare-and-swap claim (status publishing, committed together
//     with the MP4 and cover JPEG) BEFORE any Instagram call;
//   - exactly one media_publish per attempt; any ambiguous answer is recorded as
//     publish_unknown and never retried; a provably-not-invoked attempt releases
//     the claim with not_invoked proof.
import { validateLaneRecord, checkLaneTransition, composeCaption } from './lane-record.mjs';
import { createMedia, MIN_SPACING_MS, MIN_QUOTA_REMAINING } from './publisher.mjs';

export const BASE_TAGS = Object.freeze(['#matrix24', '#worldnews', '#noticias']);
const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];
const TAG_RE = /^#[\p{L}\p{N}_]+$/u;

export const dailyReelId = (now = Date.now()) => `claude-${new Date(now).toISOString().slice(0, 10).replace(/-/g, '')}-daily-reel`;

const headEn = s => String(s?.headline || s?.headline_en || '').trim();
const headEs = s => String(s?.headline_es || '').trim();

function next(prev, patch, event, nowIso) {
  return { ...prev, ...patch, history: [...(prev?.history || []), { at: nowIso, ...event }] };
}

function assertWritable(prev, rec) {
  const errors = validateLaneRecord(rec);
  if (errors.length) throw new Error(`INVALID_LANE_RECORD:${rec.content_id}:${errors.join(',')}`);
  const t = checkLaneTransition(prev, rec);
  if (!t.ok) throw new Error(`INVALID_LANE_TRANSITION:${rec.content_id}:${t.error}`);
}

// Builds a schema-valid lane record (status draft) for the day's Reel from the
// stories actually used in the video. Sources are the union of the stories'
// sources, so the record carries the same attribution as the single posts.
export function buildDailyReelRecord({ contentId, createdAt, stories, videoUrl, imageUrl, totalSeconds }) {
  const used = (stories || []).filter(s => headEn(s) || headEs(s));
  const line = (s, i, pick) => `${NUM[i] || `${i + 1}.`} ${pick(s) || headEn(s) || headEs(s)}`;
  const urls = []; const names = []; const tags = [...BASE_TAGS];
  for (const s of used) {
    for (const u of s.source_urls || []) if (!urls.includes(u)) urls.push(u);
    for (const n of s.source_names || []) if (!names.includes(n)) names.push(n);
    for (const t of s.hashtags || []) {
      if (TAG_RE.test(t) && !tags.some(x => x.toLowerCase() === t.toLowerCase())) tags.push(t);
    }
  }
  const day = createdAt.slice(0, 10);
  return {
    lane: 'claude',
    content_id: contentId,
    status: 'draft',
    created_at: createdAt,
    category: 'Daily summary',
    headline: `MATRIX 24 daily news summary — ${day}`,
    headline_es: `Resumen diario de noticias MATRIX 24 — ${day}`,
    caption_es: `Resumen del día:\n${used.map((s, i) => line(s, i, headEs)).join('\n')}`,
    caption_en: `Today's summary:\n${used.map((s, i) => line(s, i, headEn)).join('\n')}`,
    source_urls: urls,
    source_names: names,
    hashtags: tags.slice(0, 15),
    ai_illustration: used.some(s => s.ai_illustration === true) || undefined,
    media_format: 'reel',
    image_url: imageUrl,
    video_url: videoUrl,
    daily_reel: { story_ids: used.map(s => s.content_id).filter(Boolean), total_seconds: totalSeconds ?? null },
    publish_attempt_id: null,
    ig_media_id: null,
    history: [],
  };
}

// Read-only gate used before the (slow) render and again before publishing.
export function preflight(entries, { contentId, now = Date.now() }) {
  const unresolved = entries.filter(e => ['publishing', 'publish_unknown'].includes(e.record.status));
  if (unresolved.length) return { proceed: false, outcome: 'unresolved_attempt', ids: unresolved.map(e => e.record.content_id) };
  const existing = entries.find(e => e.record.content_id === contentId);
  if (existing) return { proceed: false, outcome: 'already_exists', content_id: contentId, status: existing.record.status };
  const lastReserved = Math.max(0, ...entries.map(e => Date.parse(e.record.reserved_at || '') || 0));
  if (now - lastReserved < MIN_SPACING_MS) {
    return { proceed: false, outcome: 'spacing', next_after: new Date(lastReserved + MIN_SPACING_MS).toISOString() };
  }
  return { proceed: true, outcome: 'go', content_id: contentId };
}

export async function runDailyReelPublish({
  mode = 'dry-run', enabled = false, store, ig, readQuota, record, files = [],
  now = Date.now(), clock = () => Date.now(), newAttemptId = () => crypto.randomUUID(),
  cdnWaitMs = 0, settleMs = 0, sleep = ms => new Promise(r => setTimeout(r, ms)),
}) {
  if (mode !== 'dry-run' && mode !== 'live') return { outcome: 'bad_mode' };
  const live = mode === 'live';
  if (live && enabled !== true) return { outcome: 'disabled' };
  if (!record || record.status !== 'draft') return { outcome: 'bad_record' };
  const nowIso = new Date(now).toISOString();
  const stamp = () => new Date(clock()).toISOString();

  const entries = await store.list();
  const gate = preflight(entries, { contentId: record.content_id, now });
  if (!gate.proceed) return gate;

  let quota;
  try { quota = await readQuota(); } catch { return { outcome: 'quota_unknown' }; }
  if (!Number.isFinite(quota?.total) || !Number.isFinite(quota?.used)) return { outcome: 'quota_unknown' };
  if (quota.total - quota.used < MIN_QUOTA_REMAINING) return { outcome: 'quota_low', quota };

  // draft -> ready_to_publish -> publishing, each step checked; only the claim is written.
  assertWritable(null, record);
  const ready = next(record, { status: 'ready_to_publish' }, { event: 'rendered' }, nowIso);
  assertWritable(record, ready);
  const attempt = newAttemptId();
  const reserved = next(ready, { status: 'publishing', publish_attempt_id: attempt, reserved_at: nowIso },
    { event: 'reserved', publish_attempt_id: attempt }, nowIso);
  assertWritable(ready, reserved);
  const caption = composeCaption(reserved);
  if (!live) return { outcome: 'would_publish', content_id: record.content_id, caption_length: caption.length, caption, quota_remaining: quota.total - quota.used };

  // Durable claim BEFORE any Instagram call (rule 3). CAS on "file absent".
  const claim = await store.write(reserved, null, `claude-lane: reserve daily reel ${record.content_id}`, files);
  if (!claim.ok) return { outcome: 'claim_conflict', content_id: record.content_id };
  if (cdnWaitMs > 0) await sleep(cdnWaitMs); // let raw.githubusercontent serve the new MP4

  const release = async reason => {
    const back = next(reserved, { status: 'ready_to_publish', publish_attempt_id: null, reserved_at: null },
      { event: 'not_invoked', publish_attempt_id: attempt, reason }, stamp());
    assertWritable(reserved, back);
    const w = await store.write(back, claim.sha, `claude-lane: release daily reel ${record.content_id} (${reason})`);
    return { outcome: w.ok ? 'not_invoked' : 'release_write_failed', content_id: record.content_id, reason };
  };

  const made = await createMedia(ig, reserved, caption);
  if (!made.ok) return release(made.reason);
  const readyState = await ig.waitContainer(made.containerId, made.waitOpts);
  if (!readyState.ok) return release(readyState.reason);
  if (settleMs > 0) await sleep(settleMs);

  // The only public side effect. Exactly once per attempt.
  const pub = await ig.publishContainer(made.containerId);
  if (pub.outcome === 'published') {
    let permalink = null;
    try { permalink = (await ig.getMedia(pub.mediaId))?.permalink ?? null; } catch { permalink = null; }
    const done = next(reserved, { status: 'published', ig_media_id: pub.mediaId, permalink },
      { event: 'published', publish_attempt_id: attempt, ig_media_id: pub.mediaId }, stamp());
    assertWritable(reserved, done);
    const w = await store.write(done, claim.sha, `claude-lane: daily reel published ${record.content_id}`);
    return { outcome: w.ok ? 'published' : 'published_record_write_failed', content_id: record.content_id, ig_media_id: pub.mediaId, permalink };
  }
  const unknown = next(reserved, { status: 'publish_unknown' },
    { event: 'publish_unknown', publish_attempt_id: attempt, reason: pub.reason }, stamp());
  assertWritable(reserved, unknown);
  const w = await store.write(unknown, claim.sha, `claude-lane: publish_unknown ${record.content_id}`);
  return { outcome: w.ok ? 'publish_unknown' : 'unknown_record_write_failed', content_id: record.content_id, reason: pub.reason };
}
