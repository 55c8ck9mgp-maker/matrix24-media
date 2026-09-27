import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeBrokerCapability,authorizeReservationIdentity,planReservation,validateReservationRequest} from '../scripts/reservation-broker-policy.mjs';

const request=()=>({content_id:'matrix24-fixture-story',queue_path:'queue/matrix24-fixture-story.json',
 expected_sha:'a'.repeat(40),attempt_id:'11111111-1111-4111-8111-111111111111',requested_at:'2026-09-27T23:00:00Z'});
const identity=()=>({verified:true,subject:'matrix24-auto-publisher',scopes:['queue:reserve']});
const current=()=>({content_id:'matrix24-fixture-story',queue_path:'queue/matrix24-fixture-story.json',sha:'a'.repeat(40),status:'ready_to_publish',publish_attempt_history:[]});

test('only a complete bounded request is valid',()=>{
 assert.equal(validateReservationRequest(request()).action,'validate');
 for(const bad of [null,{}, {...request(),extra:'x'}, {...request(),expected_sha:'a'.repeat(39)},
   {...request(),queue_path:'../queue/x.json'}, {...request(),attempt_id:'not-a-uuid'},
   {...request(),requested_at:'2026-09-27T23:00:00'}]) assert.equal(validateReservationRequest(bad).action,'reject');
});
test('caller assertions never become authenticated identity',()=>{
 assert.equal(authorizeReservationIdentity({subject:'matrix24-auto-publisher',scopes:['queue:reserve']}).gate,'identity_unverified');
 assert.equal(authorizeReservationIdentity({...identity(),subject:'other'}).gate,'identity_subject');
 assert.equal(authorizeReservationIdentity({...identity(),scopes:['queue:reserve','publish:instagram']}).gate,'identity_scope');
});
test('identity receives reserve scope only',()=>{
 assert.equal(authorizeBrokerCapability('queue:reserve').action,'allow');
 for(const capability of ['publish:instagram','scheduler:write','queue:read','*',null]) assert.equal(authorizeBrokerCapability(capability).action,'reject');
});
test('valid input emits an exact conditional reservation and no send authority',()=>{
 const before=current(), result=planReservation({request:request(),identity:identity(),current:before});
 assert.equal(result.action,'conditional_reservation');
 assert.equal(result.expected_sha,request().expected_sha);
 assert.equal(result.replacement.status,'publishing');
 assert.equal(result.replacement.publish_attempt_id,request().attempt_id);
 assert.equal(result.replacement.publish_attempt_history.at(-1).result,'reservation_started');
 assert.deepEqual(before,current());
 assert.equal(JSON.stringify(result).includes('instagram'),false);
});
test('binding, stale SHA, state and publication evidence fail closed',()=>{
 for(const change of [
   {content_id:'other'}, {queue_path:'queue/other.json'}, {sha:'b'.repeat(40)}, {status:'publishing'},
   {instagram_media_id:'18000000000000001'}, {publish_attempt_id:'old'}
 ]) assert.equal(planReservation({request:request(),identity:identity(),current:{...current(),...change}}).action,'reject');
});
test('identical planning is deterministic and never writes',()=>{
 const input={request:request(),identity:identity(),current:current()};
 assert.deepEqual(planReservation(input),planReservation(structuredClone(input)));
});
