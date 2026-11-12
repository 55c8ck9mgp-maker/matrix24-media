// Claude Lane — daily news-summary Reel video builder (Phase 7).
// Pure argument builders + helpers. Never calls FFmpeg or any external service
// directly — all execution stays in the workflow/orchestrator.
// See docs/CLAUDE_LANE.md "Phase 7 — Daily News Summary Reel".

import { execFileSync } from 'node:child_process';

export const FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
export const DAILY_MAX_SECONDS = 90;
export const STORY_DURATION_SEC = 20; // per-story segment, before TTS measurement

/**
 * Escape a string for FFmpeg drawtext.
 * Required escapes: \ → \\, ' → \', : → \:, % → %%
 */
export function escapeDratext(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/'/g,  "\\'")
    .replace(/:/g,  '\\:')
    .replace(/%/g,  '%%');
}

/**
 * FFmpeg args to render one story image as a video segment with text overlays.
 *
 * Layout:
 *   - Input 1080x1350 card JPEG → scale 1080x1350 → pad to 1080x1920 (centred)
 *   - Story-number badge (top-right corner)
 *   - Spanish headline (bottom, two lines max)
 *
 * @param {object}   opts
 * @param {string}   opts.imagePath        Path to 1080x1350 JPEG.
 * @param {string}   opts.titleEs          Spanish headline text (static fallback, may be empty).
 * @param {number}   opts.durationSec      Segment duration in seconds (integer ≥ 1).
 * @param {number}   opts.storyNumber      1-based story index.
 * @param {number}   opts.totalStories     Total number of stories (for badge).
 * @param {string}   opts.outPath          Output MP4 path.
 * @param {string[]} [opts.subtitleFilters] Timed drawtext filters from buildSubtitleFilters().
 *                                          When non-empty these replace the static titleEs overlay.
 * @returns {{ ok: true, args: string[] } | { ok: false, reason: string }}
 */
export function buildSegmentArgs({
  imagePath, titleEs, durationSec, storyNumber, totalStories, outPath,
  subtitleFilters = [],
}) {
  if (typeof imagePath !== 'string' || !/\.jpe?g$/i.test(imagePath))
    return { ok: false, reason: 'imagePath_must_be_jpeg' };
  if (!Number.isInteger(durationSec) || durationSec < 1)
    return { ok: false, reason: 'durationSec_must_be_positive_integer' };
  if (!Number.isInteger(storyNumber) || storyNumber < 1)
    return { ok: false, reason: 'storyNumber_must_be_positive_integer' };
  if (!Number.isInteger(totalStories) || totalStories < 1)
    return { ok: false, reason: 'totalStories_must_be_positive_integer' };
  if (typeof outPath !== 'string' || !outPath.endsWith('.mp4'))
    return { ok: false, reason: 'outPath_must_be_mp4' };

  const dur = String(durationSec);
  const badge  = escapeDratext(`${storyNumber}/${totalStories}`);
  const title  = escapeDratext(typeof titleEs === 'string' && titleEs.trim()
    ? titleEs.trim()
    : '');

  // drawtext filters:
  // 1. Story badge — top-right corner (white on dark box)
  // 2. Spanish subtitle — either timed per-phrase (subtitleFilters) or static titleEs
  const textFilters = [
    `drawtext=fontfile=${FONT_PATH}:text='${badge}':x=w-110:y=38:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=8`,
  ];
  if (subtitleFilters.length > 0) {
    // Timed Spanish subtitle filters synced to English speech rhythm.
    textFilters.push(...subtitleFilters);
  } else if (title) {
    // Static Spanish headline for the full segment duration (fallback).
    textFilters.push(
      `drawtext=fontfile=${FONT_PATH}:text='${title}':x=(w-tw)/2:y=1660:fontsize=40:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=14:line_spacing=6`,
    );
  }

  const vf = [
    'scale=1080:1350',
    'pad=1080:1920:0:285:color=black',
    'fps=30',
    'format=yuv420p',
    ...textFilters,
  ].join(',');

  return {
    ok: true,
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-loop', '1', '-t', dur,
      '-i', imagePath,
      '-vf', vf,
      '-t', dur,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-an',
      outPath,
    ],
  };
}

/**
 * Build the FFmpeg concat-demuxer file content and args to join video segments.
 *
 * @param {object} opts
 * @param {string[]} opts.segmentPaths   Ordered list of MP4 segment paths.
 * @param {string}   opts.concatListPath Path where the concat list file is written.
 * @param {string}   opts.outPath        Output MP4 path (video only, no audio).
 * @returns {{ ok: true, concatContent: string, args: string[] } | { ok: false, reason: string }}
 */
export function buildConcatArgs({ segmentPaths, concatListPath, outPath }) {
  if (!Array.isArray(segmentPaths) || segmentPaths.length === 0)
    return { ok: false, reason: 'segmentPaths_must_be_non_empty_array' };
  for (const p of segmentPaths) {
    if (typeof p !== 'string' || !p.endsWith('.mp4'))
      return { ok: false, reason: 'each_segment_must_be_mp4' };
  }
  if (typeof concatListPath !== 'string' || !concatListPath)
    return { ok: false, reason: 'concatListPath_required' };
  if (typeof outPath !== 'string' || !outPath.endsWith('.mp4'))
    return { ok: false, reason: 'outPath_must_be_mp4' };

  const concatContent = segmentPaths
    .map(p => `file '${p.replace(/'/g, "'\\''")}'`)
    .join('\n') + '\n';

  return {
    ok: true,
    concatContent,
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      outPath,
    ],
  };
}

/**
 * FFmpeg args to mux a silent video track with an m4a audio track.
 * The output length is determined by -shortest.
 *
 * @param {object} opts
 * @param {string} opts.videoPath  MP4 (video only) path.
 * @param {string} opts.audioPath  .m4a audio path.
 * @param {string} opts.outPath    Output MP4 path.
 * @returns {{ ok: true, args: string[] } | { ok: false, reason: string }}
 */
export function buildMuxArgs({ videoPath, audioPath, outPath }) {
  if (typeof videoPath !== 'string' || !videoPath.endsWith('.mp4'))
    return { ok: false, reason: 'videoPath_must_be_mp4' };
  if (typeof audioPath !== 'string' || !audioPath.endsWith('.m4a'))
    return { ok: false, reason: 'audioPath_must_be_m4a' };
  if (typeof outPath !== 'string' || !outPath.endsWith('.mp4'))
    return { ok: false, reason: 'outPath_must_be_mp4' };
  return {
    ok: true,
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', videoPath,
      '-i', audioPath,
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '128k',
      '-shortest', '-movflags', '+faststart',
      outPath,
    ],
  };
}

/**
 * FFmpeg args to concatenate N MP3 audio files with a 1-second silence gap
 * between each pair.  Single-file input is simply copied.
 *
 * Uses N-1 anullsrc inputs (one per gap) to avoid FFmpeg input reuse issues.
 *
 * @param {object} opts
 * @param {string[]} opts.audioFiles  Ordered list of .mp3 paths (N ≥ 1).
 * @param {string}   opts.outPath     Output .mp3 path.
 * @returns {{ ok: true, args: string[] } | { ok: false, reason: string }}
 */
export function buildMultiVoiceConcatArgs({ audioFiles, outPath }) {
  if (!Array.isArray(audioFiles) || audioFiles.length === 0)
    return { ok: false, reason: 'audioFiles_must_be_non_empty_array' };
  for (const f of audioFiles) {
    if (typeof f !== 'string' || !f.endsWith('.mp3'))
      return { ok: false, reason: 'each_audio_file_must_be_mp3' };
  }
  if (typeof outPath !== 'string' || !outPath.endsWith('.mp3'))
    return { ok: false, reason: 'outPath_must_be_mp3' };

  if (audioFiles.length === 1) {
    // Single track — copy without re-encoding.
    return {
      ok: true,
      args: [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', audioFiles[0],
        '-c', 'copy',
        outPath,
      ],
    };
  }

  // N audio files → N-1 silence gaps.
  const N = audioFiles.length;
  const gaps = N - 1;

  // Inputs: [0..N-1] = mp3 files, [N..N+gaps-1] = anullsrc silence sources.
  const inputArgs = [];
  for (const f of audioFiles) inputArgs.push('-i', f);
  for (let g = 0; g < gaps; g++) {
    inputArgs.push('-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono');
  }

  // Build filter_complex:
  // Each silence source is trimmed to 1 s.
  // Then concat all: file0, sil0, file1, sil1, ..., fileN-1
  const filterParts = [];
  for (let g = 0; g < gaps; g++) {
    filterParts.push(`[${N + g}:a]atrim=duration=1[sil${g}]`);
  }

  // Interleave files and silence labels.
  const concatInputs = [];
  for (let i = 0; i < N; i++) {
    concatInputs.push(`[${i}:a]`);
    if (i < gaps) concatInputs.push(`[sil${i}]`);
  }
  const totalInputs = N + gaps; // N files + N-1 silences
  filterParts.push(`${concatInputs.join('')}concat=n=${totalInputs}:v=0:a=1[out]`);

  return {
    ok: true,
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...inputArgs,
      '-filter_complex', filterParts.join(';'),
      '-map', '[out]',
      '-t', '300',  // safety cap: combined narration ≤ 5 min
      '-c:a', 'libmp3lame', '-q:a', '4',
      outPath,
    ],
  };
}

/**
 * Measure the duration of an audio/video file using ffprobe.
 * Returns duration in seconds as a float.
 * Throws if ffprobe output cannot be parsed.
 *
 * @param {string}  filePath
 * @param {object}  opts
 * @param {Function} opts.exec  Injectable execFileSync (default: node's).
 * @returns {number}
 */
export function measureAudioDuration(filePath, { exec = execFileSync } = {}) {
  const out = exec('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    filePath,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const val = parseFloat(String(out).trim());
  if (!isFinite(val)) throw new Error(`ffprobe returned non-numeric duration: ${out}`);
  return val;
}

/**
 * Build the Instagram caption for the daily Reel.
 * Format:
 *   1️⃣ Headline one
 *   2️⃣ Headline two
 *   ...
 *
 *   #matrix24 #worldnews ...combined hashtags...
 *
 * @param {object[]} stories  Array of draft objects with headline_en and hashtags.
 * @returns {string}
 */
/**
 * FFmpeg args to generate the news audio bed for the daily Reel.
 * Supports up to DAILY_MAX_SECONDS (90 s), which exceeds the Phase-5 Reel
 * limit (60 s).  Phase-5 reels must use generateAudioBed from reel-render.mjs.
 *
 * @param {object} opts
 * @param {number} opts.seconds  Duration in seconds (integer, 5–90). Default: DAILY_MAX_SECONDS.
 * @param {string} opts.out      Output .m4a path.
 * @returns {{ ok: true, args: string[] } | { ok: false, reason: string }}
 */
export function newsDailyBedArgs({ seconds = DAILY_MAX_SECONDS, out } = {}) {
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > DAILY_MAX_SECONDS)
    return { ok: false, reason: 'duration_out_of_range' };
  if (typeof out !== 'string' || !out.endsWith('.m4a'))
    return { ok: false, reason: 'output_must_be_m4a' };

  const fadeStart = Math.max(0, seconds - 2);

  // Layer 1 — Repeating C5→E5→G5→C6 arpeggio (1.5-second cycle).
  // between(mod(t,period),start,end) gates each note to its time slot.
  const arpExpr =
    `0.35*(between(mod(t,1.5),0,0.34)*sin(2*PI*523*t)` +
    `+between(mod(t,1.5),0.38,0.72)*sin(2*PI*659*t)` +
    `+between(mod(t,1.5),0.76,1.10)*sin(2*PI*784*t)` +
    `+between(mod(t,1.5),1.14,1.48)*sin(2*PI*1047*t)):d=${seconds}`;

  // Layer 2 — Pulsed bass: 110 Hz sine gated by one-sided 2 Hz rhythm.
  // max(0,sin(...)) produces kick-like pulses (positive half-wave only).
  const bassExpr = `0.28*sin(2*PI*110*t)*max(0,sin(2*PI*2*t)):d=${seconds}`;

  // Layer 3 — High-frequency shimmer for broadcast-style atmosphere.
  const shimmerExpr = `0.012*(random(0)*2-1):d=${seconds}`;

  return {
    ok: true,
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', arpExpr,
      '-f', 'lavfi', '-i', bassExpr,
      '-f', 'lavfi', '-i', shimmerExpr,
      '-filter_complex',
      `[0:a]volume=1[arp];[1:a]volume=1[bass];[2:a]highpass=f=3000,volume=0.5[shi];` +
      `[arp][bass][shi]amix=inputs=3:duration=first:normalize=0,afade=t=out:st=${fadeStart}:d=2`,
      '-ac', '2', '-ar', '44100', '-c:a', 'aac', '-b:a', '128k', out,
    ],
  };
}

/**
 * Split Spanish text into subtitle phrases by sentence/clause boundaries.
 * Falls back to word-count halving for long single-clause text.
 * @param {string} text
 * @returns {string[]}
 */
function splitSubtitlePhrases(text) {
  // 1. Sentence boundaries (.!?)
  let parts = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts;

  // 2. Clause boundaries (comma, semicolon, colon)
  parts = text.split(/(?<=[,;:])\s+/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts;

  // 3. Word-count halving for long text
  if (text.length > 48) {
    const words = text.split(/\s+/);
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')].filter(Boolean);
  }

  return [text];
}

/**
 * Build timed Spanish subtitle drawtext filters for one video segment.
 *
 * Maps Spanish phrases proportionally to English word-boundary timing data
 * captured from edge-tts streaming (WordBoundary events).  When timing data is
 * absent the single phrase is shown for the full segment duration.
 *
 * @param {object}  opts
 * @param {string}  opts.esText       Spanish text to show as subtitle.
 * @param {Array}   opts.wordTimings  edge-tts WordBoundary events:
 *                                   [{text, offset, duration}] where
 *                                   offset/duration are 100-ns tick units.
 *                                   Pass null/[] to skip timing.
 * @param {string}  [opts.fontPath]  FFmpeg font file path (default: FONT_PATH).
 * @param {number}  opts.totalSec    Total segment duration in seconds.
 * @returns {string[]}  Array of drawtext filter strings (may be empty).
 */
export function buildSubtitleFilters({ esText, wordTimings, fontPath, totalSec }) {
  if (typeof esText !== 'string' || !esText.trim()) return [];
  if (typeof totalSec !== 'number' || totalSec <= 0) return [];

  const fp = fontPath || FONT_PATH;
  const text = esText.trim();
  const phrases = splitSubtitlePhrases(text);

  const baseStyle =
    `x=(w-tw)/2:y=1660:fontsize=40:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=14:line_spacing=6`;

  // No timing: distribute phrases evenly across the segment duration.
  if (!wordTimings || wordTimings.length === 0) {
    const perPhraseSec = totalSec / phrases.length;
    return phrases.map((phrase, i) => {
      const s  = +(i * perPhraseSec).toFixed(3);
      const e2 = +Math.min((i + 1) * perPhraseSec - 0.1, totalSec - 0.05).toFixed(3);
      const escaped = escapeDratext(phrase);
      return `drawtext=fontfile=${fp}:text='${escaped}':${baseStyle}:enable='between(t,${s},${e2})'`;
    });
  }

  // Map phrases proportionally to English word-boundary timeline.
  const lastWt   = wordTimings[wordTimings.length - 1];
  const speechEnd = Math.min((lastWt.offset + lastWt.duration) / 10_000_000, totalSec);
  const perPhrase = Math.max(1, wordTimings.length / phrases.length);

  return phrases.map((phrase, i) => {
    const wStart = Math.floor(i * perPhrase);
    const wEnd   = Math.min(Math.floor((i + 1) * perPhrase) - 1, wordTimings.length - 1);

    const rawStart = wordTimings[wStart].offset / 10_000_000;
    const wtEnd    = wordTimings[wEnd];
    const rawEnd   = Math.min((wtEnd.offset + wtEnd.duration) / 10_000_000, totalSec - 0.05);

    // Guard: start must be strictly less than end.
    const s  = Math.max(0, Math.min(rawStart, rawEnd - 0.1));
    const e2 = Math.max(s + 0.1, rawEnd);

    const escaped = escapeDratext(phrase);
    return `drawtext=fontfile=${fp}:text='${escaped}':${baseStyle}:enable='between(t,${s.toFixed(3)},${e2.toFixed(3)})'`;
  });
}

export function buildDailyReelCaption(stories) {
  const numberEmoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];
  const lines = stories.map((s, i) => {
    const emoji = numberEmoji[i] || `${i + 1}.`;
    const headline = (s?.headline_en || '').trim() || (s?.headline_es || '').trim();
    return `${emoji} ${headline}`;
  });

  // Merge hashtags from all stories, deduplicate, keep order-of-first-appearance.
  const seen = new Set();
  const baseTags = ['#matrix24', '#worldnews', '#breakingnews', '#noticias'];
  const allTags = [...baseTags];
  for (const s of stories) {
    for (const tag of (Array.isArray(s?.hashtags) ? s.hashtags : [])) {
      const t = String(tag).trim().toLowerCase();
      if (t && !seen.has(t)) { seen.add(t); allTags.push(tag); }
    }
  }
  // Deduplicate baseTags too.
  const dedupTags = [];
  const tagSeen = new Set();
  for (const t of allTags) {
    const key = String(t).toLowerCase();
    if (!tagSeen.has(key)) { tagSeen.add(key); dedupTags.push(t); }
  }

  return [
    lines.join('\n'),
    '',
    dedupTags.join(' '),
  ].join('\n');
}
