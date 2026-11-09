// Unit and integration tests for the Phase 5 Reels helpers.
// Run: node --test tests/claude-lane-reels.test.mjs
//
// Integration smoke test requires ffmpeg/ffprobe and at least one JPEG under
// claude-lane/media/. It is skipped when those are absent.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildReelArgs,
  generateAudioBed,
  buildReelContainerParams,
  MIN_SECONDS,
  MAX_SECONDS,
} from '../scripts/claude-lane/reel-render.mjs';

import { newsBedArgs } from '../scripts/claude-lane/reel-audio.mjs';

// ── generateAudioBed ──────────────────────────────────────────────────────────

describe('generateAudioBed', () => {
  test('calls exec with ffmpeg and args matching newsBedArgs', () => {
    let calledWith = null;
    const mockExec = (cmd, args, opts) => { calledWith = { cmd, args, opts }; };
    const path = '/tmp/bed.m4a';
    const result = generateAudioBed(path, 15, { exec: mockExec });
    assert.equal(result, path);
    assert.equal(calledWith.cmd, 'ffmpeg');
    const expected = newsBedArgs({ seconds: 15, out: path });
    assert.ok(expected.ok, 'newsBedArgs should succeed for valid params');
    assert.deepEqual(calledWith.args, expected.args);
    assert.deepEqual(calledWith.opts, { stdio: 'inherit' });
  });

  test('throws and does not call exec when duration is invalid', () => {
    let execCalled = false;
    const mockExec = () => { execCalled = true; };
    assert.throws(
      () => generateAudioBed('/tmp/bed.m4a', 0, { exec: mockExec }),
      /generateAudioBed:/,
    );
    assert.equal(execCalled, false, 'exec must not be called on invalid params');
  });

  test('throws when duration exceeds MAX_SECONDS', () => {
    const mockExec = () => {};
    assert.throws(
      () => generateAudioBed('/tmp/bed.m4a', MAX_SECONDS + 1, { exec: mockExec }),
      /generateAudioBed:/,
    );
  });

  test('throws when output path does not end with .m4a', () => {
    const mockExec = () => {};
    assert.throws(
      () => generateAudioBed('/tmp/bed.mp3', 15, { exec: mockExec }),
      /generateAudioBed:/,
    );
  });
});

// ── buildReelContainerParams ──────────────────────────────────────────────────

describe('buildReelContainerParams', () => {
  const baseRecord = {
    caption_en: 'Breaking news headline',
    hashtags: ['#news', '#matrix24'],
    image_url: 'https://cdn.example.com/card.jpg',
  };
  const videoUrl = 'https://raw.githubusercontent.com/org/repo/main/reel.mp4';

  test('returns REELS container with required fields', () => {
    const p = buildReelContainerParams(baseRecord, videoUrl, null);
    assert.equal(p.media_type, 'REELS');
    assert.equal(p.video_url, videoUrl);
    assert.equal(p.share_to_feed, true);
    assert.ok(typeof p.caption === 'string', 'caption must be a string');
  });

  test('caption includes caption_en and all hashtags', () => {
    const p = buildReelContainerParams(baseRecord, videoUrl, null);
    assert.ok(p.caption.includes('Breaking news headline'), 'caption must include caption_en');
    assert.ok(p.caption.includes('#news'), 'caption must include #news');
    assert.ok(p.caption.includes('#matrix24'), 'caption must include #matrix24');
  });

  test('cover_url set when image_url is an https URL', () => {
    const p = buildReelContainerParams(baseRecord, videoUrl, null);
    assert.equal(p.cover_url, baseRecord.image_url);
  });

  test('cover_url absent when image_url is missing', () => {
    const record = { caption_en: 'Test', hashtags: [] };
    const p = buildReelContainerParams(record, videoUrl, null);
    assert.ok(!('cover_url' in p), 'cover_url must not be set when image_url is absent');
  });

  test('handles empty hashtags array gracefully', () => {
    const record = { caption_en: 'No tags', hashtags: [] };
    const p = buildReelContainerParams(record, videoUrl, null);
    assert.ok(!p.caption.includes('undefined'));
    assert.ok(p.caption.includes('No tags'));
  });

  test('audioUrl param is accepted but NOT forwarded to the params object', () => {
    const p = buildReelContainerParams(baseRecord, videoUrl, 'https://example.com/audio.m4a');
    assert.ok(!('audio_url' in p), 'audio_url must not appear in container params');
  });

  test('throws TypeError for non-object record', () => {
    assert.throws(() => buildReelContainerParams(null, videoUrl, null), TypeError);
    assert.throws(() => buildReelContainerParams(['array'], videoUrl, null), TypeError);
    assert.throws(() => buildReelContainerParams('string', videoUrl, null), TypeError);
  });

  test('throws TypeError for non-https mediaUrl', () => {
    assert.throws(
      () => buildReelContainerParams(baseRecord, 'http://example.com/vid.mp4', null),
      TypeError,
    );
    assert.throws(
      () => buildReelContainerParams(baseRecord, '/local/path.mp4', null),
      TypeError,
    );
  });
});

// ── buildReelArgs (existing, spot-check) ─────────────────────────────────────

describe('buildReelArgs', () => {
  test('returns ok:false for duration out of range', () => {
    assert.deepEqual(
      buildReelArgs({ image: 'x.jpg', audio: 'y.m4a', out: 'z.mp4', seconds: MAX_SECONDS + 1 }),
      { ok: false, reason: 'duration_out_of_range' },
    );
  });

  test('returns ok:true with 1080x1920 dimensions in vf filter', () => {
    const r = buildReelArgs({ image: 'card.jpg', audio: 'bed.m4a', out: 'reel.mp4', seconds: 15 });
    assert.ok(r.ok);
    const vfIdx = r.args.indexOf('-vf');
    assert.ok(vfIdx >= 0, '-vf flag must be present');
    const vfVal = r.args[vfIdx + 1];
    assert.ok(vfVal.includes('1080:1920'), 'output frame must be 1080x1920');
    assert.ok(vfVal.includes('1080:1350'), 'card crop must be 1080x1350');
  });

  test('returns ok:false for minimum duration boundary (MIN_SECONDS - 1)', () => {
    assert.equal(
      buildReelArgs({ image: 'x.jpg', audio: 'y.m4a', out: 'z.mp4', seconds: MIN_SECONDS - 1 }).ok,
      false,
    );
  });
});

// ── Integration smoke test ────────────────────────────────────────────────────

function findFirstJpeg() {
  const mediaDir = join(import.meta.dirname, '..', 'claude-lane', 'media');
  if (!existsSync(mediaDir)) return null;
  const files = readdirSync(mediaDir).filter(f => /\.jpe?g$/i.test(f));
  return files.length > 0 ? join(mediaDir, files[0]) : null;
}

function toolAvailable(name) {
  try { execFileSync(name, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

const skipReason =
  !toolAvailable('ffmpeg')  ? 'ffmpeg not available — skipping integration test' :
  !toolAvailable('ffprobe') ? 'ffprobe not available — skipping integration test' :
  !findFirstJpeg()          ? 'no JPEG found in claude-lane/media/ — skipping integration test' :
  false;

test('integration: render 3-second Reel from first JPEG in claude-lane/media/', {
  skip: skipReason || undefined,
}, async () => {
  const jpeg = findFirstJpeg();
  const tmp = tmpdir();
  const stamp = Date.now();
  const bedPath = join(tmp, `test-bed-${stamp}.m4a`);
  const mp4Path = join(tmp, `test-reel-${stamp}.mp4`);
  const SECONDS = 3;

  // Generate audio bed
  generateAudioBed(bedPath, SECONDS);
  assert.ok(existsSync(bedPath), 'audio bed should exist after generateAudioBed');

  // Render MP4
  const r = buildReelArgs({ image: jpeg, audio: bedPath, out: mp4Path, seconds: SECONDS });
  assert.ok(r.ok, `buildReelArgs failed: ${r.reason}`);
  execFileSync('ffmpeg', r.args, { stdio: 'pipe' });
  assert.ok(existsSync(mp4Path), 'MP4 should exist after ffmpeg render');

  // ffprobe verify
  const probeJson = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,duration',
    '-of', 'json',
    mp4Path,
  ], { encoding: 'utf8' });
  const probe = JSON.parse(probeJson);
  const s = probe.streams?.[0];
  assert.ok(s, 'ffprobe must return at least one video stream');
  assert.equal(s.codec_name, 'h264', 'codec must be h264');
  assert.equal(s.width,  1080, 'width must be 1080');
  assert.equal(s.height, 1920, 'height must be 1920');
  const duration = parseFloat(s.duration);
  assert.ok(
    duration >= 2.5 && duration <= 3.5,
    `duration ${duration}s should be close to ${SECONDS}s`,
  );
});
