import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runFacebook, createFacebookClient, classifyPostResult, checkFacebookTransition, instagramPublishedAt, FB_WINDOW_MS, FB_MIN_SPACING_MS,
} from '../scripts/claude-lane/facebook.mjs';
import { validateLaneRecord, checkLaneTransition } from '../scripts/claude-lane/lane-record.mjs';

const NOW = Date.parse('2026-10-07T16:30:00Z');
const iso = ms => new Date(ms).toISOString();
const rec = (id, { publishedAt = NOW - 10 * 60 * 1000, ...patch } = {}) => ({
  lane: 'claude', content_id: `claude-20261007-${id}`, status: 'published', created_at: '2026-10-07T15:00:00Z',
  headline: `Story ${id}`, caption_es: 'Texto en español.', caption_en: 'English text.',
  source_urls: [`https://reuters.com/${id}`, `https://apnews.com/${id}`], source_names: ['Reuters', 'AP'], hashtags: ['#MATRIX24'],
  image_url: `https://raw.githubusercontent.com/o/r/main/claude-lane/media/claude-20261007-${id}.jpg`,
  publish_attempt_id: `att-ig-${id}`, ig_media_id: '17876264127633767', permalink: 'https://www.instagram.com/p/x/',
  history: [{ at: iso(publishedAt - 60000), event: 'reserved' }, { at: iso(publishedAt), event: 'published', ig_media_id: '17876264127633767' }],
  ...patch,
});

function fakeStore(records) {
  const state = new Map(records.map(r => [r.content_id, { record: r, sha: `sha-${r.content_id}-0` }]));
  const writes = [];
  return {
    writes, state,
    async list() { return [...state.values()].map(e => ({ ...e })); },
    async write(record, sha, message) {
      const cur = state.get(record.content_id);
      if (cur.sha !== sha) return { ok: false, conflict: true };
      const nsha = `sha-${record.content_id}-${writes.length + 1}`;
      state.set(record.content_id, { record, sha: nsha });
      writes.push({ fb: record.facebook?.status, message });
      return { ok: true, sha: nsha };
    },
  };
}
function fakeFb({ access = { ok: true, page_id: '1300936266441859', page_name: 'Matrix24global' }, post = { outcome: 'published', post_id: '1_2', photo_id: '2' } } = {}) {
  const calls = [];
  return {
    calls,
    async pageAccess() { calls.push('access'); return access; },
    async postPhoto(args) { calls.push(['post', args]); return post; },
  };
}
const run = o => runFacebook({ now: NOW, clock: () => NOW + 5000, newAttemptId: () => 'fb-att-1', ...o });

test('kill switch: live without both switches does nothing', async () => {
  const store = fakeStore([rec('a')]); const fb = fakeFb();
  assert.equal((await run({ mode: 'live', enabled: false, store, fb })).outcome, 'disabled');
  assert.equal((await run({ mode: 'live', enabled: 'true', store, fb })).outcome, 'disabled');
  assert.deepEqual(fb.calls, []); assert.equal(store.writes.length, 0);
});

test('dry-run checks page access but never writes or posts', async () => {
  const store = fakeStore([rec('a')]); const fb = fakeFb();
  const r = await run({ mode: 'dry-run', store, fb });
  assert.equal(r.outcome, 'would_post'); assert.equal(r.content_id, 'claude-20261007-a'); assert.equal(r.page, 'Matrix24global');
  assert.deepEqual(fb.calls, ['access']); assert.equal(store.writes.length, 0);
});

test('live: durable claim before the single post, then published with the post id', async () => {
  const store = fakeStore([rec('a')]); const fb = fakeFb();
  const order = [];
  const origWrite = store.write.bind(store);
  store.write = async (...a) => { order.push(`write:${a[0].facebook.status}`); return origWrite(...a); };
  const origPost = fb.postPhoto; fb.postPhoto = async args => { order.push('post'); return origPost(args); };
  const r = await run({ mode: 'live', enabled: true, store, fb });
  assert.equal(r.outcome, 'facebook_published'); assert.equal(r.post_id, '1_2');
  assert.deepEqual(order, ['write:publishing', 'post', 'write:published']);
  const saved = store.state.get('claude-20261007-a').record;
  assert.equal(saved.facebook.post_id, '1_2'); assert.equal(saved.facebook.attempt_id, 'fb-att-1');
  assert.deepEqual(validateLaneRecord(saved), []);
  // Instagram fields untouched
  assert.equal(saved.status, 'published'); assert.equal(saved.ig_media_id, '17876264127633767'); assert.equal(saved.publish_attempt_id, 'att-ig-a');
  const post = fb.calls.find(c => c[0] === 'post')[1];
  assert.match(post.caption, /🇪🇸 Texto/); assert.match(post.caption, /🇺🇸 English/); assert.equal(post.url, saved.image_url);
});

test('claim conflict: no post at all', async () => {
  const store = fakeStore([rec('a')]); const fb = fakeFb();
  store.write = async () => ({ ok: false, conflict: true });
  const r = await run({ mode: 'live', enabled: true, store, fb });
  assert.equal(r.outcome, 'claim_conflict');
  assert.equal(fb.calls.filter(c => c[0] === 'post').length, 0);
});

test('uncertain or rejected result is recorded once and never retried', async () => {
  for (const post of [{ outcome: 'publish_unknown', reason: 'network_error' }, { outcome: 'failed', reason: 'graph_error_200' }]) {
    const store = fakeStore([rec('a'), rec('b', { publishedAt: NOW - 5 * 60 * 1000 })]); const fb = fakeFb({ post });
    const r = await run({ mode: 'live', enabled: true, store, fb });
    assert.equal(r.outcome, `facebook_${post.outcome}`); assert.equal(r.content_id, 'claude-20261007-a');
    assert.equal(store.state.get('claude-20261007-a').record.facebook.status, post.outcome);
    // Next run never touches "a" again; it moves on to "b" after the spacing.
    const later = await runFacebook({ now: NOW + FB_MIN_SPACING_MS + 1000, clock: () => NOW, newAttemptId: () => 'fb-att-2', mode: 'live', enabled: true, store, fb });
    assert.equal(later.content_id, 'claude-20261007-b');
    assert.equal(fb.calls.filter(c => c[0] === 'post' && c[1].url.includes('-a.jpg')).length, 1);
  }
});

test('page access problem: nothing is claimed or posted', async () => {
  const store = fakeStore([rec('a')]); const fb = fakeFb({ access: { ok: false, reason: 'page_not_granted' } });
  const r = await run({ mode: 'live', enabled: true, store, fb });
  assert.equal(r.outcome, 'page_access_error'); assert.equal(r.reason, 'page_not_granted');
  assert.equal(store.writes.length, 0);
});

test('only Instagram-published stories from the last hour, oldest first, never back-fill', async () => {
  const store = fakeStore([
    rec('old', { publishedAt: NOW - FB_WINDOW_MS - 60000 }),
    rec('newer', { publishedAt: NOW - 5 * 60 * 1000 }),
    rec('older', { publishedAt: NOW - 30 * 60 * 1000 }),
    rec('ready', { status: 'ready_to_publish', publish_attempt_id: null, ig_media_id: null, history: [] }),
    rec('done', { facebook: { status: 'published', attempt_id: 'x', post_id: '9_9', reserved_at: iso(NOW - 3600e3) } }),
  ]);
  const r = await run({ mode: 'dry-run', store, fb: fakeFb() });
  assert.equal(r.content_id, 'claude-20261007-older'); assert.equal(r.waiting, 2);
  const none = fakeStore([rec('old', { publishedAt: NOW - FB_WINDOW_MS - 60000 })]);
  assert.equal((await run({ mode: 'dry-run', store: none, fb: fakeFb() })).outcome, 'no_candidate');
});

test('spacing between Facebook posts', async () => {
  const store = fakeStore([rec('a'), rec('b', { facebook: { status: 'published', attempt_id: 'x', post_id: '1_1', reserved_at: iso(NOW - 2 * 60 * 1000) } })]);
  const r = await run({ mode: 'live', enabled: true, store, fb: fakeFb() });
  assert.equal(r.outcome, 'spacing');
});

test('reconciled Instagram stories count as published for the mirror', () => {
  const r = rec('a'); r.history = [{ at: '2026-10-07T16:00:00Z', event: 'reconciled', ig_media_id: '1' }];
  assert.equal(instagramPublishedAt(r), Date.parse('2026-10-07T16:00:00Z'));
});

test('facebook transitions: forward only, never touching Instagram fields', () => {
  const a = rec('a');
  const pub = { ...a, facebook: { status: 'publishing', attempt_id: 'f1', reserved_at: iso(NOW) } };
  assert.ok(checkFacebookTransition(a, pub).ok);
  assert.ok(checkFacebookTransition(pub, { ...pub, facebook: { ...pub.facebook, status: 'published', post_id: '1_2' } }).ok);
  assert.equal(checkFacebookTransition(pub, { ...pub, facebook: { ...pub.facebook, status: 'published', attempt_id: 'f2' } }).ok, false);
  const failed = { ...pub, facebook: { ...pub.facebook, status: 'failed' } };
  assert.equal(checkFacebookTransition(failed, pub).ok, false); // no retry
  assert.equal(checkFacebookTransition(failed, a).ok, false);
  assert.equal(checkFacebookTransition(a, { ...pub, ig_media_id: '2' }).ok, false);
  assert.equal(checkFacebookTransition(a, { ...pub, status: 'publish_unknown' }).ok, false);
  // The Instagram transition check sees a Facebook write as a no-op on its own fields.
  assert.ok(checkLaneTransition(a, pub).ok);
});

test('record validation of the facebook sub-object', () => {
  const a = rec('a');
  assert.deepEqual(validateLaneRecord({ ...a, facebook: { status: 'published', attempt_id: 'f', post_id: '1_2' } }), []);
  assert.ok(validateLaneRecord({ ...a, facebook: { status: 'published', attempt_id: 'f' } }).includes('FACEBOOK_PUBLISHED_NEEDS_POST_ID'));
  assert.ok(validateLaneRecord({ ...a, facebook: { status: 'weird', attempt_id: 'f' } }).includes('BAD_FACEBOOK_STATUS'));
  const ready = rec('r', { status: 'ready_to_publish', publish_attempt_id: null, ig_media_id: null });
  assert.ok(validateLaneRecord({ ...ready, facebook: { status: 'publishing', attempt_id: 'f' } }).includes('FACEBOOK_BEFORE_INSTAGRAM_PUBLISHED'));
});

test('result classification: only clear rejections are "failed"', () => {
  assert.equal(classifyPostResult({ status: 200, body: { id: '123', post_id: '9_123' } }).post_id, '9_123');
  assert.equal(classifyPostResult({ status: 400, body: { error: { code: 200, type: 'OAuthException' } } }).outcome, 'failed');
  assert.equal(classifyPostResult({ status: 400, body: { error: { code: 2, is_transient: true } } }).outcome, 'publish_unknown');
  assert.equal(classifyPostResult({ status: 500, body: null }).outcome, 'publish_unknown');
  assert.equal(classifyPostResult({ status: 200, body: {} }).outcome, 'publish_unknown');
  assert.equal(classifyPostResult({ networkError: true }).outcome, 'publish_unknown');
});

test('client: page token resolved from the user token, tokens never in URLs', async () => {
  const seen = [];
  const fetchImpl = async (url, opts = {}) => {
    seen.push({ url, opts });
    if (url.includes('/me/accounts')) return { status: 200, json: async () => ({ data: [{ id: '1300936266441859', name: 'Matrix24global', tasks: ['CREATE_CONTENT'], access_token: 'PAGE-SECRET' }] }) };
    if (url.includes('/photos')) return { status: 200, json: async () => ({ id: '55', post_id: '1300936266441859_55' }) };
    throw new Error('unexpected');
  };
  const masked = [];
  const fb = createFacebookClient({ userToken: 'USER-SECRET', pageId: '1300936266441859', fetchImpl, onSecret: s => masked.push(s) });
  const access = await fb.pageAccess();
  assert.deepEqual(access, { ok: true, page_id: '1300936266441859', page_name: 'Matrix24global' });
  assert.equal(JSON.stringify(access).includes('SECRET'), false);
  assert.deepEqual(masked, ['PAGE-SECRET']);
  const r = await fb.postPhoto({ url: 'https://x/y.jpg', caption: 'c' });
  assert.equal(r.post_id, '1300936266441859_55');
  for (const s of seen) assert.equal(s.url.includes('SECRET'), false);
  assert.equal(seen[1].opts.method, 'POST'); assert.match(String(seen[1].opts.body), /access_token=PAGE-SECRET/);
});

test('client: page missing or without CREATE_CONTENT is refused', async () => {
  const mk = data => createFacebookClient({ userToken: 'u', pageId: '1300936266441859', fetchImpl: async () => ({ status: 200, json: async () => ({ data }) }) });
  assert.equal((await mk([]).pageAccess()).reason, 'page_not_granted');
  const other = await mk([{ id: '42', name: 'Other', tasks: ['CREATE_CONTENT'], access_token: 'SECRET' }]).pageAccess();
  assert.deepEqual(other.pages_returned, ['42:Other']); assert.equal(JSON.stringify(other).includes('SECRET'), false);
  assert.equal((await mk([{ id: '1300936266441859', tasks: ['ANALYZE'], access_token: 't' }]).pageAccess()).reason, 'page_missing_create_content');
  assert.equal((await createFacebookClient({ userToken: '', pageId: '1' }).pageAccess()).reason, 'missing_user_token');
});
