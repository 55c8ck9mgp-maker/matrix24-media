import assert from "node:assert/strict";
import { validateTransition } from "./core-v2-state-contract.mjs";

const owners = {
  approve: "Editorial Approval",
  media: "Media Builder",
  admit: "Queue Admission",
  publish: "Publisher",
  confirm: "Confirmation/Reconciliation",
};

function transition(record, to, actor) {
  validateTransition({ from: record.status, to, actor, record });
  return { ...record, status: to };
}

function runDryCycle(contentId) {
  let externalPublishCalls = 0;
  let r = { content_id: contentId, status: "candidate" };

  r = transition(r, "approved", owners.approve);
  r = transition(r, "media_ready", owners.media);
  r = transition(r, "ready_to_publish", owners.admit);

  validateTransition({ from:r.status, to:"publishing", actor:owners.publish, record:r });
  r = {
    ...r,
    status:"publishing",
    publish_attempt_id:`dry-${contentId}`,
    publishing_started_at:"2026-09-29T00:00:00Z"
  };

  // Fake provider only. No network call and no production credential.
  externalPublishCalls += 1;
  const providerEvidence = {
    instagram_media_id:`dry-ig-${contentId}`,
    instagram_permalink:`https://example.invalid/dry/${contentId}`
  };

  r = { ...r, ...providerEvidence };
  r = transition(r, "published", owners.confirm);
  delete r.publish_attempt_id;
  delete r.publishing_started_at;

  assert.equal(r.status, "published");
  assert.equal(externalPublishCalls, 1);
  assert.ok(r.instagram_media_id);

  assert.throws(
    () => validateTransition({from:r.status,to:"publishing",actor:owners.publish,record:r}),
    /ILLEGAL_TRANSITION/
  );

  return { record:r, externalPublishCalls };
}

for (let i=1;i<=3;i++) {
  const result=runDryCycle(`simulation-${i}`);
  assert.equal(result.externalPublishCalls,1);
}

console.log("Core v2 end-to-end dry-run: PASS (3/3 cycles, exactly one fake publish each)");
