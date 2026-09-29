import assert from "node:assert/strict";
import {preparePublishAttempt} from "./publisher-adapter-dry-run.mjs";
import {reconcileMatch} from "./reconciler-match.mjs";
import {decideReconciliation} from "./reconciliation-decision.mjs";
const seen=new Set();
for(let i=1;i<=3;i++){
 const content_id="dry-cycle-"+i;
 assert.equal(seen.has(content_id),false); seen.add(content_id);
 const p=preparePublishAttempt({content_id,status:"ready_to_publish",caption:"Canonical story "+i});
 const r={content_id,status:"publishing",caption:"Canonical story "+i,publish_attempt_id:p.attempt_id};
 const m=reconcileMatch(r,[{id:"sim-ig-"+i,content_id,caption:"short"}]);
 const d=decideReconciliation(r,m);
 assert.equal(d.action,"CLOSE_EXISTING_CLAIM"); assert.equal(d.claim_id,p.attempt_id);
}
assert.equal(seen.size,3);
console.log("Core v2 three consecutive dry cycles: PASS");
