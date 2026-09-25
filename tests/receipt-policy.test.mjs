import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDurableAttempt, classifyProviderOutcome, reconcileDurableReceipt } from '../worker/staging/reliability/receipt-policy.mjs';

const record = (overrides = {}) => ({
  status: 'ready_to_publish', content_id: 'story-1', attempt_id: 'attempt-1',
  account_id: 'account-1', payload_hash: 'sha256:fixture', ...overrides
});
const preSend = () => prepareDurableAttempt(record()).receipt;
const published = () => classifyProviderOutcome(preSend(), { media_id: '17900000000000001' }).receipt;

test('a pre-send receipt binds a single attempt without authorizing transport', () => {
  const result = prepareDurableAttempt(record());
  assert.deepEqual(result.receipt, { kind: 'pre_send', content_id: 'story-1', attempt_id: 'attempt-1', account_id: 'account-1', payload_hash: 'sha256:fixture' });
  assert.equal(result.sendAllowed, false);
  assert.equal(result.retryAllowed, false);
});

test('an incomplete attempt never yields a receipt or publishing authority', () => {
  for (const change of [{ status: 'publishing' }, { attempt_id: '' }, { payload_hash: null }]) {
    const result = prepareDurableAttempt(record(change));
    assert.equal(result.action, 'invalid_or_unready_attempt');
    assert.equal(result.sendAllowed, false);
  }
});

test('a provider response without an exact Media ID becomes unknown and cannot retry', () => {
  for (const outcome of [{}, { media_id: 17900000000000001 }, { media_id: 'container-1' }]) {
    const result = classifyProviderOutcome(preSend(), outcome);
    assert.equal(result.action, 'quarantine_publish_unknown');
    assert.equal(result.retryAllowed, false);
    assert.equal(result.clearClaimAllowed, false);
  }
});

test('a string Media ID creates a durable receipt before any queue projection', () => {
  const result = classifyProviderOutcome(preSend(), { media_id: '17900000000000001' });
  assert.equal(result.action, 'persist_published_media_receipt');
  assert.deepEqual(result.receipt, { kind: 'published_media', content_id: 'story-1', attempt_id: 'attempt-1', account_id: 'account-1', payload_hash: 'sha256:fixture', media_id: '17900000000000001' });
});

test('reconciliation accepts only the exact receipt binding and account', () => {
  const success = reconcileDurableReceipt(record({ status: 'publish_unknown' }), published(),
    { kind: 'ig_media', id: '17900000000000001', owner_id: 'account-1', permalink: 'https://www.instagram.com/p/example/' });
  assert.equal(success.action, 'archive_confirmed_receipt');
  assert.equal(success.verification, 'direct_lookup');
  for (const bad of [
    { ...published(), attempt_id: 'other' },
    { ...published(), account_id: 'other' },
    { ...published(), media_id: 17900000000000001 }
  ]) assert.equal(reconcileDurableReceipt(record(), bad).action, 'retain_claim_and_reconcile');
});

test('missing permalink or lookup remains confirmed by receipt without republishing', () => {
  const result = reconcileDurableReceipt(record({ status: 'publish_unknown' }), published(), {});
  assert.equal(result.publication, 'confirmed');
  assert.equal(result.verification, 'receipt_only');
  assert.equal(result.retryAllowed, false);
});
