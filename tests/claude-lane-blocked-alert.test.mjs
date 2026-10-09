import test from 'node:test';
import assert from 'node:assert/strict';
import { findBlockers, issueTitle, issueBody, STALE_PUBLISHING_MS } from '../scripts/claude-lane/blocked-alert.mjs';

const NOW = Date.parse('2026-10-09T14:00:00Z');

test('publish_unknown always blocks and carries the meta reason', () => {
  const b = findBlockers([{
    content_id: 'claude-20261009-apple', status: 'publish_unknown',
    reserved_at: '2026-10-09T12:52:19.531Z', publish_attempt_id: 'abc',
    history: [{ event: 'reserved' }, { event: 'publish_unknown', reason: 'publish_http_400_code_9007_sub_2207027' }],
  }], NOW);
  assert.equal(b.length, 1);
  assert.equal(b[0].content_id, 'claude-20261009-apple');
  assert.equal(b[0].reason, 'publish_http_400_code_9007_sub_2207027');
  assert.equal(b[0].attempt, 'abc');
});

test('publishing blocks only after it has been stale', () => {
  const fresh = new Date(NOW - 5 * 60 * 1000).toISOString();
  const stale = new Date(NOW - STALE_PUBLISHING_MS - 60 * 1000).toISOString();
  assert.equal(findBlockers([{ content_id: 'a', status: 'publishing', reserved_at: fresh }], NOW).length, 0);
  assert.equal(findBlockers([{ content_id: 'a', status: 'publishing', reserved_at: stale }], NOW).length, 1);
  assert.equal(findBlockers([{ content_id: 'a', status: 'publishing' }], NOW).length, 0);
});

test('published, discarded, ready and skipped records never block', () => {
  const records = ['published', 'discarded', 'ready_to_publish', 'skipped_duplicate', 'draft']
    .map((status, i) => ({ content_id: `c${i}`, status }));
  assert.deepEqual(findBlockers(records, NOW), []);
});

test('issue text names the discard steps and never promises an action', () => {
  const blockers = findBlockers([{ content_id: 'x-1', status: 'publish_unknown', history: [] }], NOW);
  assert.match(issueTitle(blockers), /x-1/);
  const body = issueBody(blockers, '2026-10-09T14:00:00Z');
  assert.match(body, /Claude Lane discard \(owner only\)/);
  assert.match(body, /dry run/);
  assert.doesNotMatch(body, /retry|reintent(a|ar) ahora/i);
});
