import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createPostizScheduleTransport} from '../publisher-v2/staging/src/postiz-schedule-transport.mjs';

const record = (overrides = {}) => ({
  content_id: 'matrix24-fixture-story',
  status: 'publishing',
  caption: 'Fixture caption text.',
  hashtags: ['#MATRIX24', '#Fixture'],
  public_image_url: 'https://example.supabase.co/storage/matrix24-fixture.jpg',
  ...overrides
});

const config = (overrides = {}) => ({
  integrationId: 'integration-abc123',
  accountId: '17841423605720355',
  getApiKey: async () => 'x'.repeat(24),
  cryptoImpl: crypto.webcrypto,
  nowIso: () => '2026-09-28T23:00:00.000Z',
  ...overrides
});

const response = (status, body = {}) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

test('rejects config missing required identity fields', () => {
  assert.throws(() => createPostizScheduleTransport({accountId: '1', getApiKey: async () => 'x'}), /POSTIZ_TRANSPORT_CONFIG_INVALID/);
  assert.throws(() => createPostizScheduleTransport({integrationId: '1', accountId: '1'}), /POSTIZ_TRANSPORT_CONFIG_INVALID/);
});

test('a record that is not an owned publishing attempt is never sent over the network', async () => {
  const calls = [];
  const transport = createPostizScheduleTransport(config({fetchImpl: async (...args) => { calls.push(args); return response(200, {}); }}));
  const result = await transport.send({record: record({status: 'ready_to_publish'}), attemptId: 'attempt-1'});
  assert.equal(result.kind, 'not_invoked');
  assert.equal(result.proof, 'transport_not_called');
  assert.equal(calls.length, 0);
});

test('posts the exact expected request shape to the scheduler endpoint', async () => {
  const calls = [];
  const transport = createPostizScheduleTransport(config({
    fetchImpl: async (url, init) => { calls.push({url, init}); return response(200, {posts: [{id: 'postiz-post-1'}]}); }
  }));
  const result = await transport.send({record: record(), attemptId: 'attempt-1'});

  assert.equal(calls.length, 1);
  const {url, init} = calls[0];
  assert.equal(url, 'https://api.postiz.com/public/v1/posts');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Authorization'], 'x'.repeat(24));
  const body = JSON.parse(init.body);
  assert.equal(body.type, 'schedule');
  assert.equal(body.posts[0].integration.id, 'integration-abc123');
  assert.match(body.posts[0].value[0].content, /Fixture caption text\./);
  assert.match(body.posts[0].value[0].content, /#MATRIX24/);
  assert.equal(body.posts[0].settings.__type, 'instagram');
  assert.deepEqual(body.posts[0].value[0].image, [{id: 'https://example.supabase.co/storage/matrix24-fixture.jpg', path: 'https://example.supabase.co/storage/matrix24-fixture.jpg'}]);

  // A confirmed schedule receipt is still never terminal Instagram evidence.
  assert.equal(result.kind, 'ambiguous');
  assert.equal(result.reason, 'postiz_schedule_pending_reconciliation');
  assert.equal(result.classification.publication, 'pending_provider');
});

test('never leaks the API key into the returned result or thrown values', async () => {
  const key = 'super-secret-api-key-value';
  const transport = createPostizScheduleTransport(config({getApiKey: async () => key, fetchImpl: async () => response(200, {posts: [{id: '1'}]})}));
  const result = await transport.send({record: record(), attemptId: 'attempt-1'});
  assert.equal(JSON.stringify(result).includes(key), false);
});

test('an ambiguous (no recognizable posts array) Postiz response is reported as ambiguous, never published', async () => {
  const transport = createPostizScheduleTransport(config({fetchImpl: async () => response(200, {})}));
  const result = await transport.send({record: record(), attemptId: 'attempt-1'});
  assert.equal(result.kind, 'ambiguous');
  assert.equal(result.reason, 'postiz_schedule_outcome_ambiguous');
  assert.notEqual(result.kind, 'published');
});

test('a posts entry missing an id is treated as ambiguous, not accepted', async () => {
  const transport = createPostizScheduleTransport(config({fetchImpl: async () => response(200, {posts: [{}]})}));
  const result = await transport.send({record: record(), attemptId: 'attempt-1'});
  assert.equal(result.kind, 'ambiguous');
  assert.equal(result.reason, 'postiz_schedule_outcome_ambiguous');
});

test('a non-ok HTTP response is treated as ambiguous, not as proof of failure', async () => {
  const transport = createPostizScheduleTransport(config({fetchImpl: async () => response(500, {message: 'internal error'})}));
  const result = await transport.send({record: record(), attemptId: 'attempt-1'});
  assert.equal(result.kind, 'ambiguous');
});

test('a network exception never becomes not_invoked: the call may have already reached Postiz', async () => {
  const transport = createPostizScheduleTransport(config({fetchImpl: async () => { throw new Error('ECONNRESET'); }}));
  const result = await transport.send({record: record(), attemptId: 'attempt-1'});
  assert.equal(result.kind, 'ambiguous');
  assert.equal(result.reason, 'postiz_network_exception');
  assert.notEqual(result.kind, 'not_invoked');
});

test('this module never returns kind:published under any circumstance', async () => {
  const outcomes = [
    response(200, {posts: [{id: '1'}]}),
    response(200, {}),
    response(500, {}),
    response(200, {posts: []})
  ];
  for (const outcome of outcomes) {
    const transport = createPostizScheduleTransport(config({fetchImpl: async () => outcome}));
    const result = await transport.send({record: record(), attemptId: 'attempt-1'});
    assert.notEqual(result.kind, 'published');
  }
});
