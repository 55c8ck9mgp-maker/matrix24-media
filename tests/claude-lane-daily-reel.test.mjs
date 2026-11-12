// Tests for Phase 7 — daily news-summary Reel helpers.
// All tests are pure: no FFmpeg, no network, no filesystem side-effects.
import test from 'node:test';
import assert from 'node:assert/strict';

import { selectTopStories, scoreStory }         from '../scripts/claude-lane/story-ranker.mjs';
import {
  buildSegmentArgs,
  buildConcatArgs,
  buildMuxArgs,
  buildMultiVoiceConcatArgs,
  buildDailyReelCaption,
  buildSubtitleFilters,
  measureAudioDuration,
  escapeDratext,
} from '../scripts/claude-lane/daily-reel-video.mjs';

// ── escapeDratext ─────────────────────────────────────────────────────────────

test('escapeDratext: escapes backslash, single-quote, colon, percent', () => {
  assert.equal(escapeDratext("it's 100%: a\\b"), "it\\'s 100%%\\: a\\\\b");
});

test('escapeDratext: plain text passes through unchanged', () => {
  assert.equal(escapeDratext('Hello World'), 'Hello World');
});

// ── selectTopStories ──────────────────────────────────────────────────────────

function makeDraft({ id, headline_en = '', created_at, breaking = false, hashtags = [] } = {}) {
  return { content_id: id, headline_en, summary_en: '', created_at, breaking, hashtags };
}

test('selectTopStories: returns at most n stories', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const drafts = Array.from({ length: 10 }, (_, i) =>
    makeDraft({ id: `d${i}`, headline_en: 'trade war summit', created_at: new Date(now - i * 60_000).toISOString() }));
  const result = selectTopStories(drafts, 4, { now });
  assert.equal(result.length, 4);
});

test('selectTopStories: filters out drafts older than windowMs', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const old = makeDraft({ id: 'old', headline_en: 'trade war', created_at: new Date(now - 25 * 3600_000).toISOString() });
  const fresh = makeDraft({ id: 'fresh', headline_en: 'election', created_at: now.toISOString() });
  const result = selectTopStories([old, fresh], 4, { now });
  assert.equal(result.length, 1);
  assert.equal(result[0].content_id, 'fresh');
});

test('selectTopStories: breaking draft ranks higher regardless of score', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const normal = makeDraft({ id: 'normal', headline_en: 'trade war summit nato g20', created_at: new Date(now - 1000).toISOString() });
  const breaking = makeDraft({ id: 'breaking', headline_en: 'minor update', created_at: new Date(now - 2000).toISOString(), breaking: true });
  const result = selectTopStories([normal, breaking], 2, { now });
  // breaking gets +30 bonus; should beat a 4-keyword story (40 pts) if score < 70
  assert.equal(result[0].content_id, 'breaking');
});

test('selectTopStories: returns empty array when no drafts in window', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const old = makeDraft({ id: 'old', headline_en: 'nato', created_at: new Date(now - 48 * 3600_000).toISOString() });
  assert.deepEqual(selectTopStories([old], 4, { now }), []);
});

test('scoreStory: awards keyword points and caps at 50 from keywords', () => {
  const draft = makeDraft({ headline_en: 'war attack killed crisis nuclear sanctions election president' });
  const score = scoreStory(draft);
  assert.ok(score >= 50, `expected score >= 50, got ${score}`);
  assert.ok(score <= 110, `expected score <= 110 (50 kw cap + 60 breaking), got ${score}`);
});

// ── buildSegmentArgs ──────────────────────────────────────────────────────────

test('buildSegmentArgs: returns ok:true with correct structure', () => {
  const r = buildSegmentArgs({
    imagePath: 'card.jpg', titleEs: 'Título de prueba',
    durationSec: 20, storyNumber: 1, totalStories: 4, outPath: 'seg.mp4',
  });
  assert.equal(r.ok, true);
  const all = r.args.join(' ');
  assert.match(all, /drawtext/);
  assert.match(all, /1\/4/);
  assert.match(all, /libx264/);
  assert.equal(r.args.at(-1), 'seg.mp4');
});

test('buildSegmentArgs: title containing special chars is escaped', () => {
  const r = buildSegmentArgs({
    imagePath: 'card.jpeg', titleEs: "it's 50%: test\\path",
    durationSec: 10, storyNumber: 2, totalStories: 4, outPath: 'out.mp4',
  });
  assert.equal(r.ok, true);
  // The escaped version should appear in the args
  const all = r.args.join(' ');
  assert.ok(!all.includes("it's 50%"), 'raw unescaped string must not appear');
});

test('buildSegmentArgs: rejects non-jpeg image', () => {
  const r = buildSegmentArgs({ imagePath: 'card.png', titleEs: '', durationSec: 10, storyNumber: 1, totalStories: 4, outPath: 'out.mp4' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'imagePath_must_be_jpeg');
});

test('buildSegmentArgs: rejects durationSec < 1', () => {
  const r = buildSegmentArgs({ imagePath: 'a.jpg', titleEs: '', durationSec: 0, storyNumber: 1, totalStories: 4, outPath: 'out.mp4' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'durationSec_must_be_positive_integer');
});

test('buildSegmentArgs: rejects non-mp4 output', () => {
  const r = buildSegmentArgs({ imagePath: 'a.jpg', titleEs: '', durationSec: 10, storyNumber: 1, totalStories: 4, outPath: 'out.avi' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'outPath_must_be_mp4');
});

// ── buildConcatArgs ───────────────────────────────────────────────────────────

test('buildConcatArgs: returns ok:true and correct concat file content', () => {
  const r = buildConcatArgs({
    segmentPaths: ['seg0.mp4', 'seg1.mp4', 'seg2.mp4'],
    concatListPath: '/tmp/concat.txt',
    outPath: 'final.mp4',
  });
  assert.equal(r.ok, true);
  assert.match(r.concatContent, /file 'seg0\.mp4'/);
  assert.match(r.concatContent, /file 'seg2\.mp4'/);
  assert.ok(r.args.includes('-f'));
  assert.ok(r.args.includes('concat'));
  assert.equal(r.args.at(-1), 'final.mp4');
});

test('buildConcatArgs: rejects empty array', () => {
  const r = buildConcatArgs({ segmentPaths: [], concatListPath: 'c.txt', outPath: 'out.mp4' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'segmentPaths_must_be_non_empty_array');
});

test('buildConcatArgs: rejects non-mp4 segment', () => {
  const r = buildConcatArgs({ segmentPaths: ['a.avi'], concatListPath: 'c.txt', outPath: 'out.mp4' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'each_segment_must_be_mp4');
});

// ── buildMuxArgs ──────────────────────────────────────────────────────────────

test('buildMuxArgs: returns ok:true with expected args', () => {
  const r = buildMuxArgs({ videoPath: 'vid.mp4', audioPath: 'aud.m4a', outPath: 'out.mp4' });
  assert.equal(r.ok, true);
  assert.ok(r.args.includes('vid.mp4'));
  assert.ok(r.args.includes('aud.m4a'));
  assert.equal(r.args.at(-1), 'out.mp4');
  assert.ok(r.args.includes('-shortest'));
});

test('buildMuxArgs: rejects non-mp4 video', () => {
  assert.equal(buildMuxArgs({ videoPath: 'v.avi', audioPath: 'a.m4a', outPath: 'o.mp4' }).reason, 'videoPath_must_be_mp4');
});

test('buildMuxArgs: rejects non-m4a audio', () => {
  assert.equal(buildMuxArgs({ videoPath: 'v.mp4', audioPath: 'a.mp3', outPath: 'o.mp4' }).reason, 'audioPath_must_be_m4a');
});

test('buildMuxArgs: rejects non-mp4 output', () => {
  assert.equal(buildMuxArgs({ videoPath: 'v.mp4', audioPath: 'a.m4a', outPath: 'o.avi' }).reason, 'outPath_must_be_mp4');
});

// ── buildMultiVoiceConcatArgs ─────────────────────────────────────────────────

test('buildMultiVoiceConcatArgs: single file copies without filter_complex', () => {
  const r = buildMultiVoiceConcatArgs({ audioFiles: ['voice.mp3'], outPath: 'out.mp3' });
  assert.equal(r.ok, true);
  assert.ok(r.args.includes('-c'));
  assert.ok(r.args.includes('copy'));
  assert.ok(!r.args.includes('-filter_complex'));
});

test('buildMultiVoiceConcatArgs: 4 files uses filter_complex with concat', () => {
  const r = buildMultiVoiceConcatArgs({
    audioFiles: ['s0.mp3', 's1.mp3', 's2.mp3', 's3.mp3'],
    outPath: 'out.mp3',
  });
  assert.equal(r.ok, true);
  const all = r.args.join(' ');
  assert.match(all, /filter_complex/);
  assert.match(all, /concat=n=7/);   // 4 files + 3 silences = 7 inputs to concat
  assert.match(all, /atrim=duration=1/); // silence gaps
  assert.equal(r.args.at(-1), 'out.mp3');
});

test('buildMultiVoiceConcatArgs: 2 files concat with 1 silence (n=3)', () => {
  const r = buildMultiVoiceConcatArgs({ audioFiles: ['a.mp3', 'b.mp3'], outPath: 'out.mp3' });
  assert.equal(r.ok, true);
  assert.match(r.args.join(' '), /concat=n=3/);
});

test('buildMultiVoiceConcatArgs: rejects empty array', () => {
  assert.equal(buildMultiVoiceConcatArgs({ audioFiles: [], outPath: 'o.mp3' }).reason, 'audioFiles_must_be_non_empty_array');
});

test('buildMultiVoiceConcatArgs: rejects non-mp3 file', () => {
  assert.equal(buildMultiVoiceConcatArgs({ audioFiles: ['a.m4a'], outPath: 'o.mp3' }).reason, 'each_audio_file_must_be_mp3');
});

test('buildMultiVoiceConcatArgs: rejects non-mp3 output', () => {
  assert.equal(buildMultiVoiceConcatArgs({ audioFiles: ['a.mp3'], outPath: 'o.m4a' }).reason, 'outPath_must_be_mp3');
});

// ── buildDailyReelCaption ─────────────────────────────────────────────────────

test('buildDailyReelCaption: includes numbered emoji and headlines', () => {
  const stories = [
    { headline_en: 'Story One', hashtags: ['#geopolitics'] },
    { headline_en: 'Story Two', hashtags: ['#economy'] },
  ];
  const caption = buildDailyReelCaption(stories);
  assert.match(caption, /1️⃣/);
  assert.match(caption, /Story One/);
  assert.match(caption, /2️⃣/);
  assert.match(caption, /Story Two/);
  assert.match(caption, /#matrix24/);
  assert.match(caption, /#worldnews/);
});

test('buildDailyReelCaption: deduplicates hashtags', () => {
  const stories = [
    { headline_en: 'A', hashtags: ['#news'] },
    { headline_en: 'B', hashtags: ['#news'] },
  ];
  const caption = buildDailyReelCaption(stories);
  // '#news' should appear exactly once
  assert.equal((caption.match(/#news/g) || []).length, 1);
});

// ── measureAudioDuration ──────────────────────────────────────────────────────

test('measureAudioDuration: parses float from ffprobe output', () => {
  const fakeExec = () => '23.456\n';
  const dur = measureAudioDuration('file.mp3', { exec: fakeExec });
  assert.equal(dur, 23.456);
});

test('measureAudioDuration: throws when ffprobe returns non-numeric output', () => {
  const fakeExec = () => 'N/A\n';
  assert.throws(() => measureAudioDuration('file.mp3', { exec: fakeExec }), /non-numeric/);
});

// ── buildSubtitleFilters ──────────────────────────────────────────────────────

test('buildSubtitleFilters: returns empty array for empty esText', () => {
  assert.deepEqual(buildSubtitleFilters({ esText: '', wordTimings: [], fontPath: '/f.ttf', totalSec: 10 }), []);
});

test('buildSubtitleFilters: returns empty array for zero totalSec', () => {
  assert.deepEqual(buildSubtitleFilters({ esText: 'Hola mundo', wordTimings: [], fontPath: '/f.ttf', totalSec: 0 }), []);
});

test('buildSubtitleFilters: single phrase, no timing → one filter covering full segment', () => {
  const result = buildSubtitleFilters({ esText: 'Hola mundo', wordTimings: null, fontPath: '/f.ttf', totalSec: 10 });
  assert.equal(result.length, 1);
  assert.match(result[0], /drawtext/);
  assert.match(result[0], /between\(t,/);
  assert.match(result[0], /Hola mundo/);
});

test('buildSubtitleFilters: two sentences split into two filters', () => {
  const result = buildSubtitleFilters({
    esText: 'El presidente habla. Acuerdo de paz firmado.',
    wordTimings: null,
    fontPath: '/f.ttf',
    totalSec: 15,
  });
  // Two sentences → two filters (or more)
  assert.ok(result.length >= 2, `expected ≥ 2 filters, got ${result.length}`);
  for (const f of result) assert.match(f, /drawtext/);
});

test('buildSubtitleFilters: timed filters use between(t,X,Y) with valid bounds', () => {
  // 4 English words → 2 Spanish phrases split by sentence
  const wordTimings = [
    { text: 'Breaking', offset: 0,          duration: 5_000_000  },  // 0–0.5 s
    { text: 'news',     offset: 6_000_000,  duration: 4_000_000  },  // 0.6–1.0 s
    { text: 'update',   offset: 11_000_000, duration: 6_000_000  },  // 1.1–1.7 s
    { text: 'today',    offset: 18_000_000, duration: 5_000_000  },  // 1.8–2.3 s
  ];
  const result = buildSubtitleFilters({
    esText: 'Noticias urgentes. Actualización de hoy.',
    wordTimings,
    fontPath: '/f.ttf',
    totalSec: 15,
  });
  assert.ok(result.length >= 1, 'must return at least one filter');
  for (const f of result) {
    assert.match(f, /enable='between\(t,/);
    // Bounds should be valid floats
    const m = f.match(/between\(t,([\d.]+),([\d.]+)\)/);
    assert.ok(m, 'must contain time bounds');
    const start = parseFloat(m[1]);
    const end   = parseFloat(m[2]);
    assert.ok(start >= 0,       `start ${start} must be ≥ 0`);
    assert.ok(end > start,      `end ${end} must be > start ${start}`);
    assert.ok(end <= 15,        `end ${end} must be ≤ totalSec 15`);
  }
});

test('buildSubtitleFilters: escapes special chars in subtitle text', () => {
  const result = buildSubtitleFilters({ esText: "Título: it's 50%", wordTimings: [], fontPath: '/f.ttf', totalSec: 10 });
  assert.ok(result.length >= 1, 'must return at least one filter');
  const all = result.join(' ');
  // After escapeDratext: ' → \' and % → %%
  assert.ok(!all.includes("it's"), "raw apostrophe must be escaped to it\\'s");
  assert.ok(!all.includes("50%'"), 'percent at end of text= value must be escaped');
});

test('buildSubtitleFilters: single long phrase is halved when no punctuation', () => {
  // 10 words, no sentence/clause punctuation — should split into 2 halves
  const result = buildSubtitleFilters({
    esText: 'El clima extremo afecta a millones de personas en todo el mundo',
    wordTimings: null,
    fontPath: '/f.ttf',
    totalSec: 20,
  });
  assert.ok(result.length >= 2, `expected ≥ 2 subtitle halves, got ${result.length}`);
});
