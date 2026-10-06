import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateLaneRecord, checkLaneTransition, composeCaption, CAPTION_MAX } from '../scripts/claude-lane/lane-record.mjs';

const base = () => ({
  lane: 'claude',
  content_id: 'claude-20261006-example-story',
  status: 'draft',
  created_at: '2026-10-06T12:00:00Z',
  headline: 'Example headline',
  caption_es: 'Resumen en español.',
  caption_en: 'Summary in English.',
  source_urls: ['https://www.reuters.com/a', 'https://apnews.com/b'],
  source_names: ['Reuters', 'AP'],
  hashtags: ['#MATRIX24', '#Noticias'],
  image_url: null,
  publish_attempt_id: null,
  ig_media_id: null,
  history: [],
});
const with_ = (patch) => ({ ...base(), ...patch });
const ready = () => with_({ status: 'ready_to_publish', image_url: 'https://x.supabase.co/a.jpg' });

test('valid draft passes', () => assert.deepEqual(validateLaneRecord(base()), []));

test('rejects records that are not in the claude lane', () => {
  assert.ok(validateLaneRecord(with_({ lane: undefined })).includes('LANE_MUST_BE_CLAUDE'));
  assert.ok(validateLaneRecord(with_({ content_id: 'matrix24-20261006-x' })).includes('BAD_CONTENT_ID'));
});

test('requires both languages', () => {
  assert.ok(validateLaneRecord(with_({ caption_es: '' })).includes('MISSING_CAPTION_ES'));
  assert.ok(validateLaneRecord(with_({ caption_en: ' ' })).includes('MISSING_CAPTION_EN'));
});

test('requires two independent https sources', () => {
  assert.ok(validateLaneRecord(with_({ source_urls: ['https://a.com/x'] })).includes('NEED_TWO_HTTPS_SOURCES'));
  assert.ok(validateLaneRecord(with_({ source_urls: ['http://a.com/x', 'https://b.com/y'] })).includes('NEED_TWO_HTTPS_SOURCES'));
  assert.ok(validateLaneRecord(with_({ source_urls: ['https://www.a.com/x', 'https://a.com/y'] })).includes('SOURCES_NOT_INDEPENDENT'));
});

test('caption length and hashtags are bounded', () => {
  assert.ok(validateLaneRecord(with_({ caption_es: 'x'.repeat(CAPTION_MAX) })).includes('CAPTION_TOO_LONG'));
  assert.ok(validateLaneRecord(with_({ hashtags: Array.from({ length: 31 }, (_, i) => `#t${i}`) })).includes('BAD_HASHTAGS'));
  assert.ok(validateLaneRecord(with_({ hashtags: ['no-hash'] })).includes('BAD_HASHTAGS'));
});

test('composed caption carries both languages and the sources', () => {
  const c = composeCaption(base());
  assert.match(c, /🇪🇸 Resumen/);
  assert.match(c, /🇺🇸 Summary/);
  assert.match(c, /Reuters, AP/);
});

test('ready_to_publish needs an https jpeg', () => {
  assert.deepEqual(validateLaneRecord(ready()), []);
  assert.ok(validateLaneRecord(with_({ status: 'ready_to_publish' })).includes('NEED_HTTPS_JPEG'));
  assert.ok(validateLaneRecord(with_({ status: 'ready_to_publish', image_url: 'https://x/a.png' })).includes('NEED_HTTPS_JPEG'));
});

test('published needs a numeric media id; attempt id only after reservation', () => {
  const pub = { ...ready(), status: 'published', publish_attempt_id: 'a1', ig_media_id: '17900000000000001' };
  assert.deepEqual(validateLaneRecord(pub), []);
  assert.ok(validateLaneRecord({ ...pub, ig_media_id: null }).includes('PUBLISHED_NEEDS_MEDIA_ID'));
  assert.ok(validateLaneRecord({ ...ready(), publish_attempt_id: 'a1' }).includes('UNEXPECTED_PUBLISH_ATTEMPT_ID'));
  assert.ok(validateLaneRecord({ ...ready(), status: 'publishing' }).includes('MISSING_PUBLISH_ATTEMPT_ID'));
});

test('transition table: happy path', () => {
  const r = ready();
  const p = { ...r, status: 'publishing', publish_attempt_id: 'a1' };
  assert.equal(checkLaneTransition(null, base()).ok, true);
  assert.equal(checkLaneTransition(base(), r).ok, true);
  assert.equal(checkLaneTransition(r, p).ok, true);
  assert.equal(checkLaneTransition(p, { ...p, status: 'published', ig_media_id: '1' }).ok, true);
  assert.equal(checkLaneTransition(p, { ...p, status: 'publish_unknown' }).ok, true);
});

test('no blind retry: unknown or publishing never returns to ready', () => {
  const p = { ...ready(), status: 'publishing', publish_attempt_id: 'a1' };
  assert.equal(checkLaneTransition(p, ready()).ok, false);
  assert.equal(checkLaneTransition({ ...p, status: 'publish_unknown' }, ready()).ok, false);
  assert.equal(checkLaneTransition({ ...p, status: 'publish_unknown' }, { ...p, status: 'publishing' }).ok, false);
});

test('attempt id cannot change mid-attempt and media id cannot be rewritten', () => {
  const p = { ...ready(), status: 'publishing', publish_attempt_id: 'a1' };
  assert.equal(checkLaneTransition(p, { ...p, status: 'published', publish_attempt_id: 'a2', ig_media_id: '1' }).error, 'ATTEMPT_ID_CHANGED');
  const done = { ...p, status: 'published', ig_media_id: '1' };
  assert.equal(checkLaneTransition(done, { ...done, ig_media_id: '2' }).error, 'MEDIA_ID_CHANGED');
});

test('CLI validates a directory and catches filename mismatch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-'));
  fs.writeFileSync(path.join(dir, 'claude-20261006-example-story.json'), JSON.stringify(base()));
  execFileSync('node', ['scripts/claude-lane/validate-lane-queue.mjs', dir]);
  fs.writeFileSync(path.join(dir, 'wrong-name.json'), JSON.stringify(base()));
  assert.throws(() => execFileSync('node', ['scripts/claude-lane/validate-lane-queue.mjs', dir], { stdio: 'pipe' }));
});

test('the real lane queue directory is valid', () => {
  execFileSync('node', ['scripts/claude-lane/validate-lane-queue.mjs']);
});
