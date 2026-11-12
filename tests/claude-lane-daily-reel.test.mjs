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
  newsDailyBedArgs,
} from '../scripts/claude-lane/daily-reel-video.mjs';

// ── escapeDratext ─────────────────────────────────────────────────────────────────────────────

test('escapeDratext: escapes backslash, single-quote, colon, percent', () => {
  assert.equal(escapeDratext('a\\b'), 'a\\\\b');
  assert.equal(escapeDratext("it's"), "it\\'s");
  assert.equal(escapeDratext('a:b'), 'a\\:b');
  assert.equal(escapeDratext('50%'), '50%%');
});

// ── buildSegmentArgs ──────────────────────────────────────────────────────────────────────

test('buildSegmentArgs: rejects non-JPEG imagePath', () => {
  const r = buildSegmentArgs({ imagePath: 'img.png', titleEs: '', durationSec: 10, storyNumber: 1, totalStories: 4, outPath: 'out.mp4' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'imagePath_must_be_jpeg');
});

test('buildSegmentArgs: rejects non-integer durationSec', () => {
  const r = buildSegmentArgs({ imagePath: 'img.jpg', titleEs: '', durationSec: 1.5, storyNumber: 1, totalStories: 4, outPath: 'out.mp4' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'durationSec_must_be_positive_integer');
});

test('buildSegmentArgs: rejects non-mp4 outPath', () => {
  const r = buildSegmentArgs({ imagePath: 'img.jpg', titleEs: 'T', durationSec: 10, storyNumber: 1, totalStories: 4, outPath: 'out.avi' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'outPath_must_be_mp4');
});

test('buildSegmentArgs: returns ok:true with valid inputs and timed subtitleFilters', () => {
  const r = buildSegmentArgs({
    imagePath: 'img.jpg', titleEs: 'Hola', durationSec: 15,
    storyNumber: 2, totalStories: 4, outPath: 'out.mp4',
    subtitleFilters: ["drawtext=text='Hola':enable='between(t,0,5)'"],
  });
  assert.equal(r.ok, true);
  const vf = r.args[r.args.indexOf('-vf') + 1];
  // subtitleFilters replaces static titleEs, so static draw should NOT appear
  assert.match(vf, /drawtext/);
  assert.match(vf, /between\(t,0,5\)/);
});

test('buildSegmentArgs: static titleEs used when subtitleFilters is empty', () => {
  const r = buildSegmentArgs({
    imagePath: 'img.jpg', titleEs: 'Título', durationSec: 10,
    storyNumber: 1, totalStories: 4, outPath: 'out.mp4',
  });
  assert.equal(r.ok, true);
  const vf = r.args[r.args.indexOf('-vf') + 1];
  assert.match(vf, /Título/);
});

test('buildSegmentArgs: badge shows storyNumber/totalStories', () => {
  const r = buildSegmentArgs({
    imagePath: 'card.jpg', titleEs: '', durationSec: 20,
    storyNumber: 3, totalStories: 4, outPath: 'seg.mp4',
  });
  assert.equal(r.ok, true);
  const vf = r.args[r.args.indexOf('-vf') + 1];
  assert.match(vf, /3\/4/);
});

// ── buildConcatArgs ────────────────────────────────────────────────────────────────────────

test('buildConcatArgs: rejects empty segment list', () => {
  const r = buildConcatArgs({ segmentPaths: [], concatListPath: 'list.txt', outPath: 'out.mp4' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'need_at_least_one_segment');
});

test('buildConcatArgs: returns concat content and args for 2 segments', () => {
  const r = buildConcatArgs({ segmentPaths: ['a.mp4', 'b.mp4'], concatListPath: 'list.txt', outPath: 'out.mp4' });
  assert.equal(r.ok, true);
  assert.match(r.concatContent, /file 'a.mp4'/);
  assert.match(r.concatContent, /file 'b.mp4'/);
  assert.equal(r.args.at(-1), 'out.mp4');
});

// ── buildMuxArgs ────────────────────────────────────────────────────────────────────────────────

test('buildMuxArgs: rejects non-mp4 videoPath', () => {
  const r = buildMuxArgs({ videoPath: 'vid.avi', audioPath: 'aud.m4a', outPath: 'out.mp4' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'videoPath_must_be_mp4');
});

test('buildMuxArgs: rejects non-mp4 outPath', () => {
  const r = buildMuxArgs({ videoPath: 'vid.mp4', audioPath: 'aud.m4a', outPath: 'out.m4a' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'outPath_must_be_mp4');
});

test('buildMuxArgs: valid inputs return ok:true with correct args', () => {
  const r = buildMuxArgs({ videoPath: 'vid.mp4', audioPath: 'aud.m4a', outPath: 'out.mp4' });
  assert.equal(r.ok, true);
  assert.equal(r.args.at(-1), 'out.mp4');
  assert.ok(r.args.includes('-shortest'));
});

// ── buildMultiVoiceConcatArgs ───────────────────────────────────────────────────────────────

test('buildMultiVoiceConcatArgs: rejects empty audio list', () => {
  const r = buildMultiVoiceConcatArgs({ audioFiles: [], outPath: 'out.mp3' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'need_at_least_one_audio_file');
});

test('buildMultiVoiceConcatArgs: rejects non-mp3 outPath', () => {
  const r = buildMultiVoiceConcatArgs({ audioFiles: ['a.mp3'], outPath: 'out.m4a' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'outPath_must_be_mp3');
});

test('buildMultiVoiceConcatArgs: 3 files include 2 silences as lavfi inputs', () => {
  const r = buildMultiVoiceConcatArgs({ audioFiles: ['a.mp3', 'b.mp3', 'c.mp3'], outPath: 'out.mp3' });
  assert.equal(r.ok, true);
  const lavfiInputs = r.args.filter((_, i) => r.args[i - 1] === '-i' && r.args[i].includes('aevalsrc=0'));
  assert.equal(lavfiInputs.length, 2, 'expect 2 silence segments between 3 stories');
  assert.equal(r.args.at(-1), 'out.mp3');
});

// ── buildDailyReelCaption ────────────────────────────────────────────────────────────────────

test('buildDailyReelCaption: returns empty string for no stories', () => {
  assert.equal(buildDailyReelCaption([]), '');
});

test('buildDailyReelCaption: includes numbered headlines and hashtags', () => {
  const caption = buildDailyReelCaption([
    { headline_es: 'Noticias del día', hashtags: ['#test'] },
    { headline_es: 'Segunda historia', hashtags: [] },
  ]);
  assert.match(caption, /1\. Noticias del día/);
  assert.match(caption, /2\. Segunda historia/);
  assert.match(caption, /#matrix24/);
  assert.match(caption, /#test/);
});

test('buildDailyReelCaption: falls back to headline_en when headline_es is absent', () => {
  const caption = buildDailyReelCaption([{ headline_en: 'Breaking news', hashtags: [] }]);
  assert.match(caption, /1\. Breaking news/);
});

// ── scoreStory ──────────────────────────────────────────────────────────────────────────────────

test('scoreStory: awards keyword points and caps at 50 from keywords', () => {
  const story = {
    headline_en: 'war conflict military troops',
    summary_en:  'war conflict military troops',
    headline_es: '',
    summary_es:  '',
    created_at:  new Date().toISOString(),
  };
  const score = scoreStory(story, { now: new Date() });
  assert.ok(score >= 50, `expected score ≥ 50 for high-keyword story, got ${score}`);
});

// ── selectTopStories ──────────────────────────────────────────────────────────────────────────

test('selectTopStories: returns at most n stories', () => {
  const now = new Date();
  const stories = Array.from({ length: 10 }, (_, i) => ({
    content_id: `s${i}`,
    headline_en: `story ${i}`,
    created_at: now.toISOString(),
  }));
  assert.ok(selectTopStories(stories, 4, { now }).length <= 4);
});

test('selectTopStories: filters stories outside the 24h window', () => {
  const now = new Date();
  const old = new Date(now - 25 * 3600 * 1000);
  const stories = [
    { content_id: 'new', headline_en: 'new', created_at: now.toISOString() },
    { content_id: 'old', headline_en: 'old', created_at: old.toISOString() },
  ];
  const result = selectTopStories(stories, 4, { now });
  assert.ok(result.every(s => s.content_id !== 'old'), 'old story should be filtered out');
});

test('selectTopStories: deduplicates by content_id', () => {
  const now = new Date();
  const stories = [
    { content_id: 'dup', headline_en: 'story', created_at: now.toISOString() },
    { content_id: 'dup', headline_en: 'story', created_at: now.toISOString() },
    { content_id: 'uni', headline_en: 'unique', created_at: now.toISOString() },
  ];
  const result = selectTopStories(stories, 4, { now });
  const ids = result.map(s => s.content_id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate content_ids');
});

// ── measureAudioDuration ───────────────────────────────────────────────────────────────────

test('measureAudioDuration: parses float from ffprobe output', () => {
  const fakeExec = () => '23.456\n';
  const dur = measureAudioDuration('file.mp3', { exec: fakeExec });
  assert.equal(dur, 23.456);
});

test('measureAudioDuration: throws when ffprobe returns non-numeric output', () => {
  const fakeExec = () => 'N/A\n';
  assert.throws(() => measureAudioDuration('file.mp3', { exec: fakeExec }), /non-numeric/);
});

// ── buildSubtitleFilters ────────────────────────────────────────────────────────────────────

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
    esText: 'Primera oración. Segunda oración.',
    wordTimings: null,
    fontPath: '/f.ttf',
    totalSec: 10,
  });
  assert.ok(result.length >= 2, `expected ≥ 2 filters, got ${result.length}`);
});

test('buildSubtitleFilters: timed filters use between(t,X,Y) with valid bounds', () => {
  const wordTimings = [
    { text: 'Breaking', offset: 0,          duration: 5_000_000 },
    { text: 'news',    offset: 6_000_000,   duration: 4_000_000 },
    { text: 'today',   offset: 11_000_000,  duration: 4_000_000 },
    { text: 'in',      offset: 16_000_000,  duration: 2_000_000 },
    { text: 'Syria',   offset: 19_000_000,  duration: 5_000_000 },
    { text: 'and',     offset: 25_000_000,  duration: 2_000_000 },
    { text: 'Iraq',    offset: 28_000_000,  duration: 4_000_000 },
  ];
  const result = buildSubtitleFilters({
    esText: 'Noticias de hoy. En Siria e Irak.',
    wordTimings,
    fontPath: '/f.ttf',
    totalSec: 15,
  });
  assert.ok(result.length >= 1);
  for (const f of result) {
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

// ── newsDailyBedArgs ────────────────────────────────────────────────────────────────────────

test('newsDailyBedArgs: all lavfi inputs use aevalsrc= prefix (regression: missing prefix broke CI)', () => {
  const r = newsDailyBedArgs({ seconds: 30, out: 'bed.m4a' });
  assert.equal(r.ok, true);
  // Find all -i arguments (each preceded by '-i' in the args array)
  const inputs = r.args.filter((_, i) => r.args[i - 1] === '-i');
  assert.ok(inputs.length >= 1, 'must have at least one -i input');
  for (const inp of inputs) {
    assert.ok(inp.startsWith('aevalsrc='), `lavfi input must start with aevalsrc=, got: ${inp.slice(0, 40)}`);
  }
});

test('newsDailyBedArgs: rejects out-of-range durations and non-m4a output', () => {
  assert.equal(newsDailyBedArgs({ seconds: 4,  out: 'a.m4a' }).reason, 'duration_out_of_range');
  assert.equal(newsDailyBedArgs({ seconds: 91, out: 'a.m4a' }).reason, 'duration_out_of_range');
  assert.equal(newsDailyBedArgs({ seconds: 30, out: 'a.mp3' }).reason, 'output_must_be_m4a');
});

test('newsDailyBedArgs: output file is last arg and fade-out starts 2s before end', () => {
  const r = newsDailyBedArgs({ seconds: 20, out: 'out.m4a' });
  assert.equal(r.ok, true);
  assert.equal(r.args.at(-1), 'out.m4a');
  const fc = r.args.join(' ');
  assert.match(fc, /afade=t=out:st=18:d=2/);
});
