import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyReelRecord, dailyReelId, preflight, runDailyReelPublish,
} from '../scripts/claude-lane/daily-reel-publish.mjs';
import { MIN_SPACING_MS } from '../scripts/claude-lane/publisher.mjs';
import { validateLaneRecord, composeCaption } from '../scripts/claude-lane/lane-record.mjs';
import { runFacebook } from '../scripts/claude-lane/facebook.mjs';

const NOW = Date.parse('2026-11-11T19:07:00Z');
const ID = 'claude-20261111-daily-reel';
const story = (k, patch = {}) => ({
  content_id: `claude-20261111-story-${k}`, headline: `English headline ${k}`, headline_es: `Titular en español ${k}`,
  source_urls: [`https://reuters.com/${k}`, `https://apnews.com/${k}`], source_names: ['Reuters', 'AP'],
  hashtags: ['#MATRIX24', `#Tag${k}`], ...patch,
});
const draft = (patch = {}) => buildDailyReelRecord({
  contentId: ID, createdAt: '2026-11-11T19:08:00.000Z', stories: [story('a'), story('b'), story('c'), story('d')],
  videoUrl: `https://raw.githubusercontent.com/o/r/main/claude-lane/media/reels/${ID}.mp4`,
  imageUrl: `https://raw.githubusercontent.com/o/r/main/claude-lane/media/${ID}.jpg`, totalSeconds: 80, ...patch,
});
const old = (id, patch = {}) => ({
  lane: 'claude', content_id: id, status: 'published', created_at: '2026-11-10T05:00:00Z', headline: 'Old story',
  caption_es: 'x', caption_en: 'y', source_urls: ['https://reuters.com/o', 'https://apnews.com/o'], source_names: ['Reuters', 'AP'],
  hashtags: [], image_url: 'https://raw.githubusercontent.com/o/r/main/claude-lane/media/o.jpg', publish_attempt_id: 'a0',
  ig_media_id: '1', reserved_at: '2026-11-11T05:25:58.440Z', history: [], ...patch,
});

function fakeStore(records = []) {
  const state = new Map(records.map(r => [r.content_id, { record: r, sha: `sha-${r.content_id}-0` }]));
  const writes = [];
  return {
    writes, state,
    async list() { return [...state.values()].map(e => ({ ...e })); },
    async write(record, sha, message, files = []) {
      const cur = state.get(record.content_id);
      if ((cur?.sha ?? null) !== (sha ?? null)) return { ok: false, conflict: true };
      const nsha = `sha-${record.content_id}-${writes.length + 1}`;
      state.set(record.content_id, { record, sha: nsha });
      writes.push({ status: record.status, message, files: files.map(f => f.path), errors: validateLaneRecord(record) });
      return { ok: true, sha: nsha };
    },
  };
}
function fakeIg({ container = { ok: true, containerId: '7' }, ready = { ok: true }, publish = { outcome: 'published', mediaId: '999' } } = {}) {
  const calls = [];
  return {
    calls,
    async createReelContainer(a) { calls.push(['reel', a.videoUrl]); return container; },
    async waitContainer() { calls.push('wait'); return ready; },
    async publishContainer() { calls.push('publish'); return publish; },
    async getMedia() { calls.push('getMedia'); return { permalink: 'https://www.instagram.com/reel/x/' }; },
  };
}
const quota = async () => ({ total: 100, used: 5 });
const files = [{ path: `claude-lane/media/reels/${ID}.mp4`, buffer: Buffer.from('mp4') }, { path: `claude-lane/media/${ID}.jpg`, buffer: Buffer.from('jpg') }];
const run = o => runDailyReelPublish({ now: NOW, clock: () => NOW + 1000, newAttemptId: () => 'att-1', readQuota: quota, record: draft(), files, ...o });

test('daily id is the UTC day', () => {
  assert.equal(dailyReelId(NOW), ID);
  assert.equal(dailyReelId(Date.parse('2026-11-11T23:59:59Z')), ID);
  assert.equal(dailyReelId(Date.parse('2026-11-12T00:00:00Z')), 'claude-20261112-daily-reel');
});

test('record builder: schema-valid lane record with bilingual numbered captions and union of sources', () => {
  const d = draft();
  assert.deepEqual(validateLaneRecord(d), []);
  assert.equal(d.media_format, 'reel');
  assert.match(d.caption_es, /1️⃣ Titular en español a/); assert.match(d.caption_en, /4️⃣ English headline d/);
  assert.equal(d.source_urls.length, 8); assert.deepEqual(d.source_names, ['Reuters', 'AP']);
  assert.ok(d.hashtags.includes('#matrix24') && !d.hashtags.includes('#MATRIX24'), 'case-insensitive tag dedupe');
  assert.deepEqual(d.daily_reel.story_ids, ['claude-20261111-story-a', 'claude-20261111-story-b', 'claude-20261111-story-c', 'claude-20261111-story-d']);
  assert.ok(composeCaption(d).length < 2200);
  // Lane drafts carry the English headline as `headline`; a missing Spanish one falls back to it.
  assert.match(draft({ stories: [story('a', { headline_es: '' }), story('b')] }).caption_es, /1️⃣ English headline a/);
});

test('AI note when any used story card is an AI illustration', () => {
  assert.equal(draft().ai_illustration, undefined);
  assert.equal(draft({ stories: [story('a'), story('b', { ai_illustration: true })] }).ai_illustration, true);
});

test('kill switch: live without enabled does nothing', async () => {
  const store = fakeStore(); const ig = fakeIg();
  assert.equal((await run({ mode: 'live', enabled: false, store, ig })).outcome, 'disabled');
  assert.equal((await run({ mode: 'live', enabled: 'true', store, ig })).outcome, 'disabled');
  assert.deepEqual(ig.calls, []); assert.equal(store.writes.length, 0);
});

test('dry-run never writes or calls Instagram', async () => {
  const store = fakeStore(); const ig = fakeIg();
  const r = await run({ mode: 'dry-run', store, ig });
  assert.equal(r.outcome, 'would_publish'); assert.match(r.caption, /🇪🇸 Resumen del día/);
  assert.deepEqual(ig.calls, []); assert.equal(store.writes.length, 0);
});

test('live: durable claim with MP4 + cover BEFORE any Instagram call, one publish, published record', async () => {
  const store = fakeStore([old('claude-20261110-x')]);
  const order = [];
  const ig = fakeIg();
  const origWrite = store.write;
  store.write = async (...a) => { order.push(`write:${a[0].status}`); return origWrite(...a); };
  const origReel = ig.createReelContainer;
  ig.createReelContainer = async a => { order.push('container'); return origReel(a); };
  const r = await run({ mode: 'live', enabled: true, store, ig });
  assert.equal(r.outcome, 'published'); assert.equal(r.ig_media_id, '999');
  assert.deepEqual(order.slice(0, 2), ['write:publishing', 'container']);
  assert.deepEqual(store.writes[0].files, files.map(f => f.path));
  assert.equal(ig.calls.filter(c => c === 'publish').length, 1);
  const rec = store.state.get(ID).record;
  assert.equal(rec.status, 'published'); assert.equal(rec.publish_attempt_id, 'att-1');
  assert.deepEqual(rec.history.map(h => h.event), ['rendered', 'reserved', 'published']);
  for (const w of store.writes) assert.deepEqual(w.errors, [], `every written record is schema-valid (${w.status})`);
});

test('second slot the same day: record exists in any status -> nothing happens', async () => {
  for (const status of ['published', 'ready_to_publish', 'discarded', 'skipped_duplicate']) {
    const store = fakeStore([old(ID, { status, reserved_at: '2026-11-11T14:10:00Z' })]); const ig = fakeIg();
    const r = await run({ mode: 'live', enabled: true, store, ig });
    assert.equal(r.outcome, 'already_exists', status);
    assert.deepEqual(ig.calls, []); assert.equal(store.writes.length, 0);
  }
});

test('lane blocked by any publishing / publish_unknown record -> nothing happens', async () => {
  for (const status of ['publishing', 'publish_unknown']) {
    const store = fakeStore([old('claude-20261111-other', { status, ig_media_id: null })]); const ig = fakeIg();
    const r = await run({ mode: 'live', enabled: true, store, ig });
    assert.equal(r.outcome, 'unresolved_attempt'); assert.deepEqual(r.ids, ['claude-20261111-other']);
    assert.deepEqual(ig.calls, []); assert.equal(store.writes.length, 0);
  }
});

test('spacing and quota floors', async () => {
  const recent = fakeStore([old('claude-20261111-y', { reserved_at: new Date(NOW - MIN_SPACING_MS + 60000).toISOString() })]);
  assert.equal((await run({ mode: 'live', enabled: true, store: recent, ig: fakeIg() })).outcome, 'spacing');
  const low = await run({ mode: 'live', enabled: true, store: fakeStore(), ig: fakeIg(), readQuota: async () => ({ total: 100, used: 95 }) });
  assert.equal(low.outcome, 'quota_low');
  const unk = await run({ mode: 'live', enabled: true, store: fakeStore(), ig: fakeIg(), readQuota: async () => { throw new Error('x'); } });
  assert.equal(unk.outcome, 'quota_unknown');
});

test('claim conflict (another writer created the record) -> no Instagram call', async () => {
  const store = fakeStore(); const ig = fakeIg();
  store.list = async () => []; // stale view
  store.state.set(ID, { record: old(ID), sha: 'other' });
  const r = await run({ mode: 'live', enabled: true, store, ig });
  assert.equal(r.outcome, 'claim_conflict'); assert.deepEqual(ig.calls, []);
});

test('container failure releases the claim with not_invoked proof; publish never called', async () => {
  const store = fakeStore(); const ig = fakeIg({ ready: { ok: false, reason: 'container_error' } });
  const r = await run({ mode: 'live', enabled: true, store, ig });
  assert.equal(r.outcome, 'not_invoked');
  assert.ok(!ig.calls.includes('publish'));
  const rec = store.state.get(ID).record;
  assert.equal(rec.status, 'ready_to_publish'); assert.equal(rec.publish_attempt_id, null);
  assert.equal(rec.history.at(-1).event, 'not_invoked');
  // The day is then done: a later slot does not retry.
  assert.equal((await run({ mode: 'live', enabled: true, store, ig: fakeIg() })).outcome, 'already_exists');
});

test('ambiguous publish -> publish_unknown, never retried, lane blocked', async () => {
  const store = fakeStore(); const ig = fakeIg({ publish: { outcome: 'unknown', reason: 'publish_http_500_code_2' } });
  const r = await run({ mode: 'live', enabled: true, store, ig });
  assert.equal(r.outcome, 'publish_unknown');
  assert.equal(ig.calls.filter(c => c === 'publish').length, 1);
  assert.equal(store.state.get(ID).record.status, 'publish_unknown');
  assert.equal(preflight(await store.list(), { contentId: 'claude-20261112-daily-reel', now: NOW + 86400000 }).outcome, 'unresolved_attempt');
});

test('invalid record (e.g. one source) fails before any write or call', async () => {
  const store = fakeStore(); const ig = fakeIg();
  const bad = draft({ stories: [story('a', { source_urls: ['https://reuters.com/a'] })] });
  await assert.rejects(run({ mode: 'live', enabled: true, store, ig, record: bad }), /INVALID_LANE_RECORD/);
  assert.deepEqual(ig.calls, []); assert.equal(store.writes.length, 0);
});

test('Facebook mirror skips Reel records (it posts photos only)', async () => {
  const at = NOW - 10 * 60 * 1000;
  const reel = { ...draft(), status: 'published', publish_attempt_id: 'att-1', ig_media_id: '999', reserved_at: new Date(at - 60000).toISOString(),
    history: [{ at: new Date(at - 60000).toISOString(), event: 'reserved' }, { at: new Date(at).toISOString(), event: 'published', ig_media_id: '999' }] };
  const store = fakeStore([reel]);
  const fb = { calls: [], async pageAccess() { this.calls.push('access'); return { ok: true }; }, async postPhoto() { this.calls.push('post'); return { outcome: 'published', post_id: '1_2' }; } };
  const r = await runFacebook({ mode: 'live', enabled: true, store, fb, now: NOW, clock: () => NOW });
  assert.equal(r.outcome, 'no_candidate'); assert.ok(!fb.calls.includes('post'));
});
