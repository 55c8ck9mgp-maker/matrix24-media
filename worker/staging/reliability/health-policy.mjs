const TERMINAL = new Set(['published']);

export function classifyHealthRecord(record) {
  const result = { countsForAutonomousStreak: false, duplicateStatus: 'unknown' };
  if (!record || !TERMINAL.has(record.status)) return { ...result, state: 'not_terminal' };
  if (typeof record.instagram_media_id !== 'string' || !/^\d+$/.test(record.instagram_media_id)) {
    return { ...result, state: 'published_without_valid_media_id' };
  }
  const history = Array.isArray(record.publish_attempt_history) ? record.publish_attempt_history : [];
  const published = history.filter(entry => entry?.stage === 'instagram_publish' && entry?.result === 'success' && entry.instagram_media_id === record.instagram_media_id);
  if (published.length !== 1) return { ...result, state: 'insufficient_publish_evidence' };
  if (history.some(entry => /unknown|manual|controlled_retry|recovered/i.test(`${entry?.result || ''} ${entry?.recovery_type || ''} ${entry?.note || ''}`))) {
    return { ...result, state: 'ambiguous_or_manual_history' };
  }
  if (!history.some(entry => entry?.stage === 'media_pipeline' && entry?.result === 'success')) {
    return { ...result, state: 'missing_media_evidence' };
  }
  return { ...result, state: 'autonomous_candidate', countsForAutonomousStreak: true };
}

export function classifyReadObservation({ sourceFetchedAt, attemptAt, matchingMediaIds = [] }) {
  const result = { positive: false, absenceProof: false };
  if (!Array.isArray(matchingMediaIds)) return { ...result, state: 'invalid_observation' };
  if (matchingMediaIds.length) return { ...result, state: 'positive_match', positive: true };
  const sourceTime = Date.parse(sourceFetchedAt || '');
  const attemptTime = Date.parse(attemptAt || '');
  if (!Number.isFinite(sourceTime) || !Number.isFinite(attemptTime)) return { ...result, state: 'freshness_unknown' };
  if (sourceTime < attemptTime) return { ...result, state: 'snapshot_predates_attempt' };
  return { ...result, state: 'empty_read_inconclusive' };
}

export function monitorAction({ connectorHealth, records }) {
  const checked = Array.isArray(records) ? records.map(classifyHealthRecord) : [];
  const degraded = connectorHealth !== 'healthy';
  return {
    action: 'read_only_report',
    writesAllowed: false,
    publicationAllowed: false,
    phase2Allowed: false,
    degraded,
    autonomousCandidates: checked.filter(record => record.countsForAutonomousStreak).length,
    uncertainRecords: checked.filter(record => !record.countsForAutonomousStreak).length
  };
}
