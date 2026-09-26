import test from 'node:test';
import assert from 'node:assert/strict';

function reserve(record, attemptId) {
  if (record.status !== 'ready_to_publish') throw new Error('NOT_READY');
  if (record.publish_attempt_id) throw new Error('ALREADY_RESERVED');
  return { ...record, status: 'publishing', publish_attempt_id: attemptId, external_writes: 0 };
}
function authorizePost(record, attemptId) {
  if (record.status !== 'publishing' || record.publish_attempt_id !== attemptId) throw new Error('RESERVATION_OWNERSHIP_CONFLICT');
  if (record.external_writes !== 0) throw new Error('EXTERNAL_WRITE_ALREADY_USED');
  return { ...record, external_writes: 1 };
}
function ambiguous(record, attemptId) {
  if (record.publish_attempt_id !== attemptId) throw new Error('RESERVATION_OWNERSHIP_CONFLICT');
  return { ...record, status: 'publish_unknown' };
}
function retryAllowed(record) {
  return record.status === 'ready_to_publish' && !record.publish_attempt_id && !record.instagram_media_id;
}
function preflightDecision(record) {
  if (record.status !== 'ready_to_publish') return { action:'skip', gate:'NOT_READY' };
  if (record.publish_attempt_id) return { action:'block', gate:'ALREADY_RESERVED' };
  if (record.instagram_media_id || record.instagram_permalink) return { action:'block', gate:'POSITIVE_PUBLICATION_EVIDENCE' };
  if (record.verification_status !== 'verified_claim_consensus') return { action:'block', gate:'VERIFICATION' };
  if (!record.public_image_url || record.image_spec?.format !== 'JPEG') return { action:'block', gate:'MEDIA' };
  return { action:'reserve', gate:'PREFLIGHT_PASSED' };
}
function archiveMediaId(record, attemptId, mediaId, accountId) {
  if (record.publish_attempt_id !== attemptId) throw new Error('RESERVATION_OWNERSHIP_CONFLICT');
  if (!/^\d+$/.test(mediaId) || record.account_id !== accountId) throw new Error('INVALID_MEDIA_RECEIPT');
  return { ...record, status: 'published', instagram_media_id: mediaId };
}
function reconcilePermalink(record, permalink) {
  if (record.status !== 'published' || !record.instagram_media_id) throw new Error('PUBLICATION_NOT_CONFIRMED');
  return { ...record, instagram_permalink: permalink };
}

test('LKG v2: one reservation owns at most one external write', () => {
  const ready={content_id:'matrix24-fixture',status:'ready_to_publish',account_id:'17841423605720355'};
  const reserved=reserve(ready,'attempt-a');
  assert.throws(()=>authorizePost(reserved,'attempt-b'),/OWNERSHIP/);
  const submitted=authorizePost(reserved,'attempt-a');
  assert.equal(submitted.external_writes,1);
  assert.throws(()=>authorizePost(submitted,'attempt-a'),/ALREADY_USED/);
});

test('LKG v2: ambiguous Instagram result can never authorize automatic retry', () => {
  const ready={content_id:'matrix24-fixture',status:'ready_to_publish',account_id:'17841423605720355'};
  const submitted=authorizePost(reserve(ready,'attempt-a'),'attempt-a');
  const unknown=ambiguous(submitted,'attempt-a');
  assert.equal(unknown.status,'publish_unknown');
  assert.equal(retryAllowed(unknown),false);
  assert.throws(()=>authorizePost(unknown,'attempt-a'));
  assert.throws(()=>authorizePost(unknown,'attempt-b'));
});

test('LKG v2: valid account-bound Media ID closes publication without permalink', () => {
  const ready={content_id:'matrix24-fixture',status:'ready_to_publish',account_id:'17841423605720355'};
  const submitted=authorizePost(reserve(ready,'attempt-a'),'attempt-a');
  const published=archiveMediaId(submitted,'attempt-a','18135178228630348','17841423605720355');
  assert.equal(published.status,'published');
  assert.equal(published.instagram_permalink,undefined);
  assert.equal(retryAllowed(published),false);
  const reconciled=reconcilePermalink(published,'https://www.instagram.com/p/example/');
  assert.equal(reconciled.status,'published');
});

test('LKG v2: another attempt cannot archive or clear an owned reservation', () => {
  const ready={content_id:'matrix24-fixture',status:'ready_to_publish',account_id:'17841423605720355'};
  const reserved=reserve(ready,'attempt-a');
  assert.throws(()=>archiveMediaId(reserved,'attempt-b','18135178228630348','17841423605720355'),/OWNERSHIP/);
});

test('Bangkok regression: absent terminal publication fields do not block first reservation', () => {
  const ready={
    content_id:'matrix24-bangkok-fixture',
    status:'ready_to_publish',
    verification_status:'verified_claim_consensus',
    public_image_url:'https://example.test/media.jpg',
    image_spec:{format:'JPEG',width:1080,height:1350}
  };
  assert.equal(Object.hasOwn(ready,'publish_attempt_id'),false);
  assert.equal(Object.hasOwn(ready,'instagram_media_id'),false);
  assert.deepEqual(preflightDecision(ready),{action:'reserve',gate:'PREFLIGHT_PASSED'});
  const reserved=reserve(ready,'attempt-bangkok');
  assert.equal(reserved.status,'publishing');
  assert.equal(reserved.publish_attempt_id,'attempt-bangkok');
});

test('Bangkok regression: every ready candidate gets an explicit blocking gate or reservation decision', () => {
  const invalid={
    content_id:'matrix24-bangkok-fixture',
    status:'ready_to_publish',
    verification_status:'verified_claim_consensus'
  };
  assert.deepEqual(preflightDecision(invalid),{action:'block',gate:'MEDIA'});
});
