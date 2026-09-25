// Offline staging contract only. It cannot send, retry, mutate claims, or call providers.
const mediaId = value => typeof value === 'string' && /^[0-9]+$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const immutable = value => Object.freeze({ ...value });

function sameBinding(record, receipt) {
  return receipt?.kind === 'published_media' && mediaId(receipt.media_id) &&
    text(record?.content_id) && text(record?.attempt_id) && text(record?.account_id) &&
    receipt.content_id === record.content_id &&
    receipt.attempt_id === record.attempt_id &&
    receipt.account_id === record.account_id;
}

export function prepareDurableAttempt(record) {
  const base = { sendAllowed: false, retryAllowed: false, clearClaimAllowed: false, continueEditorial: true };
  if (!record || record.status !== 'ready_to_publish' || !text(record.content_id) ||
      !text(record.attempt_id) || !text(record.account_id) || !text(record.payload_hash)) {
    return immutable({ ...base, action: 'invalid_or_unready_attempt' });
  }
  return immutable({ ...base, action: 'persist_pre_send_receipt', receipt: immutable({
    kind: 'pre_send', content_id: record.content_id, attempt_id: record.attempt_id,
    account_id: record.account_id, payload_hash: record.payload_hash
  }) });
}

export function classifyProviderOutcome(attempt, outcome = {}) {
  const base = { sendAllowed: false, retryAllowed: false, clearClaimAllowed: false, continueEditorial: true };
  if (!attempt || !text(attempt.content_id) || !text(attempt.attempt_id) ||
      !text(attempt.account_id) || !text(attempt.payload_hash)) {
    return immutable({ ...base, action: 'invalid_attempt' });
  }
  if (!mediaId(outcome.media_id)) {
    return immutable({ ...base, action: 'quarantine_publish_unknown', publication: 'unknown',
      reason: 'missing_or_invalid_published_media_id' });
  }
  return immutable({ ...base, action: 'persist_published_media_receipt', publication: 'confirmed',
    receipt: immutable({ kind: 'published_media', content_id: attempt.content_id,
      attempt_id: attempt.attempt_id, account_id: attempt.account_id,
      payload_hash: attempt.payload_hash, media_id: outcome.media_id }) });
}

export function reconcileDurableReceipt(record, receipt, lookup = {}) {
  const base = { sendAllowed: false, retryAllowed: false, clearClaimAllowed: false, continueEditorial: true };
  if (!sameBinding(record, receipt)) {
    return immutable({ ...base, action: 'retain_claim_and_reconcile', publication: 'unknown' });
  }
  const exactLookup = lookup.kind === 'ig_media' && lookup.id === receipt.media_id &&
    lookup.owner_id === record.account_id;
  return immutable({ ...base, action: 'archive_confirmed_receipt',
    publication: 'confirmed', media_id: receipt.media_id,
    verification: exactLookup ? 'direct_lookup' : 'receipt_only',
    permalink: exactLookup && text(lookup.permalink) ? lookup.permalink : null });
}
