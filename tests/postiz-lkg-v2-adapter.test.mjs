import test from 'node:test';
import assert from 'node:assert/strict';
import {
  preparePostizSubmission,
  classifyPostizScheduleResult,
  classifyPostizPublicationEvidence,
  classifyPostizPreWriteFailure
} from '../worker/staging/reliability/postiz-adapter.mjs';

const attempt=()=>({status:'publishing',content_id:'matrix24-fixture',attempt_id:'attempt-p1',
  account_id:'17841423605720355',payload_hash:'sha256:fixture'});

test('Postiz adapter requires an owned LKG reservation before submission',()=>{
  assert.equal(preparePostizSubmission({...attempt(),status:'ready_to_publish'}).action,'invalid_or_unreserved_attempt');
  const r=preparePostizSubmission(attempt());
  assert.equal(r.action,'persist_postiz_pre_send_receipt');
  assert.equal(r.scheduleAllowed,false);
});

test('a Postiz posts[] receipt with ids never counts as Instagram publication evidence',()=>{
  const r=classifyPostizScheduleResult(attempt(),{posts:[{id:'postiz-post-1'}]});
  assert.equal(r.publication,'pending_provider');
  assert.equal(r.publishAllowed,false);
  assert.equal(r.retryAllowed,false);
  assert.equal(r.receipt.kind,'postiz_scheduled');
  assert.deepEqual(r.receipt.postiz_post_ids,['postiz-post-1']);
});

test('a bare array response (alternate documented shape) is also accepted as a schedule receipt',()=>{
  const r=classifyPostizScheduleResult(attempt(),[{id:'postiz-post-2'}]);
  assert.equal(r.publication,'pending_provider');
});

test('ambiguous Postiz scheduling outcome quarantines and never authorizes retry',()=>{
  const r=classifyPostizScheduleResult(attempt(),{});
  assert.equal(r.action,'quarantine_publish_unknown');
  assert.equal(r.retryAllowed,false);
  assert.equal(r.clearClaimAllowed,false);
});

test('a posts entry with no id is not accepted as a schedule receipt',()=>{
  const r=classifyPostizScheduleResult(attempt(),{posts:[{}]});
  assert.equal(r.action,'quarantine_publish_unknown');
});

test('only exact account/content-bound Instagram Media ID confirms publication',()=>{
  const wrong=classifyPostizPublicationEvidence(attempt(),{
    kind:'instagram_media',media_id:'18135178228630348',
    account_id:'wrong-account',content_id:'matrix24-fixture'});
  assert.equal(wrong.action,'retain_claim_and_reconcile');
  const ok=classifyPostizPublicationEvidence(attempt(),{
    kind:'instagram_media',media_id:'18135178228630348',
    account_id:'17841423605720355',content_id:'matrix24-fixture'});
  assert.equal(ok.publication,'confirmed');
  assert.equal(ok.receipt.kind,'published_media');
  assert.equal(ok.receipt.media_id,'18135178228630348');
});

test('missing permalink does not prevent confirmed publication',()=>{
  const r=classifyPostizPublicationEvidence(attempt(),{
    kind:'instagram_media',media_id:'18135178228630348',
    account_id:'17841423605720355',content_id:'matrix24-fixture'});
  assert.equal(r.publication,'confirmed');
  assert.equal(r.permalink,null);
});

test('claim can clear only with durable action_not_invoked proof',()=>{
  const ambiguous=classifyPostizPreWriteFailure(attempt(),{});
  assert.equal(ambiguous.clearClaimAllowed,false);
  assert.equal(ambiguous.action,'quarantine_publish_unknown');
  const safe=classifyPostizPreWriteFailure(attempt(),{action_not_invoked:true});
  assert.equal(safe.action,'action_not_invoked');
  assert.equal(safe.clearClaimAllowed,true);
  assert.equal(safe.retryAllowed,false);
});
