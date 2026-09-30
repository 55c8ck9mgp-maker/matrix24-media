import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('identity proof is manual, remote-binding only, and provider-free',()=>{
 const config=JSON.parse(fs.readFileSync('publisher-v2/identity-proof/wrangler.jsonc','utf8'));
 assert.deepEqual(config.services,[{
   binding:'IDENTITY_GATE',
   service:'matrix24-publisher-v2-identity-caller',
   entrypoint:'IdentityGate',
   remote:true
 }]);
 const workflow=fs.readFileSync('.github/workflows/publication-v2-live-identity-proof.yml','utf8');
 assert.match(workflow,/workflow_dispatch/);
 assert.match(workflow,/contents: read/);
 assert.doesNotMatch(workflow,/schedule:/);
 assert.doesNotMatch(workflow,/wrangler deploy/);
 const combined=workflow+fs.readFileSync('publisher-v2/identity-proof/src/index.mjs','utf8')+fs.readFileSync('publisher-v2/identity-proof/run.mjs','utf8');
 assert.doesNotMatch(combined,/METRICOOL|INSTAGRAM|ready_to_publish|publish_attempt_id/i);
});
