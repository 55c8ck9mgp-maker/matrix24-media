import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReelArgs } from '../scripts/claude-lane/reel-render.mjs';

test('builds a 9:16 mp4 from a card and an audio bed', () => {
  const r = buildReelArgs({ image: 'card.jpg', audio: 'bed.m4a', out: 'reel.mp4', seconds: 15 });
  assert.equal(r.ok, true);
  const all = r.args.join(' ');
  assert.match(all, /pad=1080:1920/);
  assert.match(all, /libx264/);
  assert.equal(r.args.at(-1), 'reel.mp4');
});
test('rejects bad inputs', () => {
  assert.equal(buildReelArgs({ image: 'a.png', audio: 'b.m4a', out: 'c.mp4' }).reason, 'image_must_be_jpeg');
  assert.equal(buildReelArgs({ image: 'a.jpg', audio: 'b.mp3', out: 'c.mp4' }).reason, 'audio_must_be_m4a');
  assert.equal(buildReelArgs({ image: 'a.jpg', audio: 'b.m4a', out: 'c.mov' }).reason, 'output_must_be_mp4');
  assert.equal(buildReelArgs({ image: 'a.jpg', audio: 'b.m4a', out: 'c.mp4', seconds: 90 }).reason, 'duration_out_of_range');
});
