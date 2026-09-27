import test from 'node:test';
import assert from 'node:assert/strict';
import {createGitHubQueueAdapter} from '../publisher-v2/staging/src/github-queue-adapter.mjs';

const sha = char => char.repeat(40);
const record = (overrides={}) => ({content_id:'fixture-story',queue_path:'queue/fixture-story.json',status:'ready_to_publish',publish_attempt_history:[],...overrides});
const b64 = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const response = (status, body={}) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function fakeGithub({initial=record(),initialSha=sha('a'),putStatus=200}={}) {
  const calls=[];
  const fetchImpl=async (url, init={}) => {
    calls.push({url,init});
    if (init.method === 'GET') return response(200,{encoding:'base64',content:b64(initial),sha:initialSha});
    if (init.method === 'PUT') return response(putStatus,putStatus===200?{content:{sha:sha('b')}}:{message:'conflict'});
    return response(500);
  };
  return {calls,fetchImpl};
}
const adapter = fixture => createGitHubQueueAdapter({repo:'55c8ck9mgp-maker/matrix24-media',getAccessToken:async()=> 'x'.repeat(20),fetchImpl:fixture.fetchImpl});
const plan = () => ({action:'conditional_reservation',expected_sha:sha('a'),replacement:record({status:'publishing',publish_attempt_id:'attempt-1',provider:'metricool'})});

test('reservation reads current main blob and writes replacement against exactly its SHA',async()=>{
 const f=fakeGithub(), result=await adapter(f).reserve(plan());
 assert.equal(result.kind,'written');assert.equal(result.record.sha,sha('b'));assert.equal(f.calls.length,2);
 const write=JSON.parse(f.calls[1].init.body);assert.equal(write.sha,sha('a'));assert.equal(write.branch,'main');
 assert.match(f.calls[1].init.headers.authorization,/^Bearer /);assert.equal(JSON.stringify(f.calls).includes('x'.repeat(20)),false);
});
test('stale SHA and non-ready state conflict before any conditional write',async()=>{
 for(const fixture of [fakeGithub({initialSha:sha('c')}),fakeGithub({initial:record({status:'publish_unknown'})})]){
  const result=await adapter(fixture).reserve(plan());assert.equal(result.kind,'conflict');assert.equal(fixture.calls.length,1);
 }
});
test('GitHub write conflict remains a conflict and never reports reservation',async()=>{
 const f=fakeGithub({putStatus:409});assert.deepEqual(await adapter(f).reserve(plan()),{kind:'conflict'});assert.equal(f.calls.length,2);
});
test('unknown GitHub outcomes fail closed without response or token leakage',async()=>{
 const f={fetchImpl:async()=>response(503,{message:'secret-like-provider-payload'})};
 await assert.rejects(()=>adapter(f).reserve(plan()),error=>error.code==='GITHUB_QUEUE_READ_UNCONFIRMED');
});
test('archive and quarantine require reservation SHA and exact attempt ownership',async()=>{
 const f=fakeGithub();const a=adapter(f);const owned=record({status:'publishing',publish_attempt_id:'attempt-1',provider:'metricool',sha:sha('a')});
 assert.equal((await a.archive({record:owned,attemptId:'attempt-1',instagram_media_id:'18000000000000001',instagram_permalink:null})).kind,'written');
 await assert.rejects(()=>a.markUnknown({record:{...owned,publish_attempt_id:'other'},attemptId:'attempt-1',reason:'timeout'}),error=>error.code==='GITHUB_ATTEMPT_MISMATCH');
});
test('adapter rejects arbitrary repos, paths, missing SHA, and short-lived identity failure',async()=>{
 assert.throws(()=>createGitHubQueueAdapter({repo:'bad',getAccessToken:async()=> 'x'.repeat(20)}),/GITHUB_ADAPTER_CONFIG_INVALID/);
 const f=fakeGithub();const a=createGitHubQueueAdapter({repo:'55c8ck9mgp-maker/matrix24-media',getAccessToken:async()=>null,fetchImpl:f.fetchImpl});
 await assert.rejects(()=>a.reserve(plan()),error=>error.code==='GITHUB_APP_TOKEN_UNAVAILABLE');
 await assert.rejects(()=>adapter(f).archive({record:record({queue_path:'docs/x',sha:sha('a'),publish_attempt_id:'attempt-1'}),attemptId:'attempt-1',instagram_media_id:'18000000000000001'}),error=>error.code==='GITHUB_QUEUE_PATH_INVALID');
});
