import test from 'node:test';
import assert from 'node:assert/strict';
import {runPublicationCycle} from '../publisher-v2/staging/src/engine.mjs';
import {createGitHubQueueAdapter} from '../publisher-v2/staging/src/github-queue-adapter.mjs';
import {createReconciliationQueueAdapter} from '../publisher-v2/staging/src/reconciliation-queue-adapter.mjs';

const sha = n => n.toString(16).padStart(40,'0').slice(-40);
const b64 = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const response = (status, body={}) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

function fakeGithub(initial) {
  let state={...initial,sha:sha(1)};
  let revision=1;
  const fetchImpl=async(url,init={})=>{
    if(init.method==='GET'){
      const {sha:currentSha,...body}=state;
      return response(200,{encoding:'base64',content:b64(body),sha:currentSha});
    }
    if(init.method==='PUT'){
      const body=JSON.parse(init.body);
      if(body.sha!==state.sha) return response(409,{message:'sha mismatch'});
      revision += 1;
      const next=JSON.parse(atob(body.content));
      state={...next,sha:sha(revision)};
      return response(200,{content:{sha:state.sha}});
    }
    return response(500);
  };
  return {fetchImpl,current:()=>({...state})};
}

const identity=()=>({verified:true,subject:'matrix24-auto-publisher',scopes:['queue:reserve']});

test('three consecutive isolated E2E cycles preserve exactly-once and ownership',async()=>{
  for(let i=1;i<=3;i++){
    const suffix=String(i).padStart(2,'0');
    const contentId='matrix24-e2e-cycle-'+suffix;
    const attemptId=`11111111-1111-4111-8111-1111111111${suffix}`;
    const mediaId=`1800000000000000${i}`;
    const initial={
      content_id:contentId,
      queue_path:`queue/${contentId}.json`,
      status:'ready_to_publish',
      caption:`fixture cycle ${i}`,
      publish_attempt_history:[]
    };
    const gh=fakeGithub(initial);
    const publisher=createGitHubQueueAdapter({
      repo:'55c8ck9mgp-maker/matrix24-media',
      getAccessToken:async()=> 'p'.repeat(24),
      fetchImpl:gh.fetchImpl
    });
    let sends=0;
    const publicationAdapter={
      ...publisher,
      async send(){ sends+=1; return {kind:'published',instagram_media_id:mediaId,instagram_permalink:`https://www.instagram.com/p/fixture-${i}/`}; }
    };
    const current=gh.current();
    const request={
      content_id:contentId,
      queue_path:initial.queue_path,
      expected_sha:current.sha,
      attempt_id:attemptId,
      requested_at:`2026-09-30T15:0${i}:00Z`
    };
    const publication=await runPublicationCycle({request,identity:identity(),current,adapter:publicationAdapter});
    assert.equal(publication.action,'reconcile_only',`cycle ${i}`);
    assert.equal(sends,1,`cycle ${i}`);

    const unresolved=gh.current();
    assert.equal(unresolved.status,'publishing',`cycle ${i}`);
    assert.equal(unresolved.publish_attempt_id,attemptId,`cycle ${i}`);
    assert.equal(unresolved.instagram_media_id,mediaId,`cycle ${i}`);

    const reconciliation=createReconciliationQueueAdapter({
      repo:'55c8ck9mgp-maker/matrix24-media',
      getAccessToken:async()=> 'r'.repeat(24),
      fetchImpl:gh.fetchImpl
    });
    const confirmed=await reconciliation.confirmPublished({
      record:unresolved,
      attemptId,
      instagram_media_id:mediaId,
      instagram_permalink:`https://www.instagram.com/p/fixture-${i}/`
    });
    assert.equal(confirmed.kind,'confirmed_published',`cycle ${i}`);
    assert.equal(gh.current().status,'published',`cycle ${i}`);
    assert.equal(gh.current().content_id,contentId,`cycle ${i}`);
    assert.equal(gh.current().publish_attempt_id,attemptId,`cycle ${i}`);
    assert.equal(sends,1,`cycle ${i}`);

    const replay=await runPublicationCycle({
      request:{...request,expected_sha:gh.current().sha},
      identity:identity(),
      current:gh.current(),
      adapter:publicationAdapter
    });
    assert.equal(replay.external_send_authorized,false,`cycle ${i}`);
    assert.equal(sends,1,`cycle ${i} replay`);
  }
});
