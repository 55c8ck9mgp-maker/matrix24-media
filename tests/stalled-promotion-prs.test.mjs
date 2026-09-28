import test from 'node:test';
import assert from 'node:assert/strict';
import { findStalledPromotionPRs, fetchOpenPulls, DEFAULT_STALL_HOURS } from '../scripts/audit-stalled-promotion-prs.mjs';

const now = Date.parse('2026-09-28T21:00:00Z');
const hoursAgo = h => new Date(now - h * 36e5).toISOString();
const pr = (number, title, createdHoursAgo, extra = {}) => ({
  number, title, state: 'open', base: { ref: 'main' },
  created_at: hoursAgo(createdHoursAgo),
  html_url: `https://github.com/o/r/pull/${number}`, ...extra
});

test('default threshold is four hours', () => {
  assert.equal(DEFAULT_STALL_HOURS, 4);
});

test('promotion PR open past the threshold is reported with a link and age', () => {
  const stalled = findStalledPromotionPRs([pr(67, 'Queue approved promotion: matrix24-20260927-uttar-pradesh', 25)], { now });
  assert.deepEqual(stalled, [{
    number: 67, content_id: 'matrix24-20260927-uttar-pradesh', url: 'https://github.com/o/r/pull/67',
    draft: false, opened_at: hoursAgo(25), age_hours: 25, threshold_hours: 4
  }]);
});

test('promotion PR younger than the threshold is not reported', () => {
  assert.deepEqual(findStalledPromotionPRs([pr(1, 'Queue approved promotion: matrix24-a', 3.9)], { now }), []);
});

test('intake and unrelated PRs are ignored', () => {
  const pulls = [
    pr(84, 'Editorial intake: matrix24-b', 30),
    pr(90, 'Fix worker', 30),
    pr(91, 'Queue approved promotion: matrix24-c', 30, { base: { ref: 'staging' } }),
    pr(92, 'Queue approved promotion: matrix24-d', 30, { state: 'closed' })
  ];
  assert.deepEqual(findStalledPromotionPRs(pulls, { now }), []);
});

test('threshold is configurable and results are oldest first', () => {
  const pulls = [pr(2, 'Queue approved promotion: matrix24-x', 2), pr(3, 'Queue approved promotion: matrix24-y', 6)];
  assert.deepEqual(findStalledPromotionPRs(pulls, { now, thresholdHours: 1 }).map(s => s.number), [3, 2]);
});

test('unparseable timestamps are skipped rather than reported', () => {
  assert.deepEqual(findStalledPromotionPRs([{ ...pr(4, 'Queue approved promotion: matrix24-z', 10), created_at: 'nope' }], { now }), []);
});

test('fetchOpenPulls paginates and fails loudly on API errors', async () => {
  const pages = [Array.from({ length: 100 }, (_, i) => ({ number: i })), [{ number: 100 }]];
  const urls = [];
  const ok = async url => { urls.push(url); return { ok: true, json: async () => pages[urls.length - 1] }; };
  const pulls = await fetchOpenPulls({ repository: 'o/r', token: 't', fetchImpl: ok });
  assert.equal(pulls.length, 101);
  assert.match(urls[1], /page=2/);
  await assert.rejects(fetchOpenPulls({ repository: 'o/r', fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
});
