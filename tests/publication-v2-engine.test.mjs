import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runPublicationCycle} from '../publisher-v2/staging/src/engine.mjs';
import worker from '../publisher-v2/staging/src/index.mjs';

const request=()=>({content_id:'matrix24-fixture-story',queue_path:'queue/matrix24-fixture-story.json',expected_sha:'a'.repeat(40),attempt_id:'11111111-1111-4111-8111-111111111111',requested_at:'2026-09-27T23:00:00Z'});
const identity=()=>({verified:true,subject:'matrix24-auto-publisher',scopes:['queue:reserve']});
const current=()=>({content_id:'matrix24-fixture-story',queue_path:'queue/matrix24-fixture-story.json',sha:'a'.repeat(40),status:'ready_to_publish',publish_attempt_history:[]});
const adapter=(overrides={})=>{
 const calls=[];
 return {calls,
  reserve:async plan=>(calls.push('reserve'),overrides.reserve?.(plan) || {kind:'reserved',record:plan.replacement}),
  persistPreSend:async input=>(calls.push('persistPreSend'),overrides.persistPreSend?.(input) || {kind:'pre_send_persisted',record:input.record}),
  send:async input=>(calls.push('send'),overrides.send?.(input) || {kind:'published',instagram_media_id:'18000000000000001'}),
  archive:async input=>(calls.push('archive'),overrides.archive?.(input) || {kind:'archived'}),
  markUnknown:async input=>(calls.push('markUnknown'),overrides.markUnknown?.(input) || {kind:'marked_unknown'}),
  returnReady:async input=>(calls.push('returnReady'),overrides.returnReady?.(input) || {kind:'returned_ready'}),
  reconcile:async input=>(calls.push('reconcile'),overrides.reconcile?.(input) || {kind:'reconciled'})
 };
};
const run=async (changes={}, overrides={})=>{const a=adapter(overrides); return {a,result:await runPublicationCycle({request:request(),identity:identity(),current:current(),adapter:a,...changes})};};

test('confirmed reservation permits exactly one send then durable archive',async()=>{
 const {a,result}=await run();
 assert.deepEqual(a.calls,['reserve','persistPreSend','send','archive']);
 assert.deepEqual(result,{action:'published',external_send_authorized:false,instagram_media_id:'18000000000000001'});
});
test('invalid identity, stale SHA, conflict and malformed reservation never send',async()=>{
 const cases=[
  [{identity:{...identity(),verified:false}},{}],
  [{current:{...current(),sha:'b'.repeat(40)}},{}],
  [{},{reserve:()=>({kind:'conflict'})}],
  [{},{reserve:()=>({kind:'reserved',record:{status:'publishing',publish_attempt_id:'other',provider:'metricool'}})}]
 ];
 for(const [changes,overrides] of cases){const {a,result}=await run(changes,overrides);assert.equal(a.calls.includes('send'),false);assert.notEqual(result.action,'published');}
});
test('unconfirmed pre-send receipt blocks provider call',async()=>{
 const {a,result}=await run({},{persistPreSend:()=>({kind:'conflict'})});
 assert.deepEqual(a.calls,['reserve','persistPreSend']);assert.equal(result.reason,'pre_send_receipt_unconfirmed');assert.equal(a.calls.includes('send'),false);
});
test('ambiguous response is quarantined and has no retry path',async()=>{
 const {a,result}=await run({},{send:()=>({kind:'ambiguous'})});
 assert.deepEqual(a.calls,['reserve','persistPreSend','send','markUnknown']); assert.equal(result.action,'reconcile_only');
});
test('send exception is quarantined with no second send',async()=>{
 const {a,result}=await run({},{send:()=>{throw new Error('network')}});
 assert.deepEqual(a.calls,['reserve','persistPreSend','send','markUnknown']); assert.equal(result.reason,'send_exception');
});
test('archive failure after positive media ID reconciles rather than resend',async()=>{
 const {a,result}=await run({},{archive:()=>{throw new Error('github unavailable')}});
 assert.deepEqual(a.calls,['reserve','persistPreSend','send','archive']); assert.equal(result.reason,'archive_unconfirmed_after_positive_send');
});
test('proved pre-write no-op may return ready; unproved outcome quarantines',async()=>{
 const noOp=await run({},{send:()=>({kind:'not_invoked',proof:'transport_not_called'})});
 assert.deepEqual(noOp.a.calls,['reserve','persistPreSend','send','returnReady']);assert.equal(noOp.result.action,'returned_ready');
 const unsafe=await run({},{send:()=>({kind:'not_invoked'})});
 assert.deepEqual(unsafe.a.calls,['reserve','persistPreSend','send','markUnknown']);assert.equal(unsafe.result.action,'reconcile_only');
});
test('unresolved state is reconciliation-only and never reserves or sends',async()=>{
 const a=adapter();const result=await runPublicationCycle({request:request(),identity:identity(),current:{...current(),status:'publish_unknown'},adapter:a});
 assert.deepEqual(a.calls,['reconcile']);assert.equal(result.action,'reconcile_only');
});
test('reconciliation failure remains quarantined and never sends',async()=>{
 const a=adapter({reconcile:()=>{throw new Error('provider unavailable')}});
 const result=await runPublicationCycle({request:request(),identity:identity(),current:{...current(),status:'publishing'},adapter:a});
 assert.deepEqual(a.calls,['reconcile']);assert.deepEqual(result,{action:'reconcile_only',external_send_authorized:false,reason:'reconciliation_unconfirmed'});
});
test('fixture worker has no cron or external effects',async()=>{
 const health=await worker.fetch(new Request('https://fixture.test/health'),{MATRIX24_MODE:'publisher-v2-fixtures-only'});
 assert.deepEqual(await health.json(),{status:'ok',service:'matrix24-publication-v2-staging',mode:'publisher-v2-fixtures-only',external_side_effects:false,cron_enabled:false});
  const bad=await worker.fetch(new Request('https://fixture.test/nope'),{});assert.equal(bad.status,404);
});
test('Publisher v2 staging config has no cron, bindings or secrets',()=>{
 const config=JSON.parse(fs.readFileSync('publisher-v2/staging/wrangler.jsonc','utf8'));
 assert.deepEqual(Object.keys(config).sort(),['$schema','compatibility_date','main','name','preview_urls','vars','workers_dev']);
 assert.deepEqual(config.vars,{MATRIX24_MODE:'publisher-v2-fixtures-only'});
 assert.equal(config.name,'matrix24-publication-v2-staging');
});
