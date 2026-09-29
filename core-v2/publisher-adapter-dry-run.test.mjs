import assert from "node:assert/strict"; import {preparePublishAttempt,executeExternalPublish} from "./publisher-adapter-dry-run.mjs";
const r={content_id:"matrix24-test-1",status:"ready_to_publish"};
const a=preparePublishAttempt(r); const b=preparePublishAttempt(r);
assert.equal(a.attempt_id,b.attempt_id); assert.equal(a.external_calls,0); assert.equal(a.actor,"core-v2/claude-publisher");
assert.throws(()=>preparePublishAttempt({...r,status:"publishing"}),/NOT_READY/);
assert.throws(()=>preparePublishAttempt({...r,publish_attempt_id:"old"}),/CLAIM/);
assert.throws(()=>preparePublishAttempt(r,{mode:"LIVE"}),/EXTERNAL_PUBLISH_DISABLED/);
assert.throws(()=>executeExternalPublish(),/NETWORK_BARRIER_ACTIVE/);
console.log("Core v2 publisher dry-run network barrier: PASS");
