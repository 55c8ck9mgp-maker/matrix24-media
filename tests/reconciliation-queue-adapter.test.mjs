import test from 'node:test';
import assert from 'node:assert/strict';
import {createReconciliationQueueAdapter} from '../publisher-v2/staging/src/reconciliation-queue-adapter.mjs';

const sha = c => c.repeat(40);
const attemptId = '11111111-1111-4111-8111-111111111111';
const initial = {
  content_id:'matrix24-fixture-story',
  queue_path:'queue/matrix24-fixture-story.json',
  status:'publishing',
  provider:'metricool',
  publish_attempt_id:attemptId,
  publishing_started_at:'2026-09-30T14:00:00Z',
  publish_attempt_history:[]
};
const b64 = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const response = (status, body={}) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

function fakeGithub(record=initial) {
  let state={...record,sha:sha('a')};
  let puts=0;
  const fetchImpl=async(url,init={})=>{
    if(init.method==='GET'){
      const {sha:currentSha,...body}=state;
      return response(200,{encoding:'base64',content:b64(body),sha:currentSha});
    }
    if(init.method==='PUT'){
      puts++;
      const body=JSON.parse(init.body);
      if(body.sha!==state.sha) return response(409,{message:'sha mismatch'});
      const next=JSON.parse(atob(body.content));
      state={...next,sha:sha('b')};
      return response(200,{content:{sha:sha('b')}});
    }
    return response(500);
  };
  return {fetchImpl,current:()=>state,puts:()=>puts};
}

test('Reconciliation alone confirms an owned unresolved attempt with positive evidence',async()=>{
  const gh=fakeGithub();
  const adapter=createReconciliationQueueAdapter({repo:'55c8ck9mgp-maker/matrix24-media',getAccessToken:async()=> 'x'.repeat(24),fetchImpl:gh.fetchImpl});
  const supplied={...initial,sha:sha('a')};
  const result=await adapter.confirmPublished({record:supplied,attemptId,instagram_media_id:'18135178228630348',instagram_permalink:'https://www.instagram.com/p/fixture/'});
  assert.equal(result.kind,'confirmed_published');
  assert.equal(gh.puts(),1);
  assert.equal(gh.current().status,'published');
  assert.equal(gh.current().publish_attempt_id,attemptId);
  assert.equal(gh.current().instagram_media_id,'18135178228630348');
});

test('Reconciliation refuses stale snapshot, foreign attempt, terminal state, or missing positive evidence',async()=>{
  for(const variant of [
    {supplied:{...initial,sha:sha('c')},attempt:attemptId,media:'18135178228630348'},
    {supplied:{...initial,sha:sha('a')},attempt:'22222222-2222-4222-8222-222222222222',media:'18135178228630348'},
    {supplied:{...initial,status:'published',sha:sha('a')},remote:{...initial,status:'published'},attempt:attemptId,media:'18135178228630348'}
  ]){
    const gh=fakeGithub(variant.remote||initial);
    const adapter=createReconciliationQueueAdapter({repo:'55c8ck9mgp-maker/matrix24-media',getAccessToken:async()=> 'x'.repeat(24),fetchImpl:gh.fetchImpl});
    const result=await adapter.confirmPublished({record:variant.supplied,attemptId:variant.attempt,instagram_media_id:variant.media});
    assert.equal(result.kind,'conflict');
    assert.equal(gh.puts(),0);
  }
  const gh=fakeGithub();
  const adapter=createReconciliationQueueAdapter({repo:'55c8ck9mgp-maker/matrix24-media',getAccessToken:async()=> 'x'.repeat(24),fetchImpl:gh.fetchImpl});
  await assert.rejects(()=>adapter.confirmPublished({record:{...initial,sha:sha('a')},attemptId,instagram_media_id:''}),/RECONCILIATION_CONFIRMATION_INVALID/);
  assert.equal(gh.puts(),0);
});
