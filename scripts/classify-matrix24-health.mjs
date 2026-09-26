export const HEALTH_STATES = Object.freeze({
  HEALTHY: 'HEALTHY',
  BLOCKED_PROVIDER: 'BLOCKED_PROVIDER',
  AMBIGUOUS: 'AMBIGUOUS',
  ACTION_REQUIRED: 'ACTION_REQUIRED'
});

export function classifyMatrix24Health({ queueRecords = [], provider = {} } = {}) {
  const ambiguous = queueRecords.filter((r) => r?.status === 'publish_unknown' || (r?.status === 'publishing' && r?.publish_attempt_id && r?.publishing_started_at && !r?.instagram_media_id));
  if (ambiguous.length) return { state: HEALTH_STATES.AMBIGUOUS, reason: 'unresolved_publication_outcome', content_ids: ambiguous.map((r) => r.content_id).filter(Boolean) };

  const invalid = queueRecords.filter((r) =>
    (r?.status === 'published' && (!r.instagram_media_id || r.publish_attempt_id || r.publishing_started_at)) ||
    (r?.status === 'ready_to_publish' && (r.publish_attempt_id || r.publishing_started_at || r.instagram_media_id)) ||
    (r?.status === 'publishing' && (!r.publish_attempt_id || !r.publishing_started_at || r.instagram_media_id))
  );
  if (invalid.length) return { state: HEALTH_STATES.ACTION_REQUIRED, reason: 'queue_invariant_violation', content_ids: invalid.map((r) => r.content_id).filter(Boolean) };

  const permissionBlocked = provider.instagram_content_publish === false ||
    queueRecords.some((r) => (r?.publish_attempt_history || []).some((h) =>
      ['instagram_content_publish_permission_missing_error_10','instagram_content_publish_permission_missing_error_10_after_oauth_reauthorization'].includes(h?.reason)
    )) && provider.instagram_content_publish !== true;
  if (permissionBlocked) return { state: HEALTH_STATES.BLOCKED_PROVIDER, reason: 'instagram_content_publish', account_id: provider.account_id || null };

  return { state: HEALTH_STATES.HEALTHY, reason: 'no_blocking_condition' };
}
