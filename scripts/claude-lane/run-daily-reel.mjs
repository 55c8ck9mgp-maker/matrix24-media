#!/usr/bin/env node
// Claude Lane — daily news-summary Reel orchestrator (Phase 7).
// Selects the top 4 stories from the last 24 h, renders one card per story,
// generates English TTS, builds per-story video segments, concatenates them,
// mixes with the news bed, and writes the final Reel + metadata to $LANE_OUT.
//
// Publishing is handled by .github/workflows/claude-lane-daily-reel.yml.
// This script never calls any Instagram API or commits to git.
// See docs/CLAUDE_LANE.md "Phase 7 — Daily News Summary Reel".

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

import { readBranchDrafts, renderCardV2 }   from './run-lane.mjs';
import { selectTopStories }                  from './story-ranker.mjs';
import { generateBilingualTTS }              from './reel-tts.mjs';
import { buildVoiceoverMixArgs } from './reel-render.mjs';
import {
  buildSegmentArgs,
  buildConcatArgs,
  buildMuxArgs,
  buildMultiVoiceConcatArgs,
  buildDailyReelCaption,
  measureAudioDuration,
  newsDailyBedArgs,
  DAILY_MAX_SECONDS,
  STORY_DURATION_SEC,
} from './daily-reel-video.mjs';

const LIVE  = process.env.CLAUDE_LANE_ENABLED === 'true';
const OUT   = process.env.LANE_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'daily-reel-'));
const TMP   = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-reel-tmp-'));
const REPO  = process.env.GITHUB_REPOSITORY || '55c8ck9mgp-maker/matrix24-media';

const log = (stage, obj) => {
  const line = JSON.stringify({ stage, live: LIVE, ...obj });
  console.log(line);
  if (process.env.GITHUB_ACTIONS)
    console.log(`::notice title=daily-reel ${stage}::${line.replace(/\n/g, ' ').slice(0, 900)}`);
};

function exec(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

// ──────────────────────────────────────────────────────────────────────────────
async function main() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const contentId = `claude-${dateStr}-daily-reel`;
  log('start', { contentId, now: now.toISOString() });

  // ── 1. Fetch drafts and select top 4 stories ─────────────────────────────
  log('fetch-drafts', {});
  const allDrafts = readBranchDrafts();
  log('drafts-loaded', { total: allDrafts.length });

  const stories = selectTopStories(allDrafts, 4, { now });
  log('stories-selected', { count: stories.length, ids: stories.map(s => s?.content_id || s?.id) });

  if (stories.length < 2) {
    log('abort', { reason: 'fewer_than_2_stories_in_window', count: stories.length });
    process.exitCode = 1;
    return;
  }

  // ── 2. Render card for each story ──────────────────────────────────────────
  const cardPaths = [];
  for (let i = 0; i < stories.length; i++) {
    const story = stories[i];
    log('render-card', { story: i + 1, id: story?.content_id });
    try {
      const { jpg } = await renderCardV2(story);
      const cardPath = path.join(TMP, `card-${i}.jpg`);
      fs.writeFileSync(cardPath, jpg);
      cardPaths.push(cardPath);
    } catch (e) {
      log('card-error', { story: i + 1, error: String(e.message).slice(0, 200) });
      cardPaths.push(null);
    }
  }

  // Filter to stories that have cards.
  const validIndices = cardPaths.map((p, i) => (p ? i : null)).filter(i => i !== null);
  if (validIndices.length < 2) {
    log('abort', { reason: 'fewer_than_2_cards_rendered', rendered: validIndices.length });
    process.exitCode = 1;
    return;
  }
  const usedStories = validIndices.map(i => stories[i]);
  const usedCards   = validIndices.map(i => cardPaths[i]);
  log('cards-ready', { count: usedCards.length });

  // ── 3. Generate English TTS for each story ─────────────────────────────────
  const ttsFiles = [];
  const ttsTmpDir = path.join(TMP, 'tts');
  fs.mkdirSync(ttsTmpDir, { recursive: true });

  for (let i = 0; i < usedStories.length; i++) {
    const s = usedStories[i];
    log('tts', { story: i + 1 });
    try {
      const r = await generateBilingualTTS({
        headline_es: '',
        summary_es:  '',
        headline_en: s?.headline_en || '',
        summary_en:  s?.summary_en  || '',
        tmpDir: path.join(ttsTmpDir, `s${i}`),
      });
      ttsFiles.push(r?.enFile || null);
    } catch (e) {
      log('tts-error', { story: i + 1, error: String(e.message).slice(0, 200) });
      ttsFiles.push(null);
    }
  }

  // ── 4. Measure TTS durations and decide segment lengths ───────────────────
  const segmentDurations = usedStories.map((_, i) => {
    const f = ttsFiles[i];
    if (!f) return STORY_DURATION_SEC;
    try {
      const dur = measureAudioDuration(f);
      // Add 2 s buffer; min 5 s; max 30 s per story.
      return Math.min(30, Math.max(5, Math.ceil(dur + 2)));
    } catch {
      return STORY_DURATION_SEC;
    }
  });

  // Clamp total to DAILY_MAX_SECONDS.
  const rawTotal = segmentDurations.reduce((a, b) => a + b, 0);
  const scaleFactor = rawTotal > DAILY_MAX_SECONDS ? DAILY_MAX_SECONDS / rawTotal : 1;
  const finalDurations = segmentDurations.map(d =>
    Math.max(5, Math.round(d * scaleFactor)));

  const totalSec = finalDurations.reduce((a, b) => a + b, 0);
  log('durations', { segments: finalDurations, totalSec });

  // ── 5. Build per-story video segments ─────────────────────────────────────
  const segmentPaths = [];
  for (let i = 0; i < usedStories.length; i++) {
    const segPath = path.join(TMP, `seg-${i}.mp4`);
    const r = buildSegmentArgs({
      imagePath:    usedCards[i],
      titleEs:      usedStories[i]?.headline_es || usedStories[i]?.headline_en || '',
      durationSec:  finalDurations[i],
      storyNumber:  i + 1,
      totalStories: usedStories.length,
      outPath:      segPath,
    });
    if (!r.ok) {
      log('segment-error', { story: i + 1, reason: r.reason });
      continue;
    }
    exec('ffmpeg', r.args);
    segmentPaths.push(segPath);
    log('segment-rendered', { story: i + 1, seconds: finalDurations[i] });
  }

  if (segmentPaths.length < 2) {
    log('abort', { reason: 'fewer_than_2_segments_rendered', rendered: segmentPaths.length });
    process.exitCode = 1;
    return;
  }

  // ── 6. Concatenate video segments ─────────────────────────────────────────
  const concatListPath = path.join(TMP, 'concat.txt');
  const concatVideoPath = path.join(TMP, 'concat-video.mp4');
  const cr = buildConcatArgs({
    segmentPaths,
    concatListPath,
    outPath: concatVideoPath,
  });
  if (!cr.ok) {
    log('abort', { reason: 'buildConcatArgs_failed', detail: cr.reason });
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(concatListPath, cr.concatContent);
  exec('ffmpeg', cr.args);
  log('concat-done', { segments: segmentPaths.length });

  // ── 7. Build multi-story audio ────────────────────────────────────────────
  const validTtsFiles = ttsFiles.filter(Boolean);
  let finalAudioPath;

  if (validTtsFiles.length > 0) {
    // Concat TTS tracks with 1-second silences.
    const multiVoicePath = path.join(TMP, 'multi-voice.mp3');
    const mvr = buildMultiVoiceConcatArgs({ audioFiles: validTtsFiles, outPath: multiVoicePath });
    if (!mvr.ok) {
      log('tts-concat-error', { reason: mvr.reason });
    } else {
      exec('ffmpeg', mvr.args);
    }

    // Generate audio bed matched to total video duration.
    const bedPath = path.join(TMP, 'news-bed.m4a');
    const bedR1 = newsDailyBedArgs({ seconds: Math.min(totalSec, DAILY_MAX_SECONDS), out: bedPath });
    if (!bedR1.ok) throw new Error(`newsDailyBedArgs failed: ${bedR1.reason}`);
    exec('ffmpeg', bedR1.args);

    if (mvr.ok && fs.existsSync(multiVoicePath)) {
      // Mix voice over bed.
      const mixPath = path.join(TMP, 'mix.m4a');
      const mr = buildVoiceoverMixArgs({
        bedPath,
        voicePath:    multiVoicePath,
        outPath:      mixPath,
        stingDelaySec: 1,
      });
      if (mr.ok) {
        exec('ffmpeg', mr.args);
        finalAudioPath = mixPath;
        log('audio', { type: 'voiced-mix' });
      } else {
        log('mix-error', { reason: mr.reason });
      }
    }

    if (!finalAudioPath) {
      finalAudioPath = bedPath;
      log('audio', { type: 'bed-only-tts-fallback' });
    }
  } else {
    // No TTS at all — use bed only.
    const bedPath = path.join(TMP, 'news-bed.m4a');
    const bedR2 = newsDailyBedArgs({ seconds: Math.min(totalSec, DAILY_MAX_SECONDS), out: bedPath });
    if (!bedR2.ok) throw new Error(`newsDailyBedArgs failed: ${bedR2.reason}`);
    exec('ffmpeg', bedR2.args);
    finalAudioPath = bedPath;
    log('audio', { type: 'bed-only' });
  }

  // ── 8. Mux video + audio ──────────────────────────────────────────────────
  const finalMp4 = path.join(TMP, `${contentId}.mp4`);
  const muxR = buildMuxArgs({
    videoPath: concatVideoPath,
    audioPath: finalAudioPath,
    outPath:   finalMp4,
  });
  if (!muxR.ok) {
    log('abort', { reason: 'buildMuxArgs_failed', detail: muxR.reason });
    process.exitCode = 1;
    return;
  }
  exec('ffmpeg', muxR.args);
  log('mux-done', { mp4: finalMp4 });

  // ── 9. Write outputs to LANE_OUT ──────────────────────────────────────────
  const outMp4  = path.join(OUT, `${contentId}.mp4`);
  const outJson = path.join(OUT, `${contentId}.json`);

  fs.copyFileSync(finalMp4, outMp4);

  const caption = buildDailyReelCaption(usedStories);
  const videoUrl = `https://raw.githubusercontent.com/${REPO}/main/claude-lane/media/reels/${contentId}.mp4`;
  const metadata = {
    content_id:  contentId,
    created_at:  now.toISOString(),
    story_count: usedStories.length,
    story_ids:   usedStories.map(s => s?.content_id || s?.id).filter(Boolean),
    total_seconds: totalSec,
    caption,
    caption_en:  caption,
    hashtags:    ['#matrix24', '#worldnews', '#breakingnews', '#noticias'],
    image_url:   null,
    video_url:   videoUrl,
    tts_stories: ttsFiles.filter(Boolean).length,
  };
  fs.writeFileSync(outJson, JSON.stringify(metadata, null, 2));

  log('done', {
    contentId,
    mp4: outMp4,
    json: outJson,
    stories: usedStories.length,
    totalSec,
  });
}

main().catch(e => {
  console.error('daily-reel fatal:', e);
  process.exitCode = 1;
});
