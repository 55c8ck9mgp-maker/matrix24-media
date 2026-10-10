import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, parseInsights, toMarkdown } from '../scripts/claude-lane/growth-report.mjs';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const day = d => new Date(NOW - d * 86400_000).toISOString();

test('summarize counts only the window and averages per format', () => {
  const s = summarize([
    { timestamp: day(1), media_type: 'IMAGE', reach: 10, saved: 2, shares: 1, like_count: 3 },
    { timestamp: day(2), media_type: 'IMAGE', reach: 20, saved: 0, shares: 3, like_count: 1 },
    { timestamp: day(40), media_type: 'VIDEO', reach: 999, saved: 9, shares: 9, like_count: 9 },
  ], { now: NOW });
  assert.equal(s.posts, 2);
  assert.equal(s.avg_reach, 15);
  assert.equal(s.by_type.IMAGE.posts, 2);
  assert.equal(s.by_type.VIDEO, undefined);
});

test('missing insights count as zero in averages and are reported', () => {
  const s = summarize([
    { timestamp: day(1), media_type: 'IMAGE', reach: null },
    { timestamp: day(1), media_type: 'IMAGE', reach: 8 },
  ], { now: NOW });
  assert.equal(s.insights_missing, 1);
  assert.equal(s.avg_reach, 4);
});

test('top list is sorted by reach and capped at five', () => {
  const items = Array.from({ length: 7 }, (_, i) => ({ timestamp: day(1), media_type: 'IMAGE', reach: i }));
  const s = summarize(items, { now: NOW });
  assert.equal(s.top.length, 5);
  assert.equal(s.top[0].reach, 6);
});

test('parseInsights reads values and tolerates errors', () => {
  assert.deepEqual(parseInsights({ data: [{ name: 'reach', values: [{ value: 12 }] }, { name: 'saved', values: [{ value: 1 }] }] }), { reach: 12, saved: 1, shares: null });
  assert.deepEqual(parseInsights({ error: { message: 'x' } }), { reach: null, saved: null, shares: null });
});

test('markdown states it changes nothing and never includes a token-like string', () => {
  const md = toMarkdown(summarize([], { now: NOW }), { followers: 59, generatedAt: 'x' });
  assert.match(md, /changes nothing/);
  assert.match(md, /Followers: 59/);
  assert.equal(/Bearer|EAA|IGQ/.test(md), false);
});
