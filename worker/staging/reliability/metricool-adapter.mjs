// Offline Metricool -> LKG v2 adapter contract only.
// No credentials, transport, scheduling, provider calls, timers, or production entry point.
const text = v => typeof v === 'string' && v.trim().length > 0;
const mediaId = v => typeof v === 'string' && /^[0-9]+$/.test(v);
const immutable = v => Object.freeze({ ...v });

const base = () => ({
  scheduleAllowed: false,
  publishAllowed: false,
  retryAllowed: false,
  clearClaimAllowed: false,
  continueEditorial: true
});

export function prepareMetricoolSubmission(attempt) {
  if (!attempt || attempt.status !== 'publishing' || !text(attempt.content_id) ||
      !text(attempt.attempt_id) || !text(attempt.account_id) || !text(attempt.payload_hash)) {
    return immutable({ ...base(), action: 'invalid_or_unreserved_attempt' });
  }
  return immutable({ ...base(), action: 'persist_metricool_pre_send_receipt',
    receipt: immutable({ kind: 'metricool_pre_send', content_id: attempt.content_id,
      attempt_id: attempt.attempt_id, account_id: attempt.account_id,
      payload_hash: attempt.payload_hash }) });
}

export function classifyMetricoolScheduleResult(attempt, result = {}) {
  if (!attempt || !text(attempt.content_id) || !text(attempt.attempt_id) ||
      !text(attempt.account_id) || !text(attempt.payload_hash)) {
    return immutable({ ...base(), action: 'invalid_attempt' });
  }
  // A Metricool planner id/uuid proves only scheduler acceptance, never Instagram publication.
  if (text(result.id) && text(result.uuid)) {
    return immutable({ ...base(), action: 'persist_metricool_scheduled_receipt',
      publication: 'pending_provider',
      receipt: immutable({ kind: 'metricool_scheduled', content_id: attempt.content_id,
        attempt_id: attempt.attempt_id, account_id: attempt.account_id,
        payload_hash: attempt.payload_hash, metricool_id: result.id, metricool_uuid: result.uuid }) });
  }
  // If the scheduling call may have crossed the provider boundary, absence of a receipt is ambiguous.
  return immutable({ ...base(), action: 'quarantine_publish_unknown',
    publication: 'unknown', reason: 'metricool_schedule_outcome_ambiguous' });
}

export function classifyMetricoolPublicationEvidence(attempt, evidence = {}) {
  if (!attempt || !text(attempt.content_id) || !text(attempt.attempt_id) ||
      !text(attempt.account_id) || !text(attempt.payload_hash)) {
    return immutable({ ...base(), action: 'invalid_attempt' });
  }
  const exact = evidence.kind === 'instagram_media' &&
    mediaId(evidence.media_id) &&
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

export function classifyMetricoolPreWriteFailure(attempt, failure = {}) {
  if (!attempt || !text(attempt.attempt_id)) {
    return immutable({ ...base(), action: 'invalid_attempt' });
  }
  // Claim may be restored only with durable proof that Metricool was never invoked.
  if (failure.action_not_invoked === true) {
    return immutable({ ...base(), action: 'action_not_invoked', publication: 'not_sent',
      clearClaimAllowed: true });
  }
  return immutable({ ...base(), action: 'quarantine_publish_unknown', publication: 'unknown' });
}
