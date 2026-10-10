import test from 'node:test';
import assert from 'node:assert/strict';
import { createMedia } from '../scripts/claude-lane/publisher.mjs';

function fakeIg({ childFail = null, parentOk = true, reelOk = true } = {}) {
  const calls = [];
  let n = 0;
  return {
    calls,
    async createContainer(x) { calls.push(['image', x.imageUrl]); return { ok: true, containerId: `img${++n}` }; },
    async createChildContainer(x) {
      calls.push(['child', x.imageUrl]);
      if (childFail === x.imageUrl) return { ok: false, reason: 'child_http_400' };
      return { ok: true, containerId: `c${++n}` };
    },
    async waitContainer(id) { calls.push(['wait', id]); return { ok: true }; },
    async createCarouselContainer(x) {
      calls.push(['carousel', x.childIds.join('|')]);
      return parentOk ? { ok: true, containerId: 'parent' } : { ok: false, reason: 'carousel_http_400' };
    },
    async createReelContainer(x) { calls.push(['reel', x.videoUrl]); return reelOk ? { ok: true, containerId: 'reel1' } : { ok: false, reason: 'reel_http_400' }; },
  };
}
const CAP = 'caption';

test('image format keeps the original single-container path', async () => {
  const ig = fakeIg();
  const r = await createMedia(ig, { image_url: 'https://a/x.jpg' }, CAP);
  assert.deepEqual(r, { ok: true, containerId: 'img1' });
  assert.deepEqual(ig.calls, [['image', 'https://a/x.jpg']]);
});

test('carousel: every child is created and finished before the parent', async () => {
  const ig = fakeIg();
  const r = await createMedia(ig, { media_format: 'carousel', carousel_urls: ['https://a/1.jpg', 'https://a/2.jpg'] }, CAP);
  assert.equal(r.ok, true);
  assert.equal(r.containerId, 'parent');
  const order = ig.calls.map(c => c[0]);
  assert.deepEqual(order, ['child', 'wait', 'child', 'wait', 'carousel']);
});

test('carousel: a failing child stops before any parent or publish', async () => {
  const ig = fakeIg({ childFail: 'https://a/2.jpg' });
  const r = await createMedia(ig, { media_format: 'carousel', carousel_urls: ['https://a/1.jpg', 'https://a/2.jpg'] }, CAP);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'carousel_child_1_child_http_400');
  assert.equal(ig.calls.some(c => c[0] === 'carousel'), false);
});

test('reel: uses a longer wait for video processing', async () => {
  const ig = fakeIg();
  const r = await createMedia(ig, { media_format: 'reel', video_url: 'https://a/r.mp4' }, CAP);
  assert.equal(r.ok, true);
  assert.deepEqual(r.waitOpts, { attempts: 60, intervalMs: 5000 });
});

test('unknown format is refused before any call', async () => {
  const ig = fakeIg();
  assert.equal((await createMedia(ig, { media_format: 'story' }, CAP)).reason, 'unknown_media_format');
  assert.equal(ig.calls.length, 0);
});
