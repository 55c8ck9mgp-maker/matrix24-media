// Offline Postiz -> LKG v2 adapter contract only.
// No credentials, transport, scheduling, provider calls, timers, or production entry point.
//
// Mirrors worker/staging/reliability/metricool-adapter.mjs's contract and
// safety posture exactly, adapted to Postiz's request/response shape. Kept
// as a separate module (not a generic rename) because the wire shapes truly
// differ: Metricool returns a bare {id, uuid}; Postiz's public API returns a
// posts array whose per-item shape is not fully documented (see
// docs/reliability/POSTIZ_TRANSPORT_STAGING.md for the exact gate). Treat
// this module's success-shape assumption as unverified until checked against
// a live Postiz instance.
const text = v => typeof v === 'string' && v.trim().length > 0;
const postId = v => typeof v === 'string' && v.trim().length > 0;
const immutable = v => Object.freeze({ ...v });

const base = () => ({
  scheduleAllowed: false,
  publishAllowed: false,
  retryAllowed: false,
  clearClaimAllowed: false,
  continueEditorial: true
});

export function preparePostizSubmission(attempt) {
  if (!attempt || attempt.status !== 'publishing' || !text(attempt.content_id) ||
      !text(attempt.attempt_id) || !text(attempt.account_id) || !text(attempt.payload_hash)) {
    return immutable({ ...base(), action: 'invalid_or_unreserved_attempt' });
  }
  return immutable({ ...base(), action: 'persist_postiz_pre_send_receipt',
    receipt: immutable({ kind: 'postiz_pre_send', content_id: attempt.content_id,
      attempt_id: attempt.attempt_id, account_id: attempt.account_id,
      payload_hash: attempt.payload_hash }) });
}

export function classifyPostizScheduleResult(attempt, result = {}) {
  if (!attempt || !text(attempt.content_id) || !text(attempt.attempt_id) ||
      !text(attempt.account_id) || !text(attempt.payload_hash)) {
    return immutable({ ...base(), action: 'invalid_attempt' });
  }
  // A Postiz scheduler acceptance proves only that the scheduling job was
  // accepted, never that Instagram actually published anything. Same
  // posture as Metricool's id/uuid receipt: 'pending_provider', not
  // 'published'. Postiz's create-post response is documented to return the
  // created post(s); we require at least one post entry carrying a
  // non-empty id before treating this as even a schedule acceptance.
  const posts = Array.isArray(result.posts) ? result.posts : (Array.isArray(result) ? result : []);
  const accepted = posts.length > 0 && posts.every(p => postId(p?.id));
  if (accepted) {
    return immutable({ ...base(), action: 'persist_postiz_scheduled_receipt',
      publication: 'pending_provider',
      receipt: immutable({ kind: 'postiz_scheduled', content_id: attempt.content_id,
        attempt_id: attempt.attempt_id, account_id: attempt.account_id,
        payload_hash: attempt.payload_hash, postiz_post_ids: posts.map(p => p.id) }) });
  }
  // If the scheduling call may have crossed the provider boundary, absence
  // of a recognizable receipt is ambiguous, exactly like Metricool.
  return immutable({ ...base(), action: 'quarantine_publish_unknown',
    publication: 'unknown', reason: 'postiz_schedule_outcome_ambiguous' });
}

export function classifyPostizPublicationEvidence(attempt, evidence = {}) {
  if (!attempt || !text(attempt.content_id) || !text(attempt.attempt_id) ||
      !text(attempt.account_id) || !text(attempt.payload_hash)) {
    return immutable({ ...base(), action: 'invalid_attempt' });
  }
  const exact = evidence.kind === 'instagram_media' &&
    typeof evidence.media_id === 'string' && /^[0-9]+$/.test(evidence.media_id) &&
    evidence.account_id === attempt.account_id &&
    evidence.content_id === attempt.content_id;
  if (!exact) {
    return immutable({ ...base(), action: 'retain_claim_and_reconcile', publication: 'unknown' });
  }
  return immutable({ ...base(), action: 'persist_published_media_receipt', publication: 'confirmed',
    receipt: immutable({ kind: 'published_media', content_id: attempt.content_id,
      attempt_id: attempt.attempt_id, account_id: attempt.account_id,
      payload_hash: attempt.payload_hash, media_id: evidence.media_id }),
    permalink: text(evidence.permalink) ? evidence.permalink : null });
}

export function classifyPostizPreWriteFailure(attempt, failure = {}) {
  if (!attempt || !text(attempt.attempt_id)) {
    return immutable({ ...base(), action: 'invalid_attempt' });
  }
  // Claim may be restored only with durable proof that Postiz was never invoked.
  if (failure.action_not_invoked === true) {
    return immutable({ ...base(), action: 'action_not_invoked', publication: 'not_sent',
      clearClaimAllowed: true });
  }
  return immutable({ ...base(), action: 'quarantine_publish_unknown', publication: 'unknown' });
}
