import assert from "node:assert/strict";
import {preparePublishAttempt} from "./publisher-adapter-dry-run.mjs";
import {reconcileMatch} from "./reconciler-match.mjs";
import {decideReconciliation,mayPublish} from "./reconciliation-decision.mjs";

function claimed(id="case"){const p=preparePublishAttempt({content_id:id,status:"ready_to_publish"});return {content_id:id,status:"publishing",publish_attempt_id:p.attempt_id,caption:"Full canonical caption for breaking story",media_sha256:"sha-"+id};}

// timeout/no evidence: preserve same claim, no retry
let r=claimed("timeout"); let d=decideReconciliation(r,{status:"no_match"});
assert.equal(d.action,"KEEP_CLAIM"); assert.equal(d.target_status,"publish_unknown"); assert.equal(mayPublish({...r,status:"publish_unknown"}),false);

// shortened caption: reconcile same attempt
r=claimed("short"); let m=reconcileMatch(r,[{id:"ig-short",caption:"Full canonical caption"}]); d=decideReconciliation(r,m);
assert.equal(m.status,"matched"); assert.equal(d.action,"CLOSE_EXISTING_CLAIM"); assert.equal(d.claim_id,r.publish_attempt_id);

// ambiguous external posts: fail closed, no retry
r=claimed("amb"); m=reconcileMatch(r,[{id:"ig-a",caption:"Full canonical caption"},{id:"ig-b",caption:"Full canonical caption"}]); d=decideReconciliation(r,m);
assert.equal(m.status,"ambiguous"); assert.equal(d.action,"KEEP_CLAIM"); assert.equal(d.target_status,"publish_unknown"); assert.equal(mayPublish({...r,status:"publish_unknown"}),false);

// duplicate/stale claim blocks a new publish attempt
assert.throws(()=>preparePublishAttempt({content_id:"dup",status:"ready_to_publish",publish_attempt_id:"existing"}),/CLAIM/);

// exact content_id evidence wins even with unrelated caption
r=claimed("identity"); m=reconcileMatch(r,[{id:"ig-id",content_id:"identity",caption:"different"}]); d=decideReconciliation(r,m);
assert.equal(m.status,"matched"); assert.equal(d.action,"CLOSE_EXISTING_CLAIM");

console.log("Core v2 integrated failure simulation: PASS");
