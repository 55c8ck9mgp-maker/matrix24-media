import test from 'node:test';
import assert from 'node:assert/strict';
import { discardUnknown, feedMatches } from '../scripts/claude-lane/discard.mjs';
import { checkLaneTransition, validateLaneRecord, composeCaption, isOwnerDiscard } from '../scripts/claude-lane/lane-record.mjs';
import { runPublisher } from '../scripts/claude-lane/publisher.mjs';
import { reconcile } from '../scripts/claude-lane/reconcile.mjs';
import { createInstagramClient } from '../scripts/instagram-graph.mjs';

const NOW = Date.parse('2026-10-08T13:00:00Z');
const ATTEMPT = '1e72bc59-4ace-4b5a-b4e8-79450bc5b35c';
const unknown = (patch = {}) => ({
  lane: 'claude', content_id: 'claude-20261008-north-korea-rejects-aid', status: 'publish_unknown',
  created_at: '2026-10-08T07:35:35Z', headline: 'North Korea rejects Seoul medical aid',
  headline_es: 'Corea del Norte rechaza la ayuda médica de Seúl como una farsa',
  caption_es: 'Kim Yo Jong calificó de farsa la oferta de ayuda médica de Corea del Sur.',
  caption_en: 'Kim Yo Jong called South Korea\'s medical aid offer a farce.',
  source_urls: ['https://reuters.com/a', 'https://apnews.com/b'], source_names: ['Reuters', 'AP'],
  hashtags: ['#MATRIX24'], image_url: 'https://raw.githubusercontent.com/x/y/main/a.jpg',
  publish_attempt_id: ATTEMPT, ig_media_id: null, reserved_at: '2026-10-08T07:51:41.756Z',
  history: [{ at: '2026-10-08T07:51:48Z', event: 'publish_unknown', publish_attempt_id: ATTEMPT, reason: 'publish_http_400' }],
  ...patch,
});
const ready = id => {
  const { reserved_at, headline_es, ...r } = unknown({ content_id: `claude-20261008-${id}`, status: 'ready_to_publish',
    publish_attempt_id: null, history: [], headline: 'Volcano erupts in Iceland forcing evacuations',
    caption_es: 'Un volcán entra en erupción en Islandia y obliga a evacuar.', caption_en: 'A volcano erupts in Iceland, forcing evacuations.',
    source_urls: [`https://bbc.com/${id}`, `https://dw.com/${id}`], source_names: ['BBC', 'DW'] });
  return r;
};
const other = (id, ts, caption = 'Otra noticia distinta sobre economía mundial y mercados.') => ({ id, timestamp: ts, caption });
const oldFeed = [other('1', '2026-10-08T06:30:00+0000'), other('2', '2026-10-07T20:00:00+0000')];

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
const fakeIg = (feed, calls = []) => ({
  calls,
  async listRecentMedia() { calls.push('feed'); if (feed instanceof Error) throw feed; return feed; },
  async createContainer() { calls.push('container'); return { ok: true, containerId: '1' }; },
  async waitContainer() { calls.push('wait'); return { ok: true }; },
  async publishContainer() { calls.push('publish'); return { outcome: 'published', mediaId: '999' }; },
  async getMedia() { return { permalink: 'https://instagram.com/p/x' }; },
});
const args = (store, ig, patch = {}) => ({ store, ig, contentId: unknown().content_id, confirm: unknown().content_id,
  decidedBy: 'justen', reason: 'not in feed', now: NOW, live: true, ...patch });

test('discards a publish_unknown with a complete feed read and no match, never calling publish', async () => {
  const store = fakeStore([unknown()]); const ig = fakeIg(oldFeed);
  const r = await discardUnknown(args(store, ig));
  assert.equal(r.outcome, 'discarded');
  const rec = store.state.get(unknown().content_id).record;
  assert.equal(rec.status, 'discarded');
  assert.equal(rec.publish_attempt_id, ATTEMPT);
  assert.equal(rec.ig_media_id, null);
  const last = rec.history.at(-1);
  assert.equal(last.event, 'owner_discard'); assert.equal(last.decided_by, 'justen'); assert.equal(last.feed_matches, 0);
  assert.deepEqual(validateLaneRecord(rec), []);
  assert.deepEqual(ig.calls, ['feed']);
});

test('dry run writes nothing', async () => {
  const store = fakeStore([unknown()]);
  const r = await discardUnknown(args(store, fakeIg(oldFeed), { live: false }));
  assert.equal(r.outcome, 'would_discard');
  assert.equal(store.writes.length, 0);
});

test('refuses when the post (or anything like it) is in the feed', async () => {
  const exact = { id: '55', timestamp: '2026-10-08T07:52:00+0000', caption: `${composeCaption(unknown())}\n#MATRIX24` };
  const loose = { id: '56', timestamp: '2026-10-08T07:52:00+0000', caption: 'Kim Yo Jong calificó de farsa la oferta de ayuda médica de Corea del Sur. (editado)' };
  for (const hit of [exact, loose]) {
    const store = fakeStore([unknown()]);
    const r = await discardUnknown(args(store, fakeIg([hit, ...oldFeed])));
    assert.equal(r.why, 'possible_match_in_feed');
    assert.equal(store.writes.length, 0);
  }
});

test('refuses on an unreadable, empty or too-short feed (absence is never assumed)', async () => {
  for (const [feed, why] of [[new Error('x'), 'feed_unknown'], [[], 'feed_empty'],
    [[other('9', '2026-10-08T08:00:00+0000')], 'feed_window_too_short'], [[{ id: '9', caption: 'x' }], 'feed_window_too_short']]) {
    const store = fakeStore([unknown()]);
    const r = await discardUnknown(args(store, fakeIg(feed)));
    assert.equal(r.why, why);
    assert.equal(store.writes.length, 0);
  }
});

test('refuses without exact confirmation, decider, the right status, or enough age', async () => {
  const cases = [
    [{ confirm: 'claude-20261008-other' }, [unknown()], 'confirmation_mismatch'],
    [{ decidedBy: ' ' }, [unknown()], 'missing_decided_by'],
    [{}, [unknown({ status: 'publishing', history: [] })], 'status_publishing'],
    [{}, [unknown({ status: 'published', ig_media_id: '1' })], 'status_published'],
    [{ now: Date.parse('2026-10-08T07:55:00Z') }, [unknown()], 'too_recent'],
    [{ contentId: 'claude-20261008-missing', confirm: 'claude-20261008-missing' }, [unknown()], 'not_found'],
  ];
  for (const [patch, recs, why] of cases) {
    const store = fakeStore(recs);
    const r = await discardUnknown(args(store, fakeIg(oldFeed), patch));
    assert.equal(r.why, why);
    assert.equal(store.writes.length, 0);
  }
});

test('transition publish_unknown -> discarded needs the owner record for the same attempt', () => {
  const prev = unknown();
  const good = { ...prev, status: 'discarded', history: [...prev.history,
    { at: 'x', event: 'owner_discard', publish_attempt_id: ATTEMPT, decided_by: 'justen', feed_checked: 2, feed_matches: 0 }] };
  assert.equal(checkLaneTransition(prev, good).ok, true);
  assert.equal(checkLaneTransition(prev, { ...prev, status: 'discarded' }).error, 'DISCARD_NEEDS_OWNER_RECORD');
  const bad = (h) => checkLaneTransition(prev, { ...good, history: [...prev.history, { ...good.history.at(-1), ...h }] }).error;
  assert.equal(bad({ publish_attempt_id: 'other' }), 'DISCARD_NEEDS_OWNER_RECORD');
  assert.equal(bad({ feed_matches: 1 }), 'DISCARD_NEEDS_OWNER_RECORD');
  assert.equal(bad({ feed_checked: 0 }), 'DISCARD_NEEDS_OWNER_RECORD');
  assert.equal(bad({ decided_by: '' }), 'DISCARD_NEEDS_OWNER_RECORD');
  assert.equal(checkLaneTransition(prev, { ...good, publish_attempt_id: 'new' }).error, 'ATTEMPT_ID_CHANGED');
  assert.equal(checkLaneTransition(prev, { ...good, ig_media_id: '1' }).error, 'UNEXPECTED_MEDIA_ID');
  assert.equal(isOwnerDiscard(good.history.at(-1), ATTEMPT), true);
});

test('discarded is terminal: no way back to ready_to_publish, publishing or published', () => {
  const d = { ...unknown(), status: 'discarded' };
  for (const status of ['ready_to_publish', 'publishing', 'published', 'publish_unknown']) {
    assert.equal(checkLaneTransition(d, { ...d, status }).ok, false, status);
  }
  for (const from of ['draft', 'ready_to_publish', 'publishing', 'published']) {
    assert.equal(checkLaneTransition({ ...d, status: from }, d).ok, false, from);
  }
});

test('a discarded record without the owner entry fails validation', () => {
  assert.ok(validateLaneRecord({ ...unknown(), status: 'discarded' }).includes('DISCARD_NEEDS_OWNER_RECORD'));
});

test('after the discard the lane unblocks, and the discarded story is not reconciled or republished', async () => {
  const store = fakeStore([unknown(), ready('next-story')]);
  const ig = fakeIg(oldFeed);
  const blocked = await runPublisher({ mode: 'live', enabled: true, store, ig, readQuota: async () => ({ total: 100, used: 0 }), others: [], now: NOW });
  assert.equal(blocked.outcome, 'unresolved_attempt');
  assert.equal((await discardUnknown(args(store, ig))).outcome, 'discarded');
  assert.equal((await reconcile({ store, ig, now: NOW, live: true })).outcome, 'nothing_to_reconcile');
  const r = await runPublisher({ mode: 'live', enabled: true, store, ig, readQuota: async () => ({ total: 100, used: 0 }), others: [], now: NOW });
  assert.equal(r.outcome, 'published');
  assert.equal(r.content_id, 'claude-20261008-next-story');
  assert.equal(store.state.get(unknown().content_id).record.status, 'discarded');
});

test('feedMatches ignores unrelated posts', () => {
  assert.equal(feedMatches(unknown(), oldFeed).length, 0);
});

test('publish failure reason carries numeric Meta error codes only and stays unknown', async () => {
  const fetchImpl = async () => ({ status: 400, ok: false,
    json: async () => ({ error: { code: 9007, error_subcode: 2207027, message: 'Media ID is not available', fbtrace_id: 'abc' } }) });
  const ig = createInstagramClient({ accessToken: 'x'.repeat(30), igUserId: '123', fetchImpl });
  const r = await ig.publishContainer('1');
  assert.deepEqual(r, { outcome: 'unknown', reason: 'publish_http_400_code_9007_sub_2207027' });
  const ig2 = createInstagramClient({ accessToken: 'x'.repeat(30), igUserId: '123',
    fetchImpl: async () => ({ status: 500, ok: false, json: async () => { throw new Error('no json'); } }) });
  assert.deepEqual(await ig2.publishContainer('1'), { outcome: 'unknown', reason: 'publish_http_500' });
});
