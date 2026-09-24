import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHealthRecord, classifyReadObservation, monitorAction } from '../worker/staging/reliability/health-policy.mjs';

const record = (overrides = {}) => ({
  status: 'published', instagram_media_id: '17900000000000001',
  publish_attempt_history: [
    { stage: 'media_pipeline', result: 'success' },
    { stage: 'instagram_publish', result: 'success', instagram_media_id: '17900000000000001' }
  ], ...overrides
});

test('only complete, unambiguous durable evidence is an autonomous candidate', () => {
  assert.equal(classifyHealthRecord(record()).countsForAutonomousStreak, true);
  for (const change of [
    { instagram_media_id: null },
    { publish_attempt_history: [] },
    { publish_attempt_history: [...record().publish_attempt_history, { stage: 'instagram_publish', result: 'unknown' }] },
    { publish_attempt_history: [{ stage: 'instagram_publish', result: 'success', instagram_media_id: '17900000000000001' }] }
  ]) assert.equal(classifyHealthRecord(record(change)).countsForAutonomousStreak, false);
});

test('empty feed reads never establish absence', () => {
  assert.deepEqual(classifyReadObservation({ sourceFetchedAt: '2026-09-24T20:32:13Z', attemptAt: '2026-09-24T21:06:30Z' }), { positive: false, absenceProof: false, state: 'snapshot_predates_attempt' });
  assert.equal(classifyReadObservation({ sourceFetchedAt: '2026-09-24T22:00:00Z', attemptAt: '2026-09-24T21:06:30Z' }).state, 'empty_read_inconclusive');
  assert.equal(classifyReadObservation({ matchingMediaIds: ['17900000000000001'] }).positive, true);
});

test('health monitor has no authority to write, publish or enable Phase 2', () => {
  const action = monitorAction({ connectorHealth: 'degraded', records: [record(), record({ instagram_media_id: null })] });
  assert.deepEqual(action, { action: 'read_only_report', writesAllowed: false, publicationAllowed: false, phase2Allowed: false, degraded: true, autonomousCandidates: 1, uncertainRecords: 1 });
});
