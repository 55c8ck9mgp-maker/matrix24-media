export const HEALTH_STATES = Object.freeze({
  HEALTHY: 'HEALTHY',
  BLOCKED_PROVIDER: 'BLOCKED_PROVIDER',
  AMBIGUOUS: 'AMBIGUOUS',
  ACTION_REQUIRED: 'ACTION_REQUIRED'
});

const validMediaId = value => typeof value === 'string' && /^[0-9]+$/.test(value);
const validInstagramPermalink = value => typeof value === 'string' &&
  /^https:\/\/(?:www\.)?instagram\.com\/[^\s]+/i.test(value);

function publicationEvidence(record = {}) {
  return validMediaId(record.instagram_media_id) || validInstagramPermalink(record.instagram_permalink);
}

function invalidEvidenceField(record = {}) {
  const mediaIdPresent = record.instagram_media_id != null && record.instagram_media_id !== '';
  const permalinkPresent = record.instagram_permalink != null && record.instagram_permalink !== '';
  return (mediaIdPresent && !validMediaId(record.instagram_media_id)) ||
    (permalinkPresent && !validInstagramPermalink(record.instagram_permalink));
}

export function classifyMatrix24Health({ queueRecords = [], provider = {} } = {}) {
  const ambiguous = queueRecords.filter((r) => r?.status === 'publish_unknown' ||
    (r?.status === 'publishing' && r?.publish_attempt_id && r?.publishing_started_at && !r?.instagram_media_id));
  if (ambiguous.length) return { state: HEALTH_STATES.AMBIGUOUS, reason: 'unresolved_publication_outcome', content_ids: ambiguous.map((r) => r.content_id).filter(Boolean) };

  const invalid = queueRecords.filter((r) => {
    if (!r || invalidEvidenceField(r)) return true;
    const hasEvidence = publicationEvidence(r);
    const hasClaim = Boolean(r.publish_attempt_id || r.publishing_started_at);
    return (r.status === 'published' && (!hasEvidence || hasClaim)) ||
      (r.status === 'ready_to_publish' && (hasClaim || hasEvidence)) ||
      (r.status === 'publishing' && (!r.publish_attempt_id || !r.publishing_started_at || hasEvidence));
  });
  if (invalid.length) return { state: HEALTH_STATES.ACTION_REQUIRED, reason: 'queue_invariant_violation', content_ids: invalid.map((r) => r?.content_id).filter(Boolean) };

  const permissionBlocked = provider.instagram_content_publish === false ||
    queueRecords.some((r) => (r?.publish_attempt_history || []).some((h) =>
      ['instagram_content_publish_permission_missing_error_10','instagram_content_publish_permission_missing_error_10_after_oauth_reauthorization'].includes(h?.reason)
    )) && provider.instagram_content_publish !== true;
  if (permissionBlocked) return { state: HEALTH_STATES.BLOCKED_PROVIDER, reason: 'instagram_content_publish', account_id: provider.account_id || null };

  return { state: HEALTH_STATES.HEALTHY, reason: 'no_blocking_condition' };
}
