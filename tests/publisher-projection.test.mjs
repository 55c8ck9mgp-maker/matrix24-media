import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPreSendClaim, projectProviderResult, projectReconciliation } from '../worker/staging/reliability/publisher-projection.mjs';

const ready = (changes = {}) => ({
  status: 'ready_to_publish', content_id: 'story-1', account_id: 'account-1',
  attempt_id: 'attempt-1', payload_hash: 'sha256:fixture',
  public_image_url: 'https://example.test/image.jpg', ...changes
});
const claim = () => projectPreSendClaim(ready()).record;
const outcome = (changes = {}) => ({ attempt_id: 'attempt-1', content_id: 'story-1', account_id: 'account-1', payload_hash: 'sha256:fixture', ...changes });

test('only a complete ready record can project a durable pre-send claim', () => {
  const result = projectPreSendClaim(ready());
  assert.equal(result.action, 'persist_publishing_claim');
  assert.equal(result.publishAllowed, false);
  assert.equal(result.record.status, 'publishing');
  assert.equal(result.record.publish_claim.state, 'pre_send');
  assert.equal(projectPreSendClaim(ready({ public_image_url: '' })).action, 'invalid_or_unready_record');
});

test('a provider response without an exact Media ID remains unknown and retains claim', () => {
  for (const media_id of [undefined, 17900000000000001, 'container-1']) {
    const result = projectProviderResult(claim(), outcome({ media_id }));
    assert.equal(result.action, 'quarantine_publish_unknown');
    assert.equal(result.record.status, 'publish_unknown');
    assert.equal(result.record.publish_claim.attempt_id, 'attempt-1');
    assert.equal(result.retryAllowed, false);
  }
});

test('only an exact bound string Media ID confirms a publication', () => {
  const result = projectProviderResult(claim(), outcome({ media_id: '17900000000000001' }));
  assert.equal(result.action, 'persist_confirmed_publication');
  assert.equal(result.record.status, 'published');
  assert.equal(result.record.media_id, '17900000000000001');
  assert.equal(result.record.permalink, null);
  assert.equal(result.retryAllowed, false);
});

test('a mismatched provider response never changes a durable publishing state', () => {
  const result = projectProviderResult(claim(), outcome({ attempt_id: 'other', media_id: '17900000000000001' }));
  assert.equal(result.action, 'retain_and_reconcile');
  assert.equal(result.retryAllowed, false);
});

test('reconciliation needs exact media, owner, and attempt binding', () => {
  const unknown = projectProviderResult(claim(), outcome({})).record;
  const good = projectReconciliation(unknown, outcome({ media_id: '17900000000000001', owner_id: 'account-1', permalink: 'https://instagram.com/p/example/' }));
  assert.equal(good.action, 'reconcile_exact_media');
  assert.equal(good.record.status, 'published');
  assert.equal(good.record.publish_attempt.outcome, 'reconciled');
  for (const bad of [
    outcome({ media_id: '17900000000000001', owner_id: 'other' }),
    outcome({ media_id: 'container-1', owner_id: 'account-1' }),
    outcome({ attempt_id: 'other', media_id: '17900000000000001', owner_id: 'account-1' })
  ]) assert.equal(projectReconciliation(unknown, bad).action, 'retain_and_reconcile');
});
