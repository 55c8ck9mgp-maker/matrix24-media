import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReconciliation, planReconciliation, reconcileRecord } from '../scripts/reconcile-instagram-feed.mjs';

const caption = 'Fixture reconciliation caption long enough to identify exactly one story in the feed. More.';
const base = { content_id: 'matrix24-fixture-rec', caption, timestamp: '2099-01-01T00:00:00Z', media_ready_at: '2099-01-01T00:05:00.000Z',
  publish_attempt_history: [{ timestamp: '2099-01-01T00:05:00.000Z', stage: 'media_pipeline', result: 'success' }] };
const publishing = { ...base, status: 'publishing', provider: 'metricool', publish_attempt_id: 'att-1', publishing_started_at: '2099-01-01T00:10:00.000Z' };
const post = { id: '17900000000000002', caption: `${caption}\n\n#MATRIX24`, username: 'matrix24global',
  permalink: 'https://www.instagram.com/p/xyz/', timestamp: '2099-01-01T00:12:00+0000' };
const opts = { now: '2099-01-01T02:00:00.000Z', expectedUsername: 'matrix24global' };

test('publishing + exactly one caption match -> published with media ID and permalink', () => {
  const r = reconcileRecord(publishing, [post], opts);
  assert.equal(r.after.status, 'published');
  assert.equal(r.after.instagram_media_id, post.id);
  assert.equal(r.after.instagram_permalink, post.permalink);
  assert.equal(r.after.published_at, '2099-01-01T00:12:00.000Z');
  assert.equal(r.after.publish_attempt_id, 'att-1');
});

test('no match never releases or rewrites a claim', () => {
  assert.deepEqual(reconcileRecord(publishing, [], opts), { skip: 'no_match' });
});

test('two matching posts are reported as a duplicate and nothing is written', () => {
  const r = reconcileRecord(publishing, [post, { ...post, id: '17900000000000003' }], opts);
  assert.equal(r.skip, 'duplicate_detected');
  assert.equal(r.media_ids.length, 2);
});

test('posts from another account or from before the media existed do not match', () => {
  assert.equal(reconcileRecord(publishing, [{ ...post, username: 'someone_else' }], opts).skip, 'no_match');
  assert.equal(reconcileRecord(publishing, [{ ...post, timestamp: '2098-12-31T00:00:00+0000' }], opts).skip, 'no_match');
});

test('a fresh attempt is left to its publish run', () => {
  const r = reconcileRecord(publishing, [post], { ...opts, now: '2099-01-01T00:15:00.000Z' });
  assert.equal(r.skip, 'attempt_in_flight');
});

test('published without media ID gets the ID; existing evidence is never changed', () => {
  const pub = { ...base, status: 'published', published_at: '2099-01-01T00:12:00Z' };
  const r = reconcileRecord(pub, [post], opts);
  assert.equal(r.after.instagram_media_id, post.id);
  assert.equal(r.after.published_at, '2099-01-01T00:12:00Z');
  const done = { ...pub, instagram_media_id: '17900000000000009', instagram_permalink: 'https://www.instagram.com/p/q/' };
  assert.equal(reconcileRecord(done, [post], opts).skip, 'complete');
});

test('plan writes pass the ownership table; apply refuses a changed snapshot', async () => {
  const plan = planReconciliation([{ queue_path: 'queue/matrix24-fixture-rec.json', sha: 'a'.repeat(40), record: publishing }], [post], opts);
  assert.equal(plan.writes.length, 1);
  assert.equal(plan.writes[0].transition, 'publishing->published');
  const writes = [];
  const queue = { read: async () => ({ exists: true, sha: 'b'.repeat(40) }), write: async (...a) => { writes.push(a); return { ok: true }; } };
  const res = await applyReconciliation(plan, { queue });
  assert.deepEqual(res.skipped, [{ content_id: 'matrix24-fixture-rec', reason: 'sha_changed' }]);
  assert.equal(writes.length, 0);
});
