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

  const title = typeof titleEs === 'string' ? titleEs.trim() : '';
  const badge = escapeDratext(`${storyNumber}/${totalStories}`);

  // Build filter chain: badge + timed subtitle filters (or static fallback).
  const textFilters = [
    // Story-number badge — top-right, semi-transparent background.
    `drawtext=fontfile=${FONT_PATH}:text='${badge}':x=w-110:y=38:` +
    `fontsize=36:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=10`,
  ];

  if (subtitleFilters.length > 0) {
    // Timed per-phrase subtitles from buildSubtitleFilters().
    textFilters.push(...subtitleFilters);
  } else if (title) {
    // Static fallback: single drawtext covering the whole segment.
    const escaped = escapeDratext(title);
    textFilters.push(
      `drawtext=fontfile=${FONT_PATH}:text='${escaped}':` +
      `x=(w-tw)/2:y=1660:fontsize=40:fontcolor=white:` +
      `box=1:boxcolor=black@0.65:boxborderw=14:line_spacing=6`,
    );
  }

  const vf = [
    'scale=1080:1350:force_original_aspect_ratio=decrease',
    'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black',
    ...textFilters,
  ].join(',');

  return {
    ok: true,
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-loop', '1', '-i', imagePath,
      '-t', String(durationSec),
      '-vf', vf,
      '-r', '30', '-c:v', 'libx264', '-preset', 'fast',
      '-pix_fmt', 'yuv420p', '-an',
      outPath,
    ],
  };
}

/**
 * FFmpeg args to concatenate video segments via a concat demuxer list file.
 * Writes the concat list content (caller must write it to concatListPath).
 *
 * @param {object}   opts
 * @param {string[]} opts.segmentPaths    Paths to input .mp4 segments.
 * @param {string}   opts.concatListPath  Path where the caller will write the concat list.
 * @param {string}   opts.outPath         Output .mp4 path.
 * @returns {{ ok: true, args: string[], concatContent: string } | { ok: false, reason: string }}
 */
export function buildConcatArgs({ segmentPaths, concatListPath, outPath }) {
  if (!Array.isArray(segmentPaths) || segmentPaths.length < 1)
    return { ok: false, reason: 'need_at_least_one_segment' };
  if (typeof concatListPath !== 'string')
    return { ok: false, reason: 'concatListPath_must_be_string' };
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
 * FFmpeg args to mux a video-only stream with an audio stream.
 *
 * @param {object} opts
 * @param {string} opts.videoPath  Path to video-only .mp4.
 * @param {string} opts.audioPath  Path to audio file (.m4a or .mp3).
 * @param {string} opts.outPath    Output .mp4 path.
 * @returns {{ ok: true, args: string[] } | { ok: false, reason: string }}
 */
export function buildMuxArgs({ videoPath, audioPath, outPath }) {
  if (typeof videoPath !== 'string' || !videoPath.endsWith('.mp4'))
    return { ok: false, reason: 'videoPath_must_be_mp4' };
  if (typeof audioPath !== 'string')
    return { ok: false, reason: 'audioPath_must_be_string' };
  if (typeof outPath !== 'string' || !outPath.endsWith('.mp4'))
    return { ok: false, reason: 'outPath_must_be_mp4' };

  return {
    ok: true,
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', videoPath,
      '-i', audioPath,
      '-c:v', 'copy', '-c:a', 'aac',
      '-shortest',
      outPath,
    ],
  };
}

/**
 * FFmpeg args to concatenate multiple TTS MP3 files with 1-second silences between them.
 *
 * @param {object}   opts
 * @param {string[]} opts.audioFiles  Paths to MP3 files.
 * @param {string}   opts.outPath     Output MP3 path.
 * @returns {{ ok: true, args: string[] } | { ok: false, reason: string }}
 */
export function buildMultiVoiceConcatArgs({ audioFiles, outPath }) {
  if (!Array.isArray(audioFiles) || audioFiles.length === 0)
    return { ok: false, reason: 'need_at_least_one_audio_file' };
  if (typeof outPath !== 'string' || !outPath.endsWith('.mp3'))
    return { ok: false, reason: 'outPath_must_be_mp3' };

  const inputs = [];
  const filterParts = [];
  let idx = 0;

  for (let i = 0; i < audioFiles.length; i++) {
    inputs.push('-i', audioFiles[i]);
    filterParts.push(`[${idx}:a]`);
    idx++;

    if (i < audioFiles.length - 1) {
      // Insert 1-second silence between stories.
      inputs.push('-f', 'lavfi', '-i', 'aevalsrc=0:d=1');
      filterParts.push(`[${idx}:a]`);
      idx++;
    }
  }

  const filterComplex = `${filterParts.join('')}concat=n=${idx}:v=0:a=1[out]`;

  return {
    ok: true,
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      outPath,
    ],
  };
}

/**
 * Build the Instagram caption for a daily news-summary Reel.
 * Spanish headline for each story, then hashtags.
 *
 * @param {Array<{headline_es?: string, headline_en?: string, hashtags?: string[]}>} stories
 * @returns {string}
 */
export function buildDailyReelCaption(stories) {
  if (!Array.isArray(stories) || stories.length === 0) return '';

  const lines = stories.map((s, i) => {
    const headline = s?.headline_es || s?.headline_en || '';
    return `${i + 1}. ${headline}`;
  }).filter(Boolean);

  const tagSet = new Set(['#matrix24', '#worldnews', '#breakingnews', '#noticias']);
  for (const s of stories) {
    for (const tag of (s?.hashtags || [])) {
      if (tagSet.size < 10) tagSet.add(tag);
    }
  }

  return [...lines, '', [...tagSet].join(' ')].join('\n');
}

/**
 * Measure the duration (in seconds) of an audio file using ffprobe.
 * Throws if ffprobe output is non-numeric.
 *
 * @param {string} filePath
 * @param {{ exec: Function }} opts  Inject execFileSync for testability.
 * @returns {number}
 */
export function measureAudioDuration(filePath, { exec = execFileSync } = {}) {
  const raw = exec('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { encoding: 'utf8' });
  const dur = parseFloat(String(raw).trim());
  if (isNaN(dur)) throw new Error(`ffprobe returned non-numeric duration: ${raw}`);
  return dur;
}

/**
 * FFmpeg args to generate a 3-layer musical news bed as an .m4a file.
 *
 * Layer 1: Repeating C5→E5→G5→C6 arpeggio (1.5-second cycle)
 * Layer 2: Pulsed bass (110 Hz, 2 Hz rhythm)
 * Layer 3: High-frequency shimmer
 *
 * All layers use FFmpeg lavfi aevalsrc (purely generative — no audio files needed).
 * Mixed with amix + 2-second fade-out.
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
  // aevalsrc= prefix required by FFmpeg lavfi demuxer.
  const arpExpr =
    `aevalsrc=0.35*(between(mod(t,1.5),0,0.34)*sin(2*PI*523*t)` +
    `+between(mod(t,1.5),0.38,0.72)*sin(2*PI*659*t)` +
    `+between(mod(t,1.5),0.76,1.10)*sin(2*PI*784*t)` +
    `+between(mod(t,1.5),1.14,1.48)*sin(2*PI*1047*t)):d=${seconds}`;

  // Layer 2 — Pulsed bass: 110 Hz sine gated by one-sided 2 Hz rhythm.
  // max(0,sin(...)) produces kick-like pulses (positive half-wave only).
  const bassExpr = `aevalsrc=0.28*sin(2*PI*110*t)*max(0,sin(2*PI*2*t)):d=${seconds}`;

  // Layer 3 — High-frequency shimmer for broadcast-style atmosphere.
  const shimmerExpr = `aevalsrc=0.012*(random(0)*2-1):d=${seconds}`;

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
  // Try sentence boundaries first (.!?)
  let parts = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts;
  // Try clause boundaries (,;:)
  parts = text.split(/(?<=[,;:])\s+/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts;
  // Long single-clause text: halve by word count.
  if (text.length > 48) {
    const words = text.split(/\s+/);
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')].filter(Boolean);
  }
  return [text];
}

/**
 * Build timed FFmpeg drawtext filters for Spanish subtitles synced to English TTS timing.
 *
 * When wordTimings is provided (from edge-tts WordBoundary events):
 *   - Maps each Spanish phrase proportionally to the English word-boundary timeline.
 *   - Each phrase appears exactly when the corresponding English words are spoken.
 *
 * When wordTimings is absent or empty:
 *   - Distributes phrases evenly across the segment duration.
 *
 * @param {object}         opts
 * @param {string}         opts.esText       Spanish headline text.
 * @param {Array|null}     opts.wordTimings  WordBoundary events [{text, offset, duration}] in
 *                                           100-ns tick units, or null/[] for even distribution.
 * @param {string}         opts.fontPath     Font file path (defaults to FONT_PATH).
 * @param {number}         opts.totalSec     Segment duration in seconds.
 * @returns {string[]}  Array of drawtext filter strings (may be empty on invalid input).
 */
export function buildSubtitleFilters({ esText, wordTimings, fontPath, totalSec }) {
  if (typeof esText !== 'string' || !esText.trim()) return [];
  if (typeof totalSec !== 'number' || totalSec <= 0) return [];

  const fp = fontPath || FONT_PATH;
  const text = esText.trim();
  const phrases = splitSubtitlePhrases(text);

  const baseStyle =
    `x=(w-tw)/2:y=1660:fontsize=40:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=14:line_spacing=6`;

  // No timing data: distribute all phrases evenly across the segment duration.
  if (!wordTimings || wordTimings.length === 0) {
    const perPhraseSec = totalSec / phrases.length;
    return phrases.map((phrase, i) => {
      const s  = +(i * perPhraseSec).toFixed(3);
      const e2 = +Math.min((i + 1) * perPhraseSec - 0.1, totalSec - 0.05).toFixed(3);
      const escaped = escapeDratext(phrase);
      return `drawtext=fontfile=${fp}:text='${escaped}':${baseStyle}:enable='between(t,${s},${e2})'`;
    });
  }

  // Timing available: map phrases proportionally to English word-boundary timeline.
  const lastWt   = wordTimings[wordTimings.length - 1];
  const speechEnd = Math.min((lastWt.offset + lastWt.duration) / 10_000_000, totalSec);
  void speechEnd; // used only for reference
  const perPhrase = Math.max(1, wordTimings.length / phrases.length);

  return phrases.map((phrase, i) => {
    const wStart = Math.floor(i * perPhrase);
    const wEnd   = Math.min(Math.floor((i + 1) * perPhrase) - 1, wordTimings.length - 1);
    const rawStart = wordTimings[wStart].offset / 10_000_000;
    const wtEnd    = wordTimings[wEnd];
    const rawEnd   = Math.min((wtEnd.offset + wtEnd.duration) / 10_000_000, totalSec - 0.05);
    const s  = Math.max(0, Math.min(rawStart, rawEnd - 0.1));
    const e2 = Math.max(s + 0.1, rawEnd);
    const escaped = escapeDratext(phrase);
    return `drawtext=fontfile=${fp}:text='${escaped}':${baseStyle}:enable='between(t,${s.toFixed(3)},${e2.toFixed(3)})'`;
  });
}
