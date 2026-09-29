#!/usr/bin/env node
const transitions = new Map([
  ["candidate->approved","Editorial Approval"],
  ["candidate->discarded","Editorial Approval"],
  ["approved->media_ready","Media Builder"],
  ["approved->discarded","Editorial Approval"],
  ["media_ready->ready_to_publish","Queue Admission"],
  ["ready_to_publish->publishing","Publisher"],
  ["publishing->published","Confirmation/Reconciliation"],
  ["publishing->publish_unknown","Confirmation/Reconciliation"],
  ["publish_unknown->published","Confirmation/Reconciliation"],
  ["publish_unknown->discarded","Human Recovery Decision"],
]);

export function validateTransition({from,to,actor,record={}}) {
  const key = `${from}->${to}`;
  const owner = transitions.get(key);
  if (!owner) throw new Error(`ILLEGAL_TRANSITION:${key}`);
  if (actor !== owner) throw new Error(`WRONG_OWNER:${key}:expected=${owner}:actual=${actor}`);

  const activeClaim = Boolean(record.publish_attempt_id || record.publishing_started_at);
  const positiveEvidence = Boolean(record.instagram_media_id || record.instagram_permalink);

  if (to === "publishing" && activeClaim) throw new Error("DUPLICATE_PUBLICATION_CLAIM");
  if (from === "publish_unknown" && to === "published" && !positiveEvidence)
    throw new Error("PUBLISHED_WITHOUT_POSITIVE_EVIDENCE");
  if (from === "publishing" && to === "published" && !positiveEvidence)
    throw new Error("PUBLISHED_WITHOUT_POSITIVE_EVIDENCE");

  return {ok:true, owner};
}

if (process.argv[1] && process.argv[1].endsWith("core-v2-state-contract.mjs")) {
  console.log(JSON.stringify({ok:true, transitions:transitions.size, mode:"non-production"}));
}
