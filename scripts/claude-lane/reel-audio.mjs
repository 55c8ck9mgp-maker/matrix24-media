// Claude Lane Reels audio bed (staging only, not wired into any publisher).
// Builds an ORIGINAL news-style sound: a short synthesized "sting" tone plus
// a low filtered noise bed, mixed with a fade-out. No broadcast jingles, no
// licensed music. Instagram's Graph API cannot attach a trending audio to a
// Reel, so the sound must be inside the MP4 that is uploaded.
export const DEFAULT_SECONDS = 30;

export function newsBedArgs({ seconds = DEFAULT_SECONDS, out }) {
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 60) return { ok: false, reason: 'duration_out_of_range' };
  if (typeof out !== 'string' || !out.endsWith('.m4a')) return { ok: false, reason: 'output_must_be_m4a' };
  const fadeStart = Math.max(0, seconds - 2);
  return {
    ok: true,
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.25',
      '-f', 'lavfi', '-i', `aevalsrc=0.02*(random(0)*2-1):d=${seconds}`,
      '-filter_complex',
      `[0:a]volume=0.4,apad=whole_dur=${seconds}[sting];[1:a]lowpass=f=900,volume=0.5[bed];` +
      `[sting][bed]amix=inputs=2:duration=first:normalize=0,afade=t=out:st=${fadeStart}:d=2`,
      '-ac', '2', '-ar', '44100', '-c:a', 'aac', '-b:a', '128k', out,
    ],
  };
}
