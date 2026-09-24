import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessPublication, readFreshness, readRetryDelay, assertStagingConfig } from '../worker/staging/reliability/policy.mjs';

const record = (overrides = {}) => ({ content_id: 'fixture-news', account_id: 'fixture-account',
  status: 'publish_unknown', attempt_id: 'attempt-1', claim: { id: 'attempt-1', started_at: '2020-01-01T00:00:00Z' }, ...overrides });
const receipt = (overrides = {}) => ({ kind: 'published_media', media_id: '17900000000000001',
  content_id: 'fixture-news', account_id: 'fixture-account', attempt_id: 'attempt-1', ...overrides });

test('old orphan and empty dual feeds never authorize retry or clear claim', () => {
  for (const status of ['publishing', 'publish_unknown']) {
    const input = record({ status }), before = structuredClone(input);
    const result = assessPublication(input, { rows: [], bothReachable: true, ageMinutes: 100000 });
    assert.equal(result.action, 'reconcile_only');
    assert.equal(result.publishAllowed, false); assert.equal(result.clearClaim, false);
    assert.equal(result.continueEditorial, true); assert.deepEqual(input, before);
  }
});
test('success ID without permalink preserves confirmed publication during read outage', () => {
  const result = assessPublication(record({ media_id: '17900000000000001' }));
  assert.equal(result.publication, 'confirmed'); assert.equal(result.action, 'verification_pending');
  assert.equal(result.publishAllowed, false);
});
test('exact ID requires the configured account', () => {
  const input = record({ media_id: '17900000000000001' });
  const wrong = { media_id: input.media_id, account_id: 'other' };
  assert.equal(assessPublication(input, { rows: [wrong] }).action, 'verification_pending');
  assert.equal(assessPublication(input, { rows: [{ ...wrong, account_id: input.account_id }] }).action, 'verified');
});
test('archive failure recovers from receipt without a second external call', () => {
  assert.equal(assessPublication(record(), { receipt: receipt() }).action, 'archive_receipt');
  for (const bad of [{kind:'container'}, {attempt_id:'other'}, {account_id:'other'}, {content_id:'other'}, {media_id:17900000000000001}]) {
    assert.equal(assessPublication(record(), { receipt: receipt(bad) }).action, 'reconcile_only');
  }
});
test('caption candidates alone cannot prove identity, even a single match', () => {
  const row = { account_id: 'fixture-account', media_id: '17900000000000001', caption: 'same caption' };
  assert.equal(assessPublication(record(), { rows: [row] }).action, 'review_candidates');
  assert.equal(assessPublication(record(), { rows: [row, {...row,media_id:'17900000000000002'}] }).publishAllowed, false);
});
test('invalid records and imprecise IDs fail closed', () => {
  assert.equal(assessPublication(null).action, 'invalid_record');
  assert.equal(assessPublication(record({ media_id: 17900000000000001 })).action, 'invalid_media_id');
  assert.equal(assessPublication(record({ status: 'published', media_id: null })).action, 'published_missing_evidence');
  assert.equal(assessPublication(record({ status: 'ready_to_publish', claim: undefined })).action, 'preflight_required');
});
test('read timestamp detects cached snapshots and never proves nonpublication', () => {
  assert.equal(readFreshness('2026-09-24T20:32:13Z','2026-09-24T21:06:30Z'), 'predates_attempt');
  assert.equal(readFreshness('2026-09-24T20:41:00Z','2026-09-24T21:06:30Z'), 'predates_attempt');
  assert.equal(readFreshness('2026-09-24T22:00:00Z','2026-09-24T21:06:30Z'), 'after_attempt_not_proof_of_absence');
  assert.equal(readFreshness('2026-09-24T22:00:00','bad'), 'unknown');
});
test('bounded read retries respect Retry-After and exclude authentication failures', () => {
  assert.equal(readRetryDelay({attempt:1,status:503}),5);
  assert.equal(readRetryDelay({attempt:2,status:429,retryAfterSeconds:120}),120);
  for (const status of [400,401,403,404]) assert.equal(readRetryDelay({attempt:1,status}),null);
  assert.equal(readRetryDelay({attempt:3,status:503}),null);
});
test('staging config rejects cron, resources, secrets and production identity', () => {
  const config = JSON.parse(fs.readFileSync('worker/staging/v3.2.0/wrangler.jsonc','utf8'));
  assert.equal(assertStagingConfig(config), true);
  for (const extra of [{triggers:{crons:['* * * * *']}},{services:[]},{ai:{}},{env:{}},{name:'matrix24-publisher'},
    {vars:{MATRIX24_MODE:'staging-fixtures-only',GITHUB_TOKEN:'fixture'}}]) {
    assert.throws(()=>assertStagingConfig({...config,...extra}),/STAGING_NOT_ISOLATED/);
  }
});
test('fault matrix never emits external authorization or destructive claim recovery', () => {
  for (const status of ['ready_to_publish','publishing','publish_unknown','published']) {
    for (const media_id of [null,'17900000000000001']) {
      for (const evidence of [{},{rows:[]},{bothReachable:true,ageMinutes:60},{receipt:receipt()}]) {
        const result=assessPublication(record({status,media_id}),evidence);
        assert.equal(result.publishAllowed,false); assert.equal(result.clearClaim,false);
        assert.equal(result.continueEditorial,true);
      }
    }
  }
});
