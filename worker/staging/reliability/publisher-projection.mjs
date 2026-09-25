// Offline staging model. It has no transport, filesystem, queue, credential, or provider access.
// Its sole purpose is to specify the only legal state projections for an external publisher.
const text = value => typeof value === 'string' && value.trim().length > 0;
const mediaId = value => typeof value === 'string' && /^[0-9]+$/.test(value);
const freeze = value => Object.freeze({ ...value });

const base = Object.freeze({
  publishAllowed: false,
  retryAllowed: false,
  clearClaimAllowed: false,
  continueEditorial: true
});

function validReady(record) {
  return record?.status === 'ready_to_publish' && text(record.content_id) &&
    text(record.account_id) && text(record.payload_hash) && text(record.attempt_id) &&
    text(record.public_image_url);
}

function sameAttempt(record, attempt) {
  return text(attempt?.attempt_id) && record?.attempt_id === attempt.attempt_id &&
    record?.content_id === attempt.content_id && record?.account_id === attempt.account_id &&
    record?.payload_hash === attempt.payload_hash;
}

export function projectPreSendClaim(record) {
  if (!validReady(record)) return freeze({ ...base, action: 'invalid_or_unready_record' });
  return freeze({ ...base, action: 'persist_publishing_claim', record: freeze({
    ...record,
    status: 'publishing',
    publish_claim: freeze({
      attempt_id: record.attempt_id,
      content_id: record.content_id,
      account_id: record.account_id,
      payload_hash: record.payload_hash,
      state: 'pre_send'
    })
  }) });
}

export function projectProviderResult(record, outcome = {}) {
  if (record?.status !== 'publishing' || !sameAttempt(record, outcome)) {
    return freeze({ ...base, action: 'retain_and_reconcile' });
  }
  if (!mediaId(outcome.media_id)) {
    return freeze({ ...base, action: 'quarantine_publish_unknown', record: freeze({
      ...record,
      status: 'publish_unknown',
      publish_claim: freeze({ ...record.publish_claim, state: 'outcome_unknown' }),
      publish_attempt: freeze({ attempt_id: record.attempt_id, outcome: 'unknown' })
    }) });
  }
  return freeze({ ...base, action: 'persist_confirmed_publication', record: freeze({
    ...record,
    status: 'published',
    media_id: outcome.media_id,
    permalink: text(outcome.permalink) ? outcome.permalink : null,
    publish_claim: freeze({ ...record.publish_claim, state: 'confirmed' }),
    publish_attempt: freeze({ attempt_id: record.attempt_id, outcome: 'confirmed', media_id: outcome.media_id })
  }) });
}

export function projectReconciliation(record, lookup = {}) {
  if ((record?.status !== 'publishing' && record?.status !== 'publish_unknown') ||
      !sameAttempt(record, lookup) || !mediaId(lookup.media_id) || lookup.owner_id !== record.account_id) {
    return freeze({ ...base, action: 'retain_and_reconcile' });
  }
  return freeze({ ...base, action: 'reconcile_exact_media', record: freeze({
    ...record,
    status: 'published',
    media_id: lookup.media_id,
    permalink: text(lookup.permalink) ? lookup.permalink : null,
    publish_claim: freeze({ ...record.publish_claim, state: 'reconciled' }),
    publish_attempt: freeze({ attempt_id: record.attempt_id, outcome: 'reconciled', media_id: lookup.media_id })
  }) });
}
