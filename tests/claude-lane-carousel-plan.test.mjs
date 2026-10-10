import test from 'node:test';
import assert from 'node:assert/strict';
import { planCarousel, failureOutcome } from '../scripts/claude-lane/carousel-plan.mjs';

const s = n => Array.from({ length: n }, (_, i) => `https://raw.githubusercontent.com/x/y/s${i}.jpg`);

test('accepts 2 to 10 https slides and ends with exactly one publish', () => {
  const r = planCarousel({ slides: s(3), caption: 'hola' });
  assert.equal(r.ok, true);
  assert.equal(r.steps.filter(x => x.op === 'publish_once').length, 1);
  assert.equal(r.steps.filter(x => x.op === 'create_child').length, 3);
  assert.equal(r.steps.at(-1).op, 'publish_once');
});
test('rejects too few or too many slides', () => {
  assert.equal(planCarousel({ slides: s(1), caption: 'x' }).reason, 'slide_count_out_of_range');
  assert.equal(planCarousel({ slides: s(11), caption: 'x' }).reason, 'slide_count_out_of_range');
});
test('rejects non-https slides and bad captions', () => {
  assert.equal(planCarousel({ slides: ['http://a/b.jpg', 'https://a/c.jpg'], caption: 'x' }).reason, 'slide_url_not_https');
  assert.equal(planCarousel({ slides: s(2), caption: '' }).reason, 'caption_invalid');
  assert.equal(planCarousel({ slides: s(2), caption: 'x'.repeat(2201) }).reason, 'caption_invalid');
});
test('no publish call happens unless every earlier step succeeded', () => {
  assert.equal(failureOutcome('create_child'), 'not_invoked');
  assert.equal(failureOutcome('wait_children'), 'not_invoked');
  assert.equal(failureOutcome('create_parent'), 'not_invoked');
  assert.equal(failureOutcome('publish_once'), 'publish_unknown');
});
