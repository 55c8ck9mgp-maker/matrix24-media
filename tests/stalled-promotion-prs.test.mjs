import test from 'node:test';
import assert from 'node:assert/strict';
import { findStalledPromotionPRs, fetchOpenPulls, DEFAULT_STALL_HOURS, evaluatePromotionMergeGate } from '../scripts/audit-stalled-promotion-prs.mjs';

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


const mergeId='matrix24-safe-item';
const mergeBase={pr:{state:'open',draft:false,title:`Queue approved promotion: ${mergeId}`,base:{ref:'main'},head:{ref:`promotion/${mergeId}`}},changedFiles:[`queue/${mergeId}.json`],queueRecord:{content_id:mergeId,status:'blocked_media'},checks:{promotion_guard:'success',intake_guard:'success',production_audit:'success',ownership_audit:'success',queue_exists_on_main:false,head_matches_observed:true,base_is_current_main:true}};
test('merge gate is eligible only with complete green pinned evidence',()=>assert.equal(evaluatePromotionMergeGate(mergeBase).eligible,true));
test('merge gate fails closed on stale main or failed audit',()=>{const r=evaluatePromotionMergeGate({...mergeBase,checks:{...mergeBase.checks,production_audit:'failure',base_is_current_main:false}});assert.equal(r.eligible,false);assert.ok(r.reasons.includes('production_audit_not_green'));assert.ok(r.reasons.includes('base_not_current_main'));});
test('merge gate rejects media/publication mutation and extra files',()=>{const r=evaluatePromotionMergeGate({...mergeBase,changedFiles:[...mergeBase.changedFiles,'README.md'],queueRecord:{...mergeBase.queueRecord,media_claim:{id:'x'},instagram_permalink:'https://www.instagram.com/p/x/'}});assert.equal(r.eligible,false);assert.ok(r.reasons.includes('not_exactly_one_queue_file'));assert.ok(r.reasons.includes('unexpected_media_claim'));assert.ok(r.reasons.includes('unexpected_instagram_permalink'));});
