import assert from "node:assert/strict";
import { validateTransition } from "./core-v2-state-contract.mjs";

assert.equal(validateTransition({from:"candidate",to:"approved",actor:"Editorial Approval"}).ok,true);
assert.equal(validateTransition({from:"ready_to_publish",to:"publishing",actor:"Publisher"}).ok,true);
assert.throws(()=>validateTransition({from:"ready_to_publish",to:"publishing",actor:"Auditor"}),/WRONG_OWNER/);
assert.throws(()=>validateTransition({from:"published",to:"publishing",actor:"Publisher"}),/ILLEGAL_TRANSITION/);
assert.throws(()=>validateTransition({from:"ready_to_publish",to:"publishing",actor:"Publisher",record:{publish_attempt_id:"existing"}}),/DUPLICATE_PUBLICATION_CLAIM/);
assert.throws(()=>validateTransition({from:"publishing",to:"published",actor:"Confirmation\/Reconciliation",record:{publish_attempt_id:"a"}}),/PUBLISHED_WITHOUT_POSITIVE_EVIDENCE/);
assert.equal(validateTransition({from:"publishing",to:"published",actor:"Confirmation/Reconciliation",record:{publish_attempt_id:"a",instagram_media_id:"ig1"}}).ok,true);
console.log("Core v2 state contract tests: PASS");
