import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyQueueWrite } from '../scripts/queue-transition-ownership.mjs';
import { gitBlobSha, serializeRecord } from '../scripts/github-queue-cas.mjs';
import { buildInstagramCaption, captionMatchesRecord } from '../scripts/instagram-graph.mjs';
import {
  assertOwnerGate, buildRelease, buildReservation, planPublication, publishApproved, PROVIDER
} from '../scripts/claude-publisher.mjs';

const id = 'matrix24-20990101-fixture-story';
const caption = 'Fixture headline sentence that is long enough to identify one story on its own. Second sentence.';
const ready = {
  content_id: id, status: 'ready_to_publish', headline: 'Fixture', caption, hashtags: ['#MATRIX24', '#Fixture'],
  verification_status: 'verified_claim_consensus',
  editorial_promotion: { manifest_path: 'm', draft_path: 'd', draft_sha256: 'x' },
  public_image_url: 'https://example.test/a.jpg',
  image_spec: { format: 'JPEG', mode: 'RGB', width: 1080, height: 1350, alpha: false },
  media_ready_at: '2099-01-01T00:00:00.000Z',
  publish_attempt_history: [{ timestamp: '2099-01-01T00:00:00.000Z', stage: 'media_pipeline', result: 'success' }]
};
const sha = gitBlobSha(serializeRecord(ready));

function fakeQueue(record, { conflictOn = null } = {}) {
  const state = { record: structuredClone(record), sha: gitBlobSha(serializeRecord(record)), writes: [] };
  return {
    state,
    async read() { return { exists: true, sha: state.sha, record: structuredClone(state.record) }; },
    async write(_p, next, expectedSha) {
      const n = state.writes.length + 1;
      if (expectedSha !== state.sha || conflictOn === n) return { ok: false, reason: 'sha_conflict' };
      state.record = structuredClone(next);
      state.sha = gitBlobSha(serializeRecord(next));
      state.writes.push(next.status);
      return { ok: true, sha: state.sha };
    }
  };
}

function fakeInstagram({ feed = [], feedThrows = false, container = { ok: true, containerId: '555' }, ready = { ok: true },
  publish = { outcome: 'published', mediaId: '17900000000000001' } } = {}) {
  const calls = [];
  return {
    calls,
    async listRecentMedia() { calls.push('list'); if (feedThrows) throw Object.assign(new Error('x'), { code: 'READ_HTTP' }); return feed; },
    async createContainer() { calls.push('container'); return container; },
    async waitContainer() { calls.push('wait'); return ready; },
    async publishContainer() { calls.push('publish'); return publish; },
    async getMedia(mid) { calls.push('get'); return { id: mid, permalink: 'https://www.instagram.com/p/abc/' }; }
  };
}

const run = (queue, instagram, extra = {}) => publishApproved({
  contentId: id, expectedSha: sha, approval: { test: true }, queue, instagram,
  now: () => '2099-01-01T01:00:00.000Z', newAttemptId: () => '11111111-1111-4111-8111-111111111111', ...extra
});

test('approved happy path: reserve, publish once, write published with real media ID', async () => {
  const q = fakeQueue(ready);
  const ig = fakeInstagram();
  const r = await run(q, ig);
  assert.equal(r.result, 'published');
  assert.equal(r.written, 'published');
  assert.deepEqual(q.state.writes, ['publishing', 'published']);
  assert.deepEqual(ig.calls.filter(c => c === 'publish'), ['publish']);
  assert.equal(q.state.record.instagram_media_id, '17900000000000001');
  assert.equal(q.state.record.provider, PROVIDER);
  assert.ok(ig.calls.indexOf('list') < ig.calls.indexOf('container'), 'feed checked before any send');
});

test('record changed since Claude reviewed it: nothing written, nothing sent', async () => {
  const q = fakeQueue({ ...ready, caption: `${caption} edited` });
  const ig = fakeInstagram();
  const r = await run(q, ig);
  assert.equal(r.gate, 'sha_changed_since_review');
  assert.deepEqual(q.state.writes, []);
  assert.deepEqual(ig.calls, []);
});

test('existing post with the same caption blocks the send (no duplicate publication)', async () => {
  const q = fakeQueue(ready);
  const ig = fakeInstagram({ feed: [{ id: '1790', caption: `${caption}\n\n#MATRIX24` }] });
  const r = await run(q, ig);
  assert.equal(r.gate, 'duplicate');
  assert.deepEqual(q.state.writes, []);
  assert.ok(!ig.calls.includes('publish'));
});

test('incomplete feed read blocks the send', async () => {
  const q = fakeQueue(ready);
  const r = await run(q, fakeInstagram({ feedThrows: true }));
  assert.equal(r.gate, 'provider_read_incomplete');
  assert.deepEqual(q.state.writes, []);
});

test('lost reservation race: nothing sent', async () => {
  const q = fakeQueue(ready, { conflictOn: 1 });
  const ig = fakeInstagram();
  const r = await run(q, ig);
  assert.equal(r.gate, 'reservation_sha_conflict');
  assert.ok(!ig.calls.includes('container'));
});

test('ambiguous media_publish -> publish_unknown, never retried', async () => {
  const q = fakeQueue(ready);
  const ig = fakeInstagram({ publish: { outcome: 'unknown', reason: 'publish_network' } });
  const r = await run(q, ig);
  assert.equal(r.result, 'publish_unknown');
  assert.deepEqual(q.state.writes, ['publishing', 'publish_unknown']);
  assert.equal(ig.calls.filter(c => c === 'publish').length, 1);
});

test('container failure (nothing public) releases with not-invoked proof', async () => {
  const q = fakeQueue(ready);
  const ig = fakeInstagram({ container: { ok: false, reason: 'container_http_400' } });
  const r = await run(q, ig);
  assert.equal(r.result, 'not_sent');
  assert.deepEqual(q.state.writes, ['publishing', 'ready_to_publish']);
  assert.ok(!ig.calls.includes('publish'));
  assert.equal(q.state.record.publish_attempt_id, undefined);
});

test('own unresolved attempt blocks any new send', async () => {
  const q = fakeQueue(ready);
  const ig = fakeInstagram();
  const stuck = { content_id: 'matrix24-other', status: 'publish_unknown', provider: PROVIDER };
  const r = await run(q, ig, { localRecords: [stuck] });
  assert.equal(r.gate, 'own_unresolved_attempt');
  assert.deepEqual(ig.calls, []);
});

test('legacy Metricool publishing records are never candidates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-'));
  fs.mkdirSync(path.join(root, 'queue'));
  const legacy = { ...ready, content_id: 'matrix24-legacy', status: 'publishing', provider: 'metricool', publish_attempt_id: 'a' };
  fs.writeFileSync(path.join(root, 'queue', 'matrix24-legacy.json'), serializeRecord(legacy));
  fs.writeFileSync(path.join(root, 'queue', `${id}.json`), serializeRecord(ready));
  const plan = planPublication(root, { now: '2099-01-01T01:00:00.000Z' });
  assert.deepEqual(plan.candidates.map(c => c.content_id), [id]);
  assert.equal(plan.candidates[0].sha, sha);
  assert.deepEqual(plan.unresolved.map(u => u.content_id), ['matrix24-legacy']);
  assert.ok(Object.values(plan.candidates[0].simulation).every(s => s.ok));
  assert.deepEqual(plan.publishing_blocked_by_own_unresolved_attempt, []);
});

test('every publisher write passes the single-owner transition table', () => {
  const reserved = buildReservation(ready, { attemptId: 'att', now: '2099-01-01T01:00:00Z', approval: {} });
  assert.deepEqual(classifyQueueWrite(ready, reserved).violations, []);
  assert.deepEqual(classifyQueueWrite(reserved, buildRelease(reserved, { reason: 'x', now: '2099-01-01T01:01:00Z' })).violations, []);
});

test('caption sent is caption + hashtags; matching requires the full caption prefix', () => {
  assert.equal(buildInstagramCaption(ready), `${caption}\n\n#MATRIX24 #Fixture`);
  assert.equal(captionMatchesRecord(`${caption}  \n\n #MATRIX24`, ready), true);
  assert.equal(captionMatchesRecord(caption.slice(0, 50), ready), false);
  assert.equal(captionMatchesRecord('short', { caption: 'short' }), false);
});

test('owner gate: fails closed when the environment has no required reviewer', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ protection_rules: [{ type: 'wait_timer' }] }) });
  await assert.rejects(assertOwnerGate({ token: 't', repository: 'o/r', fetchImpl }), /OWNER_GATE_MISSING/);
  const ok = async () => ({ ok: true, json: async () => ({ protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { login: 'owner' } }] }] }) });
  assert.deepEqual((await assertOwnerGate({ token: 't', repository: 'o/r', fetchImpl: ok })).reviewers, ['owner']);
});
