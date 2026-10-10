import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLaneRecord } from '../scripts/claude-lane/lane-record.mjs';

const base = {
  status: 'ready_to_publish', content_id: 'x', image_url: 'https://raw.githubusercontent.com/a/b/c.jpg',
  publish_attempt_id: null, ig_media_id: null, history: [{ event: 'created' }],
};
const pick = errs => (errs || []).filter(e => /FORMAT|CAROUSEL|MP4|JPEG/.test(e));

test('absent format keeps the existing image behaviour (no new errors)', () => {
  assert.deepEqual(pick(validateLaneRecord({ ...base })), []);
});
test('carousel needs 2 to 10 https jpeg slides', () => {
  const ok = { ...base, media_format: 'carousel', carousel_urls: ['https://a/1.jpg', 'https://a/2.jpg'] };
  assert.deepEqual(pick(validateLaneRecord(ok)), []);
  assert.ok(pick(validateLaneRecord({ ...base, media_format: 'carousel', carousel_urls: ['https://a/1.jpg'] })).includes('BAD_CAROUSEL_URLS'));
});
test('reel needs an https mp4', () => {
  assert.deepEqual(pick(validateLaneRecord({ ...base, media_format: 'reel', video_url: 'https://a/r.mp4' })), []);
  assert.ok(pick(validateLaneRecord({ ...base, media_format: 'reel', video_url: 'https://a/r.jpg' })).includes('NEED_HTTPS_MP4'));
});
test('unknown format is rejected', () => {
  assert.ok(pick(validateLaneRecord({ ...base, media_format: 'story' })).includes('BAD_MEDIA_FORMAT'));
});
