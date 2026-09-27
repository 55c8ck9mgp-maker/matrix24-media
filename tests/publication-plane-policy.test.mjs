import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPublicationWork,assessReadyToPublish,buildReservation,authorizeMetricoolWrite,classifyMetricoolEvidence} from '../scripts/publication-plane-policy.mjs';

const ready=()=>({timestamp:'2026-09-27T13:47:59Z',content_id:'raf',status:'ready_to_publish',
 verification_status:'verified_claim_consensus',editorial_promotion:{manifest_path:'editorial/promotions/raf.json',draft_path:'editorial/verified/raf.json',draft_sha256:'abc'},
 caption:'verified caption',hashtags:['#MATRIX24'],public_image_url:'https://example.test/raf.jpg',
 image_spec:{format:'JPEG',mode:'RGB',width:1080,height:1350,alpha:false},publish_attempt_history:[]});

test('unresolved attempts always preempt ready backlog',()=>{assert.equal(selectPublicationWork([ready(),{status:'publish_unknown'}]).action,'reconcile')});
test('RAF semantics: absent terminal fields are valid and force reservation, not silent noop',()=>{
 const r=assessReadyToPublish(ready(),{readComplete:true,positiveDuplicate:false,currentSha:'sha-raf'});
 assert.deepEqual(r,{action:'reserve',sha:'sha-raf'});
});
test('failed/stale provider read names the exact gate',()=>assert.equal(assessReadyToPublish(ready(),{readComplete:false,currentSha:'x'}).gate,'provider_read_incomplete'));
test('reservation creates immutable owned claim',()=>{
 const r=buildReservation(ready(),{attemptId:'attempt-raf',now:'2026-09-27T15:32:00Z'});
 assert.equal(r.status,'publishing'); assert.equal(r.publish_attempt_id,'attempt-raf'); assert.equal(r.provider,'metricool');
 assert.throws(()=>buildReservation(r,{attemptId:'other',now:'x'}),/NOT_READY|ALREADY_RESERVED/);
});
test('Metricool write is authorized once only after ownership confirmation',()=>{
 const r=buildReservation(ready(),{attemptId:'attempt-raf',now:'2026-09-27T15:32:00Z'});
 assert.equal(authorizeMetricoolWrite(r,'attempt-raf').action,'send_once');
 assert.equal(authorizeMetricoolWrite({...r,metricool_scheduled_post_id:382918390},'attempt-raf').action,'reconcile_only');
 assert.equal(authorizeMetricoolWrite(r,'other').action,'reconcile_only');
});
test('scheduler receipt is never publication evidence and never permits retry',()=>{
 const r={...buildReservation(ready(),{attemptId:'a',now:'x'}),metricool_scheduled_post_id:382918390};
 assert.equal(classifyMetricoolEvidence(r,{status:'PENDING'}).action,'reconcile_only');
});
test('only PUBLISHED plus publicUrl/media ID archives',()=>{
 const r=buildReservation(ready(),{attemptId:'a',now:'x'});
 assert.equal(classifyMetricoolEvidence(r,{status:'PUBLISHED'}).action,'reconcile_only');
 assert.equal(classifyMetricoolEvidence(r,{status:'PUBLISHED',publicUrl:'https://www.instagram.com/p/x/'}).action,'archive_published');
});
test('ambiguous possible send quarantines; proven no-send may return ready',()=>{
 const r=buildReservation(ready(),{attemptId:'a',now:'x'});
 assert.equal(classifyMetricoolEvidence(r,{possibleSend:true}).action,'publish_unknown');
 assert.equal(classifyMetricoolEvidence(r,{actionNotInvoked:true}).action,'return_ready');
});
