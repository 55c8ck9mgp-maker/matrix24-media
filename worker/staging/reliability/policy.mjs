// Offline policy model only. No transport, credentials, timers, or production entry point.
const knownStates = new Set(['ready_to_publish', 'publishing', 'publish_unknown', 'published']);
const validId = value => typeof value === 'string' && /^[0-9]+$/.test(value);
const required = value => typeof value === 'string' && value.trim().length > 0;

export function assessPublication(record, evidence = {}) {
  // Deliberately never authorizes a publish/retry. A transport adapter needs separate review.
  const base = { publishAllowed: false, clearClaim: false, continueEditorial: true };
  if (!record || !knownStates.has(record.status) || !required(record.account_id) ||
      !required(record.content_id)) return { ...base, action: 'invalid_record' };
  if (record.media_id != null && record.media_id !== '' && !validId(record.media_id)) {
    return { ...base, action: 'invalid_media_id' };
  }
  const rows = Array.isArray(evidence.rows) ? evidence.rows : [];
  const owned = rows.filter(row => row.account_id === record.account_id && validId(row.media_id));
  if (validId(record.media_id)) {
    const matches = owned.filter(row => row.media_id === record.media_id);
    return { ...base, action: matches.length ? 'verified' : 'verification_pending',
      publication: 'confirmed', media_id: record.media_id };
  }
  // A durable success receipt must identify the account, content, attempt, and published media.
  // An arbitrary top-level id/container id or a numeric JS ID is not a success receipt.
  const receipt = evidence.receipt;
  if (receipt?.kind === 'published_media' && validId(receipt.media_id) &&
      required(record.attempt_id) && receipt.attempt_id === record.attempt_id &&
      receipt.account_id === record.account_id && receipt.content_id === record.content_id) {
    return { ...base, action: 'archive_receipt', publication: 'confirmed', media_id: receipt.media_id };
  }
  // A candidate caption match needs manual/authoritative identity resolution. Never auto-adopt it.
  if (owned.length && (record.status === 'publishing' || record.status === 'publish_unknown')) {
    return { ...base, action: 'review_candidates', publication: 'unknown' };
  }
  if (record.status === 'published') return { ...base, action: 'published_missing_evidence' };
  if (record.status === 'publishing' || record.status === 'publish_unknown' || record.claim) {
    return { ...base, action: 'reconcile_only', publication: 'unknown' };
  }
  return { ...base, action: 'preflight_required' };
}

export function readFreshness(fetchedAt, submittedAt) {
  // Reject timezone-less timestamps; adapter must normalize documented UTC explicitly.
  const parse = value => typeof value === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(value)
    ? Date.parse(value) : NaN;
  const fetched = parse(fetchedAt), submitted = parse(submittedAt);
  if (!Number.isFinite(fetched) || !Number.isFinite(submitted)) return 'unknown';
  return fetched < submitted ? 'predates_attempt' : 'after_attempt_not_proof_of_absence';
}

export function readRetryDelay({ attempt, status, retryAfterSeconds = 0 }) {
  // Two additional retries, reads only. null = stop this polling cycle.
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 2 ||
      ![408, 429, 500, 502, 503, 504, 'network'].includes(status)) return null;
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0) return null;
  // Long Retry-After values go to a scheduler, never hold a worker or ignore provider limits.
  return Math.max(attempt === 1 ? 5 : 20, retryAfterSeconds);
}

export function assertStagingConfig(config) {
  const allowed = new Set(['$schema', 'name', 'main', 'compatibility_date', 'workers_dev', 'preview_urls', 'vars']);
  if (!config || Object.keys(config).some(key => !allowed.has(key)) ||
      config.name !== 'matrix24-publisher-staging' || config.main !== 'src/index.js' ||
      Object.keys(config.vars || {}).length !== 1 ||
      config.vars.MATRIX24_MODE !== 'staging-fixtures-only') throw new Error('STAGING_NOT_ISOLATED');
  return true;
}
