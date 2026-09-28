import test from 'node:test';
import assert from 'node:assert/strict';
import {createReconciliationArchiveAdapter} from '../publisher-v2/staging/src/reconciliation-archive-adapter.mjs';

const accountId = '17841423605720355';
const username = 'matrix24global';
const attemptId = '11111111-1111-4111-8111-111111111111';
const mediaId = '18135178228630348';

const record = (overrides = {}) => ({
  content_id: 'matrix24-fixture-story',
  queue_path: 'queue/matrix24-fixture-story.json',
  status: 'publish_unknown',
  publish_attempt_id: attemptId,
  sha: 'a'.repeat(40),
  ...overrides
});

function igResponse(status, body = {}) {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
}

function config(overrides = {}) {
  const archiveCalls = [];
  const queueAdapter = {
    async archive(input) {
      archiveCalls.push(input);
      return overrides.archiveResult || {kind: 'archived', record: {...input.record, status: 'published'}};
    }
  };
  return {
    accountId,
    expectedUsername: username,
    getAccessToken: async () => 'x'.repeat(24),
    fetchImpl: overrides.fetchImpl || (async () => igResponse(200, {id: mediaId, permalink: 'https://instagram.com/p/fixture', username})),
    queueAdapter,
    archiveCalls
  };
}

test('rejects invalid construction config', () => {
  assert.throws(() => createReconciliationArchiveAdapter({expectedUsername: username, getAccessToken: async () => 'x', queueAdapter: {archive: async () => {}}}), /RECONCILIATION_ACCOUNT_ID_INVALID/);
  assert.throws(() => createReconciliationArchiveAdapter({accountId, getAccessToken: async () => 'x', queueAdapter: {archive: async () => {}}}), /RECONCILIATION_USERNAME_INVALID/);
  assert.throws(() => createReconciliationArchiveAdapter({accountId, expectedUsername: username, queueAdapter: {archive: async () => {}}}), /RECONCILIATION_TOKEN_PROVIDER_INVALID/);
  assert.throws(() => createReconciliationArchiveAdapter({accountId, expectedUsername: username, getAccessToken: async () => 'x'}), /RECONCILIATION_QUEUE_ADAPTER_INVALID/);
});

test('a verified, account-bound media ID on an owned unresolved record is archived', async () => {
  const cfg = config();
  const adapter = createReconciliationArchiveAdapter(cfg);
  const result = await adapter.reconcile({record: record(), attemptId, candidateMediaId: mediaId});
  assert.equal(result.kind, 'archived');
  assert.equal(cfg.archiveCalls.length, 1);
  assert.equal(cfg.archiveCalls[0].instagram_media_id, mediaId);
  assert.equal(cfg.archiveCalls[0].instagram_permalink, 'https://instagram.com/p/fixture');
});

test('never archives a record not owned by the supplied attempt ID', async () => {
  const cfg = config();
  const adapter = createReconciliationArchiveAdapter(cfg);
  const result = await adapter.reconcile({record: record({publish_attempt_id: 'someone-elses-attempt'}), attemptId, candidateMediaId: mediaId});
  assert.equal(result.kind, 'not_applicable');
  assert.equal(result.reason, 'attempt_not_owned');
  assert.equal(cfg.archiveCalls.length, 0);
});

test('never archives a record that is not in an unresolved state (ready_to_publish, published)', async () => {
  const cfg = config();
  const adapter = createReconciliationArchiveAdapter(cfg);
  for (const status of ['ready_to_publish', 'published']) {
    const result = await adapter.reconcile({record: record({status}), attemptId, candidateMediaId: mediaId});
    assert.equal(result.kind, 'not_applicable');
    assert.equal(result.reason, 'not_unresolved');
  }
  assert.equal(cfg.archiveCalls.length, 0);
});

test('a media ID that belongs to a different account is never archived', async () => {
  const cfg = config({fetchImpl: async () => igResponse(200, {id: mediaId, permalink: null, username: 'someone-else'})});
  const adapter = createReconciliationArchiveAdapter(cfg);
  const result = await adapter.reconcile({record: record(), attemptId, candidateMediaId: mediaId});
  assert.equal(result.kind, 'unverified');
  assert.equal(cfg.archiveCalls.length, 0);
});

test('a lookup that returns a different media ID than requested is never archived', async () => {
  const cfg = config({fetchImpl: async () => igResponse(200, {id: 'different-id-999', permalink: null, username})});
  const adapter = createReconciliationArchiveAdapter(cfg);
  const result = await adapter.reconcile({record: record(), attemptId, candidateMediaId: mediaId});
  assert.equal(result.kind, 'unverified');
  assert.equal(cfg.archiveCalls.length, 0);
});

test('a 404 (media not found) never archives', async () => {
  const cfg = config({fetchImpl: async () => igResponse(404, {})});
  const adapter = createReconciliationArchiveAdapter(cfg);
  const result = await adapter.reconcile({record: record(), attemptId, candidateMediaId: mediaId});
  assert.equal(result.kind, 'unverified');
  assert.equal(cfg.archiveCalls.length, 0);
});

test('a network exception during lookup never archives', async () => {
  // getDirectMedia() already converts a thrown fetch error into
  // {kind:'lookup_unavailable', reason:'network'} rather than rethrowing;
  // this adapter's own try/catch is a second line of defense for any other
  // unexpected throw. Either way, no archive may happen.
  const cfg = config({fetchImpl: async () => { throw new Error('network down'); }});
  const adapter = createReconciliationArchiveAdapter(cfg);
  const result = await adapter.reconcile({record: record(), attemptId, candidateMediaId: mediaId});
  assert.equal(result.kind, 'unverified');
  assert.equal(result.reason, 'network');
  assert.equal(cfg.archiveCalls.length, 0);
});

test('an invalid candidate media ID shape is rejected before any network call', async () => {
  const calls = [];
  const cfg = config({fetchImpl: async (...args) => { calls.push(args); return igResponse(200, {}); }});
  const adapter = createReconciliationArchiveAdapter(cfg);
  const result = await adapter.reconcile({record: record(), attemptId, candidateMediaId: 'not-a-number'});
  assert.equal(result.kind, 'not_applicable');
  assert.equal(result.reason, 'candidate_media_id_invalid');
  assert.equal(calls.length, 0);
});

test('the Kohli record, which was never reserved, is correctly refused (documents the real stuck case)', async () => {
  // matrix24-20260926-virat-kohli-2027-world-cup-final never got a
  // publish_attempt_id (the reservation write itself was blocked, see
  // INC-018) — this adapter must not be usable to force it through.
  const cfg = config();
  const adapter = createReconciliationArchiveAdapter(cfg);
  const kohliLikeRecord = record({status: 'ready_to_publish', publish_attempt_id: null});
  const result = await adapter.reconcile({record: kohliLikeRecord, attemptId, candidateMediaId: mediaId});
  assert.equal(result.kind, 'not_applicable');
  assert.equal(cfg.archiveCalls.length, 0);
});
