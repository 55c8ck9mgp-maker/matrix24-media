import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareMetricoolSubmission,
  classifyMetricoolScheduleResult,
  classifyMetricoolPublicationEvidence,
  classifyMetricoolPreWriteFailure
} from '../worker/staging/reliability/metricool-adapter.mjs';

const attempt=()=>({status:'publishing',content_id:'matrix24-fixture',attempt_id:'attempt-m1',
  account_id:'17841423605720355',payload_hash:'sha256:fixture'});

test('Metricool adapter requires an owned LKG reservation before submission',()=>{
  assert.equal(prepareMetricoolSubmission({...attempt(),status:'ready_to_publish'}).action,'invalid_or_unreserved_attempt');
  const r=prepareMetricoolSubmission(attempt());
  assert.equal(r.action,'persist_metricool_pre_send_receipt');
  assert.equal(r.scheduleAllowed,false);
});

test('Metricool scheduler id and uuid never count as Instagram publication evidence',()=>{
  const r=classifyMetricoolScheduleResult(attempt(),{id:'123',uuid:'planner-uuid'});
  assert.equal(r.publication,'pending_provider');
  assert.equal(r.publishAllowed,false);
  assert.equal(r.retryAllowed,false);
  assert.equal(r.receipt.kind,'metricool_scheduled');
  assert.equal(r.receipt.metricool_id,'123');
});

test('ambiguous Metricool scheduling outcome quarantines and never authorizes retry',()=>{
  const r=classifyMetricoolScheduleResult(attempt(),{});
  assert.equal(r.action,'quarantine_publish_unknown');
  assert.equal(r.retryAllowed,false);
  assert.equal(r.clearClaimAllowed,false);
});

test('only exact account/content-bound Instagram Media ID confirms publication',()=>{
  const wrong=classifyMetricoolPublicationEvidence(attempt(),{
    kind:'instagram_media',media_id:'18135178228630348',
    account_id:'wrong-account',content_id:'matrix24-fixture'});
  assert.equal(wrong.action,'retain_claim_and_reconcile');
  const ok=classifyMetricoolPublicationEvidence(attempt(),{
    kind:'instagram_media',media_id:'18135178228630348',
    account_id:'17841423605720355',content_id:'matrix24-fixture'});
  assert.equal(ok.publication,'confirmed');
  assert.equal(ok.receipt.kind,'published_media');
  assert.equal(ok.receipt.media_id,'18135178228630348');
});

test('missing permalink does not prevent confirmed publication',()=>{
  const r=classifyMetricoolPublicationEvidence(attempt(),{
    kind:'instagram_media',media_id:'18135178228630348',
    account_id:'17841423605720355',content_id:'matrix24-fixture'});
  assert.equal(r.publication,'confirmed');
  assert.equal(r.permalink,null);
});

test('claim can clear only with durable action_not_invoked proof',()=>{
  const ambiguous=classifyMetricoolPreWriteFailure(attempt(),{});
  assert.equal(ambiguous.clearClaimAllowed,false);
  assert.equal(ambiguous.action,'quarantine_publish_unknown');
  const safe=classifyMetricoolPreWriteFailure(attempt(),{action_not_invoked:true});
  assert.equal(safe.action,'action_not_invoked');
  assert.equal(safe.clearClaimAllowed,true);
  assert.equal(safe.retryAllowed,false);
});
