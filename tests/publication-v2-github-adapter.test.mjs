import test from 'node:test';
import assert from 'node:assert/strict';
import {createGitHubQueueAdapter} from '../publisher-v2/staging/src/github-queue-adapter.mjs';

const sha = char => char.repeat(40);
const attempt='11111111-1111-4111-8111-111111111111';
const record = (overrides={}) => ({content_id:'fixture-story',queue_path:'queue/fixture-story.json',status:'ready_to_publish',caption:'original',publish_attempt_history:[],...overrides});
const b64 = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const response = (status, body={}) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function fakeGithub({initial=record(),initialSha=sha('a'),putStatus=200}={}) {
 const calls=[];
 const fetchImpl=async (url,init={})=>{calls.push({url,init});if(init.method==='GET')return response(200,{encoding:'base64',content:b64(initial),sha:initialSha});if(init.method==='PUT')return response(putStatus,putStatus===200?{content:{sha:sha('b')}}:{message:'conflict'});return response(500);};
 return {calls,fetchImpl};
}
const adapter = fixture => createGitHubQueueAdapter({repo:'55c8ck9mgp-maker/matrix24-media',getAccessToken:async()=> 'x'.repeat(20),fetchImpl:fixture.fetchImpl});
const plan = (overrides={}) => ({action:'conditional_reservation',expected_sha:sha('a'),replacement:record({status:'publishing',publish_attempt_id:attempt,publishing_started_at:'2026-09-27T23:00:00Z',provider:'metricool',...overrides})});

test('reservation reads current main blob and writes a derived replacement against exactly its SHA',async()=>{
 const f=fakeGithub(),result=await adapter(f).reserve(plan({caption:'caller-controlled'}));
 // engine.mjs only recognizes 'reserved' as a completed reservation; the raw
 // transport outcome ('written') must be translated, not passed through.
 assert.equal(result.kind,'reserved');assert.equal(result.record.sha,sha('b'));assert.equal(result.record.caption,'original');assert.equal(f.calls.length,2);
 const write=JSON.parse(f.calls[1].init.body);assert.equal(write.sha,sha('a'));assert.equal(write.branch,'main');assert.match(f.calls[1].init.headers.authorization,/^Bearer /);assert.equal(JSON.stringify(result).includes('x'.repeat(20)),false);
});
test('stale SHA and non-ready state conflict before any conditional write',async()=>{
 for(const fixture of [fakeGithub({initialSha:sha('c')}),fakeGithub({initial:record({status:'publish_unknown'})})]){const result=await adapter(fixture).reserve(plan());assert.equal(result.kind,'conflict');assert.equal(fixture.calls.length,1);}
});
test('GitHub write conflict remains a conflict and never reports reservation',async()=>{const f=fakeGithub({putStatus:409});assert.deepEqual(await adapter(f).reserve(plan()),{kind:'conflict'});assert.equal(f.calls.length,2);});
test('unknown GitHub outcomes fail closed without response or token leakage',async()=>{const f={fetchImpl:async()=>response(503,{message:'secret-like-provider-payload'})};await assert.rejects(()=>adapter(f).reserve(plan()),error=>error.code==='GITHUB_QUEUE_READ_UNCONFIRMED');});
test('archive and quarantine re-read owned state and reject supplied snapshot drift',async()=>{
 const initial=record({status:'publishing',publish_attempt_id:attempt,provider:'metricool'});
 const f=fakeGithub({initial});const a=adapter(f);const owned={...initial,sha:sha('a')};
 // Same translation requirement as reserve(): engine.mjs only accepts 'archived'.
 assert.equal((await a.archive({record:owned,attemptId:attempt,instagram_media_id:'18000000000000001',instagram_permalink:null})).kind,'archived');assert.equal(f.calls.length,2);
 await assert.rejects(()=>a.markUnknown({record:{...owned,caption:'forged'},attemptId:attempt,reason:'timeout'}),error=>error.code==='GITHUB_STATE_CHANGED');
});
test('adapter rejects arbitrary repos, paths, missing SHA, and short-lived identity failure',async()=>{
 assert.throws(()=>createGitHubQueueAdapter({repo:'bad',getAccessToken:async()=> 'x'.repeat(20)}),/GITHUB_ADAPTER_CONFIG_INVALID/);
 const f=fakeGithub();const a=createGitHubQueueAdapter({repo:'55c8ck9mgp-maker/matrix24-media',getAccessToken:async()=>null,fetchImpl:f.fetchImpl});await assert.rejects(()=>a.reserve(plan()),error=>error.code==='GITHUB_APP_TOKEN_UNAVAILABLE');
 await assert.rejects(()=>adapter(f).archive({record:record({queue_path:'docs/x',sha:sha('a'),publish_attempt_id:attempt}),attemptId:attempt,instagram_media_id:'18000000000000001'}),error=>error.code==='GITHUB_QUEUE_PATH_INVALID');
});
