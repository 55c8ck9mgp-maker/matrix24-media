import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createMetricoolScheduleTransport} from '../publisher-v2/staging/src/metricool-schedule-transport.mjs';

const record = (overrides = {}) => ({
  content_id: 'matrix24-fixture-story',
  status: 'publishing',
  caption: 'Fixture caption text.',
  hashtags: ['#MATRIX24', '#Fixture'],
  public_image_url: 'https://example.supabase.co/storage/matrix24-fixture.jpg',
  ...overrides
});

const config = (overrides = {}) => ({
  userId: '1234',
  blogId: '5678',
  accountId: '17841423605720355',
  getApiToken: async () => 'x'.repeat(24),
  cryptoImpl: crypto.webcrypto,
  nowIso: () => '2026-09-27T23:00:00.000Z',
  ...overrides
});

const response = (status, body = {}) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

test('rejects config missing required identity fields', () => {
  assert.throws(() => createMetricoolScheduleTransport({blogId: '1', accountId: '1', getApiToken: async () => 'x'}), /METRICOOL_TRANSPORT_CONFIG_INVALID/);
  assert.throws(() => createMetricoolScheduleTransport({userId: '1', blogId: '1', accountId: '1'}), /METRICOOL_TRANSPORT_CONFIG_INVALID/);
});

test('a record that is not an owned publishing attempt is never sent over the network', async () => {
  const calls = [];
  const transport = createMetricoolScheduleTransport(config({fetchImpl: async (...args) => { calls.push(args); return response(200, {}); }}));
  const result = await transport.send({record: record({status: 'ready_to_publish'}), attemptId: 'attempt-1'});
  assert.equal(result.kind, 'not_invoked');
  assert.equal(result.proof, 'transport_not_called');
  assert.equal(calls.length, 0);
});

test('posts the exact expected request shape to the scheduler endpoint', async () => {
  const calls = [];
  const transport = createMetricoolScheduleTransport(config({
    fetchImpl: async (url, init) => { calls.push({url, init}); return response(200, {id: '999', uuid: 'planner-uuid-1'}); }
  }));
  const result = await transport.send({record: record(), attemptId: 'attempt-1'});

  assert.equal(calls.length, 1);
  const {url, init} = calls[0];
  assert.equal(url, 'https://app.metricool.com/api/v2/scheduler/posts?userId=1234&blogId=5678');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['X-Mc-Auth'], 'x'.repeat(24));
  const body = JSON.parse(init.body);
  assert.match(body.text, /Fixture caption text\./);
  assert.match(body.text, /#MATRIX24/);
  assert.deepEqual(body.providers, [{network: 'instagram'}]);
  assert.equal(body.autoPublish, true);
  assert.equal(body.draft, false);
  assert.deepEqual(body.media, ['https://example.supabase.co/storage/matrix24-fixture.jpg']);
  assert.deepEqual(body.publicationDate, {dateTime: '2026-09-27T23:00:00', timezone: 'UTC'});

  // A confirmed schedule receipt is still never terminal Instagram evidence.
  assert.equal(result.kind, 'ambiguous');
  assert.equal(result.reason, 'metricool_schedule_pending_reconciliation');
  assert.equal(result.classification.publication, 'pending_provider');
});

test('never leaks the API token into the returned result or thrown values', async () => {
  const token = 'super-secret-token-value';
  const transport = createMetricoolScheduleTransport(config({getApiToken: async () => token, fetchImpl: async () => response(200, {id: '1', uuid: 'u'})}));
  const result = await transport.send({record: record(), attemptId: 'attempt-1'});
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('an ambiguous (non-id/uuid) Metricool response is reported as ambiguous, never published', async () => {
  const transport = createMetricoolScheduleTransport(config({fetchImpl: async () => response(200, {})}));
  const result = await transport.send({record: record(), attemptId: 'attempt-1'});
  assert.equal(result.kind, 'ambiguous');
  assert.equal(result.reason, 'metricool_schedule_outcome_ambiguous');
  assert.notEqual(result.kind, 'published');
});

test('a non-ok HTTP response is treated as ambiguous, not as proof of failure', async () => {
  const transport = createMetricoolScheduleTransport(config({fetchImpl: async () => response(500, {message: 'internal error'})}));
  const result = await transport.send({record: record(), attemptId: 'attempt-1'});
  assert.equal(result.kind, 'ambiguous');
});

test('a network exception never becomes not_invoked: the call may have already reached Metricool', async () => {
  const transport = createMetricoolScheduleTransport(config({fetchImpl: async () => { throw new Error('ECONNRESET'); }}));
  const result = await transport.send({record: record(), attemptId: 'attempt-1'});
  assert.equal(result.kind, 'ambiguous');
  assert.equal(result.reason, 'metricool_network_exception');
  assert.notEqual(result.kind, 'not_invoked');
});

test('this module never returns kind:published under any circumstance', async () => {
  const outcomes = [
    response(200, {id: '1', uuid: 'u'}),
    response(200, {}),
    response(500, {}),
    response(200, {id: '', uuid: ''})
  ];
  for (const outcome of outcomes) {
    const transport = createMetricoolScheduleTransport(config({fetchImpl: async () => outcome}));
    const result = await transport.send({record: record(), attemptId: 'attempt-1'});
    assert.notEqual(result.kind, 'published');
  }
});
