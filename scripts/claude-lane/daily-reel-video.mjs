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
 * @param {object} opts
 * @param {string} opts.imagePath      Path to 1080x1350 JPEG.
 * @param {string} opts.titleEs        Spanish headline text (may be empty).
 * @param {number} opts.durationSec    Segment duration in seconds (integer ≥ 1).
 * @param {number} opts.storyNumber    1-based story index.
 * @param {number} opts.totalStories   Total number of stories (for badge).
 * @param {string} opts.outPath        Output MP4 path.
 * @returns {{ ok: true, args: string[] } | { ok: false, reason: string }}
 */
export function buildSegmentArgs({
  imagePath, titleEs, durationSec, storyNumber, totalStories, outPath,
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
  // 2. Spanish headline — bottom-centre (white on dark box, wrapping enabled)
  const textFilters = [
    `drawtext=fontfile=${FONT_PATH}:text='${badge}':x=w-110:y=38:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=8`,
  ];
  if (title) {
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
