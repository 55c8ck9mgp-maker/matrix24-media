import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyQueueWrite, historyAppendOnly, pendingOwner, PLANES } from '../scripts/queue-transition-ownership.mjs';

const id = 'matrix24-fixture-story';
const blocked = { content_id: id, status: 'blocked_media', headline: 'h', caption: 'c', publish_attempt_history: [] };
const processing = { ...blocked, status: 'processing_media', media_claim: { id: 'req-1', started_at: '2026-09-28T10:00:00Z' } };
const ready = { ...blocked, status: 'ready_to_publish', public_image_url: 'https://example.test/a.jpg',
  image_spec: { format: 'JPEG', mode: 'RGB', width: 1080, height: 1350, alpha: false },
  publish_attempt_history: [{ timestamp: '2026-09-28T10:01:00Z', stage: 'media_pipeline', result: 'success' }] };
const started = { timestamp: '2026-09-28T11:00:00Z', stage: 'publication', result: 'started', publish_attempt_id: 'att-1' };
const publishing = { ...ready, status: 'publishing', publish_attempt_id: 'att-1', publishing_started_at: '2026-09-28T11:00:00Z',
  publish_attempt_history: [...ready.publish_attempt_history, started] };

test('each normal transition is owned by exactly one plane', () => {
  assert.equal(classifyQueueWrite(null, blocked).plane, PLANES.PROMOTION);
  assert.equal(classifyQueueWrite(blocked, processing).plane, PLANES.MEDIA);
  const media = classifyQueueWrite(processing, ready);
  assert.equal(media.ok, true);
  assert.equal(media.plane, PLANES.MEDIA);
  const reserve = classifyQueueWrite(ready, publishing);
  assert.equal(reserve.ok, true);
  assert.equal(reserve.plane, PLANES.PUBLICATION);
  const done = { ...publishing, status: 'published', instagram_media_id: '17901642846667497', published_at: '2026-09-28T11:02:00Z' };
  assert.deepEqual(classifyQueueWrite(publishing, done).violations, []);
});

test('a second media run replacing a live media claim is a scheduler race', () => {
  const other = { ...processing, media_claim: { id: 'req-2', started_at: '2026-09-28T10:15:00Z' } };
  const r = classifyQueueWrite(processing, other);
  assert.equal(r.ok, false);
  assert.ok(r.violations.includes('media_claim_owner_overwritten'));
});

test('another attempt cannot overwrite a live publication reservation', () => {
  const stolen = { ...publishing, publish_attempt_id: 'att-2' };
  assert.ok(classifyQueueWrite(publishing, stolen).violations.includes('claim_owner_overwritten'));
});

test('publish_unknown can never be re-reserved for a new send', () => {
  const unknown = { ...publishing, status: 'publish_unknown' };
  const retry = { ...unknown, status: 'publishing', publish_attempt_id: 'att-2' };
  assert.ok(classifyQueueWrite(unknown, retry).violations.includes('transition_not_owned:publish_unknown->publishing'));
});

test('skipping the reservation straight to published is rejected', () => {
  const skip = { ...ready, status: 'published', instagram_permalink: 'https://www.instagram.com/p/x/' };
  assert.ok(classifyQueueWrite(ready, skip).violations.includes('transition_not_owned:ready_to_publish->published'));
});

test('publication plane may not rewrite editorial or media fields in the same write', () => {
  const r = classifyQueueWrite(ready, { ...publishing, caption: 'rewritten' });
  assert.ok(r.violations.includes('mixed_plane_write:publication:caption'));
  const m = classifyQueueWrite(ready, { ...publishing, public_image_url: 'https://example.test/b.jpg' });
  assert.ok(m.violations.includes('mixed_plane_write:publication:public_image_url'));
});

test('media plane may not touch publication claim fields', () => {
  const r = classifyQueueWrite(processing, { ...ready, publish_attempt_id: 'att-x' });
  assert.ok(r.violations.includes('mixed_plane_write:media:publish_attempt_id'));
});

test('releasing a claim needs durable not-invoked evidence for that attempt', () => {
  const released = { ...ready, publish_attempt_history: [...publishing.publish_attempt_history,
    { timestamp: '2026-09-28T11:01:00Z', stage: 'publication', result: 'not_invoked', publish_attempt_id: 'att-1' }] };
  assert.equal(classifyQueueWrite(publishing, released).ok, true);
  const silent = { ...ready, publish_attempt_history: publishing.publish_attempt_history };
  assert.ok(classifyQueueWrite(publishing, silent).violations.includes('claim_released_without_not_invoked_proof'));
  const sent = { ...publishing, metricool_scheduled_post_id: 1 };
  const afterSend = { ...released, metricool_scheduled_post_id: 1 };
  assert.ok(classifyQueueWrite(sent, afterSend).violations.includes('claim_released_without_not_invoked_proof'));
});

test('terminal records accept evidence enrichment but never evidence changes', () => {
  const pub = { ...ready, status: 'published', instagram_media_id: '1', published_at: 't' };
  assert.equal(classifyQueueWrite(pub, { ...pub, instagram_permalink: 'https://www.instagram.com/p/y/' }).ok, true);
  assert.ok(classifyQueueWrite(pub, { ...pub, instagram_media_id: '2' }).violations.includes('terminal_evidence_changed:instagram_media_id'));
  assert.ok(classifyQueueWrite(pub, { ...pub, publish_attempt_id: 'att-9' }).violations.includes('terminal_claim_added:publish_attempt_id'));
});

test('history is append-only except the media worker cap trimming the oldest entry', () => {
  assert.equal(historyAppendOnly([{ a: 1 }], [{ a: 1 }, { b: 2 }]).ok, true);
  assert.equal(historyAppendOnly([{ a: 1 }, { b: 2 }], [{ b: 2 }]).ok, false);
  const full = Array.from({ length: 50 }, (_, i) => ({ i }));
  assert.equal(historyAppendOnly(full, [...full.slice(1), { i: 50 }]).ok, true);
  assert.equal(classifyQueueWrite(ready, { ...ready, publish_attempt_history: [] }).ok, false);
});

test('discard and editorial corrections are owner decisions, flagged not silent', () => {
  const d = classifyQueueWrite(ready, { ...ready, status: 'discarded' });
  assert.equal(d.plane, PLANES.OWNER_MANUAL);
  assert.ok(d.warnings.includes('owner_manual_discard'));
  const e = classifyQueueWrite(ready, { ...ready, caption: 'fixed typo' });
  assert.equal(e.ok, true);
  assert.ok(e.warnings.includes('owner_manual_editorial_correction'));
  assert.equal(classifyQueueWrite(publishing, { ...publishing, caption: 'x' }).ok, false);
});

test('deleting a queue record is never allowed', () => {
  assert.ok(classifyQueueWrite(ready, null).violations.includes('queue_record_deleted'));
});

test('stall detection names the single plane allowed to act', () => {
  const now = Date.parse('2026-09-28T15:00:00Z');
  const r = pendingOwner({ ...ready, publish_attempt_history: ready.publish_attempt_history }, { now });
  assert.equal(r.owner, PLANES.PUBLICATION);
  assert.equal(r.stalled, true);
  assert.equal(pendingOwner(blocked, { now }).owner, PLANES.MEDIA);
  assert.equal(pendingOwner(publishing, { now }).owner, PLANES.RECOVERY);
  assert.equal(pendingOwner({ ...ready, status: 'published' }, { now }).owner, null);
  const fresh = pendingOwner(processing, { now: Date.parse('2026-09-28T10:10:00Z') });
  assert.equal(fresh.stalled, false);
});

test('a record appearing in any state other than blocked_media is rejected, not a crash', () => {
  for (const r of [ready, publishing, processing, { ...ready, status: 'published', instagram_media_id: '1' }]) {
    const out = classifyQueueWrite(null, r);
    assert.equal(out.ok, false);
    assert.ok(out.violations[0].startsWith('transition_not_owned:null->'));
  }
});
