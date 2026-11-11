// Claude Lane Reels renderer.
// Turns one published 1080x1350 card JPEG plus the news-style audio bed into a
// 1080x1920 MP4 (9:16). Returns the FFmpeg arguments; never uploads anything.
// Publishing is handled by .github/workflows/claude-lane-reels.yml.
// See docs/CLAUDE_LANE.md "Reels".
import { execFileSync } from 'node:child_process';
import { newsBedArgs } from './reel-audio.mjs';

export const MIN_SECONDS = 5;
export const MAX_SECONDS = 60;

export function buildReelArgs({ image, audio, out, seconds = 15 }) {
  if (!Number.isInteger(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) return { ok: false, reason: 'duration_out_of_range' };
  if (typeof image !== 'string' || !/\.jpe?g$/i.test(image)) return { ok: false, reason: 'image_must_be_jpeg' };
  if (typeof audio !== 'string' || !audio.endsWith('.m4a')) return { ok: false, reason: 'audio_must_be_m4a' };
  if (typeof out !== 'string' || !out.endsWith('.mp4')) return { ok: false, reason: 'output_must_be_mp4' };
  return {
    ok: true,
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-loop', '1', '-i', image,
      '-i', audio,
      '-t', String(seconds),
      // 1080x1350 card centred on a 1080x1920 black frame.
      '-vf', 'scale=1080:1350,pad=1080:1920:0:285:color=black,fps=30,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart',
      out,
    ],
  };
}

// generateAudioBed: wraps newsBedArgs + execs ffmpeg to produce an AAC audio bed.
// { exec } is injectable for testability (default: execFileSync).
export function generateAudioBed(outPath, durationSec, { exec = execFileSync } = {}) {
  const r = newsBedArgs({ seconds: durationSec, out: outPath });
  if (!r.ok) throw new Error(`generateAudioBed: ${r.reason}`);
  exec('ffmpeg', r.args, { stdio: 'inherit' });
  return outPath;
}

// buildReelContainerParams: builds the Instagram Graph API request body for a
// Reels media container.
// - audioUrl is accepted for API symmetry but NOT forwarded; audio must be
//   embedded in the MP4 (the Graph API does not support a separate audio URL
//   for Reels).
// - cover_url is derived from record.image_url when it is an https:// URL.
export function buildReelContainerParams(record, mediaUrl, audioUrl) { // eslint-disable-line no-unused-vars
  if (!record || typeof record !== 'object' || Array.isArray(record))
    throw new TypeError('record must be a non-null object');
  if (typeof mediaUrl !== 'string' || !mediaUrl.startsWith('https://'))
    throw new TypeError('mediaUrl must be an https:// URL');
  const tags = Array.isArray(record.hashtags) ? record.hashtags.join(' ') : '';
  const caption = [
    typeof record.caption_en === 'string' ? record.caption_en.trim() : '',
    tags,
  ].filter(Boolean).join('\n\n');
  const params = {
    media_type: 'REELS',
    video_url: mediaUrl,
    caption,
    share_to_feed: true,
  };
  if (typeof record.image_url === 'string' && record.image_url.startsWith('https://')) {
    params.cover_url = record.image_url;
  }
  return params;
}

// ── Phase 6: TTS voiceover FFmpeg helpers ─────────────────────────────────────

/**
 * buildVoiceConcatArgs: FFmpeg args to concatenate Spanish + 0.5s silence + English
 * voices into a single MP3. If only one language file is provided, it is copied
 * directly (no concat). At least one file must be a valid .mp3 path.
 *
 * @param {{ esFile: string|null, enFile: string|null, outPath: string }} opts
 * @returns {{ ok: true, args: string[] } | { ok: false, reason: string }}
 */
export function buildVoiceConcatArgs({ esFile, enFile, outPath }) {
  if (typeof outPath !== 'string' || !outPath.endsWith('.mp3'))
    return { ok: false, reason: 'outPath_must_be_mp3' };
  const voices = [esFile, enFile].filter(v => typeof v === 'string' && v.endsWith('.mp3'));
  if (voices.length === 0) return { ok: false, reason: 'no_valid_voice_files' };
  if (voices.length === 1) {
    // Single voice — copy without re-encoding.
    return {
      ok: true,
      args: [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', voices[0],
        '-c', 'copy',
        outPath,
      ],
    };
  }
  // Both voices: ES + 0.5 s silence + EN, re-encoded to mono MP3.
  return {
    ok: true,
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', esFile,
      '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',
      '-i', enFile,
      '-filter_complex',
      '[1:a]atrim=duration=0.5[sil];[0:a][sil][2:a]concat=n=3:v=0:a=1[out]',
      '-map', '[out]',
      '-t', '120',          // safety cap: combined narration ≤ 2 min
      '-c:a', 'libmp3lame', '-q:a', '4',
      outPath,
    ],
  };
}

/**
 * buildVoiceoverMixArgs: FFmpeg args to mix the audio bed with a voice track.
 * - Bed (input 0) is ducked to volume=0.25 (background).
 * - Voice (input 1) plays at volume=1.0 (foreground), delayed by stingDelaySec.
 * - Output duration matches the bed (amix duration=first → first input = bed).
 *
 * @param {{ bedPath: string, voicePath: string, outPath: string, stingDelaySec?: number }} opts
 * @returns {{ ok: true, args: string[] } | { ok: false, reason: string }}
 */
export function buildVoiceoverMixArgs({ bedPath, voicePath, outPath, stingDelaySec = 1 }) {
  if (typeof bedPath !== 'string' || !bedPath.endsWith('.m4a'))
    return { ok: false, reason: 'bedPath_must_be_m4a' };
  if (typeof voicePath !== 'string' || !voicePath.endsWith('.mp3'))
    return { ok: false, reason: 'voicePath_must_be_mp3' };
  if (typeof outPath !== 'string' || !outPath.endsWith('.m4a'))
    return { ok: false, reason: 'outPath_must_be_m4a' };
  const delayMs = Math.round(stingDelaySec * 1000);
  return {
    ok: true,
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', bedPath,
      '-i', voicePath,
      '-filter_complex',
      `[0:a]volume=0.25[bed];[1:a]adelay=${delayMs}|${delayMs}[voice];[bed][voice]amix=inputs=2:duration=first:dropout_transition=2[out]`,
      '-map', '[out]',
      '-c:a', 'aac', '-b:a', '128k',
      outPath,
    ],
  };
}
