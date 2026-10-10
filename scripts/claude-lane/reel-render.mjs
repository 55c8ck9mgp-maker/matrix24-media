// Claude Lane Reels renderer (DRY RUN only; not wired to publishing).
// Turns one published 1080x1350 card JPEG plus the news-style audio bed into a
// 1080x1920 MP4 (9:16). Returns the FFmpeg arguments; never uploads anything.
// The Reel is not published by this module. See docs/CLAUDE_LANE.md "Reels".
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
