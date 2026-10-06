import test from 'node:test';
import assert from 'node:assert/strict';
import { runPublisher, DAILY_CAP } from '../scripts/claude-lane/publisher.mjs';
import { findDuplicate } from '../scripts/claude-lane/dedupe.mjs';
import { fsReadOnlyStore } from '../scripts/claude-lane/run-publisher.mjs';
import { checkLaneTransition } from '../scripts/claude-lane/lane-record.mjs';

const NOW = Date.parse('2026-10-06T15:00:00Z');
const rec = (id, patch = {}) => ({
  lane: 'claude', content_id: `claude-20261006-${id}`, status: 'ready_to_publish',
  created_at: '2026-10-06T12:00:00Z', headline: `Volcano erupts near ${id} village forcing evacuations`,
  caption_es: 'Texto en español.', caption_en: 'English text.',
  source_urls: [`https://reuters.com/${id}`, `https://apnews.com/${id}`], source_names: ['Reuters', 'AP'],
  hashtags: ['#MATRIX24'], image_url: `https://x.supabase.co/${id}.jpg`,
  publish_attempt_id: null, ig_media_id: null, history: [], ...patch,
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
      writes.push({ status: record.status, message });
      return { ok: true, sha: nsha };
    },
  };
}

function fakeIg({ container = { ok: true, containerId: '1' }, ready = { ok: true }, publish = { outcome: 'published', mediaId: '999' }, feed = [] } = {}) {
  const calls = [];
  return {
    calls,
    async listRecentMedia() { calls.push('feed'); return feed; },
    async createContainer() { calls.push('container'); return container; },
    async waitContainer() { calls.push('wait'); return ready; },
    async publishContainer() { calls.push('publish'); return publish; },
    async getMedia() { calls.push('getMedia'); return { permalink: 'https://www.instagram.com/p/x/' }; },
  };
}
const quota = async () => ({ total: 100, used: 5 });
const run = (o) => runPublisher({ now: NOW, newAttemptId: () => 'att-1', readQuota: quota, ...o });

test('kill switch: live mode without CLAUDE_LANE_ENABLED does nothing', async () => {
  const store = fakeStore([rec('a')]); const ig = fakeIg();
  assert.equal((await run({ mode: 'live', enabled: false, store, ig })).outcome, 'disabled');
  assert.equal((await run({ mode: 'live', enabled: 'true', store, ig })).outcome, 'disabled');
  assert.deepEqual(ig.calls, []); assert.equal(store.writes.length, 0);
});

test('dry-run never writes and never creates or publishes', async () => {
  const store = fakeStore([rec('a')]); const ig = fakeIg();
  const r = await run({ mode: 'dry-run', store, ig });
  assert.equal(r.outcome, 'would_publish');
  assert.match(r.caption, /🇪🇸 Texto/); assert.match(r.caption, /🇺🇸 English/);
  assert.deepEqual(ig.calls, ['feed']); assert.equal(store.writes.length, 0);
});

test('live happy path: claim is written before any Instagram call, publish exactly once', async () => {
  const store = fakeStore([rec('a')]); const ig = fakeIg();
  const order = [];
  const w = store.write.bind(store);
  store.write = async (...a) => { order.push(`write:${a[0].status}`); return w(...a); };
  const igc = { ...ig, async createContainer(x) { order.push('container'); return ig.createContainer(x); } };
  const r = await run({ mode: 'live', enabled: true, store, ig: igc });
  assert.equal(r.outcome, 'published'); assert.equal(r.ig_media_id, '999');
  assert.equal(order[0], 'write:publishing'); assert.equal(order[1], 'container');
  assert.equal(ig.calls.filter(c => c === 'publish').length, 1);
  assert.equal(store.state.get('claude-20261006-a').record.status, 'published');
});

test('ambiguous publish becomes publish_unknown and blocks the lane (no blind retry)', async () => {
  const store = fakeStore([rec('a'), rec('b', { created_at: '2026-10-06T13:00:00Z', headline: 'Unrelated election results announced in capital today' })]);
  const ig = fakeIg({ publish: { outcome: 'unknown', reason: 'publish_http_500' } });
  assert.equal((await run({ mode: 'live', enabled: true, store, ig })).outcome, 'publish_unknown');
  const ig2 = fakeIg();
  const r = await run({ mode: 'live', enabled: true, store, ig: ig2 });
  assert.equal(r.outcome, 'unresolved_attempt');
  assert.deepEqual(ig2.calls, []);
});

test('container failure releases the claim with not_invoked proof and never publishes', async () => {
  const store = fakeStore([rec('a')]); const ig = fakeIg({ container: { ok: false, reason: 'container_http_400' } });
  const r = await run({ mode: 'live', enabled: true, store, ig });
  assert.equal(r.outcome, 'not_invoked');
  assert.equal(ig.calls.includes('publish'), false);
  const after = store.state.get('claude-20261006-a').record;
  assert.equal(after.status, 'ready_to_publish'); assert.equal(after.publish_attempt_id, null);
  assert.equal(after.history.at(-1).event, 'not_invoked');
});

test('container never ready also releases without publishing', async () => {
  const store = fakeStore([rec('a')]); const ig = fakeIg({ ready: { ok: false, reason: 'container_not_ready' } });
  assert.equal((await run({ mode: 'live', enabled: true, store, ig })).outcome, 'not_invoked');
  assert.equal(ig.calls.includes('publish'), false);
});

test('release without not_invoked proof is rejected by the transition table', () => {
  const p = rec('a', { status: 'publishing', publish_attempt_id: 'att-1' });
  assert.equal(checkLaneTransition(p, rec('a')).ok, false);
  assert.equal(checkLaneTransition(p, rec('a', { history: [{ event: 'not_invoked', publish_attempt_id: 'other' }] })).ok, false);
  assert.equal(checkLaneTransition(p, rec('a', { history: [{ event: 'not_invoked', publish_attempt_id: 'att-1' }] })).ok, true);
});

test('claim conflict stops before Instagram', async () => {
  const store = fakeStore([rec('a')]); const ig = fakeIg();
  store.write = async () => ({ ok: false, conflict: true });
  assert.equal((await run({ mode: 'live', enabled: true, store, ig })).outcome, 'claim_conflict');
  assert.deepEqual(ig.calls, ['feed']);
});

test('daily cap and quota floor', async () => {
  const done = Array.from({ length: DAILY_CAP }, (_, i) => rec(`p${i}`, {
    status: 'published', publish_attempt_id: `x${i}`, ig_media_id: `${i + 1}`, reserved_at: '2026-10-06T01:00:00Z',
    headline: `Story number ${i} about different topic entirely`,
  }));
  assert.equal((await run({ mode: 'live', enabled: true, store: fakeStore([...done, rec('a')]), ig: fakeIg() })).outcome, 'daily_cap');
  assert.equal((await run({ mode: 'live', enabled: true, store: fakeStore([rec('a')]), ig: fakeIg(), readQuota: async () => ({ total: 100, used: 95 }) })).outcome, 'quota_low');
  assert.equal((await run({ mode: 'live', enabled: true, store: fakeStore([rec('a')]), ig: fakeIg(), readQuota: async () => { throw new Error('x'); } })).outcome, 'quota_unknown');
});

test('unreadable feed is unknown, never "no duplicate"', async () => {
  const ig = fakeIg(); ig.listRecentMedia = async () => { throw new Error('READ_HTTP'); };
  const store = fakeStore([rec('a')]);
  assert.equal((await run({ mode: 'live', enabled: true, store, ig })).outcome, 'feed_unknown');
  assert.equal(store.writes.length, 0);
});

test('duplicates against the Core v2 queue are skipped, not published', async () => {
  const store = fakeStore([rec('a')]); const ig = fakeIg();
  const others = [{ id: 'matrix24-x', headline: 'Something else', source_urls: ['https://www.reuters.com/a/'] }];
  const r = await run({ mode: 'live', enabled: true, store, ig, others });
  assert.equal(r.outcome, 'skipped_duplicate'); assert.equal(r.duplicate.reason, 'shared_source_url');
  assert.equal(ig.calls.includes('container'), false);
});

test('dedupe: similar headline and recent similar post', () => {
  const r = rec('a');
  assert.equal(findDuplicate(r, { others: [{ id: 'q', headline: 'Volcano erupts near a village, forcing evacuations', source_urls: [] }] }).reason, 'similar_headline');
  const feed = [{ id: '1', timestamp: '2026-10-06T10:00:00Z', caption: '🇺🇸 Volcano erupts near a village forcing mass evacuations' }];
  assert.equal(findDuplicate(r, { feed, now: NOW }).reason, 'similar_recent_post');
  const old = [{ ...feed[0], timestamp: '2026-10-01T10:00:00Z' }];
  assert.equal(findDuplicate(r, { feed: old, now: NOW }), null);
  assert.equal(findDuplicate(r, { others: [{ id: 'q', headline: 'Central bank holds interest rates steady', source_urls: [] }] }), null);
});

test('isolation: the lane store cannot point at the Core v2 queue', () => {
  assert.throws(() => fsReadOnlyStore('queue'), /LANE_STORE_OUTSIDE_LANE_DIR/);
  assert.doesNotThrow(() => fsReadOnlyStore('claude-lane/queue'));
});

test('results never carry the access token', async () => {
  const r = await run({ mode: 'dry-run', store: fakeStore([rec('a')]), ig: fakeIg() });
  assert.equal(JSON.stringify(r).includes('Bearer'), false);
});

test('step 2 workflow is dry-run only: no write permission, no schedule, live refused', async () => {
  const fs = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const wf = fs.readFileSync('.github/workflows/claude-lane-publisher.yml', 'utf8');
  assert.equal(/contents:\s*write/.test(wf), false);
  assert.equal(/\bschedule\s*:/.test(wf), false);
  assert.match(wf, /CLAUDE_LANE_MODE: dry-run/);
  assert.throws(() => execFileSync('node', ['scripts/claude-lane/run-publisher.mjs'], {
    env: { ...process.env, CLAUDE_LANE_MODE: 'live' }, stdio: 'pipe' }));
});
