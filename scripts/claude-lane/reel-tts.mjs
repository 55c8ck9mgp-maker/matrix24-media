// Claude Lane Reels — bilingual TTS voiceover (Phase 6).
// Generates Spanish + English MP3 narrations from headlines and summaries.
// Primary engine: edge-tts via Python (Microsoft Edge TTS, high quality, no API key).
// Fallback: espeak (offline, Ubuntu package, robotic but functional).
// Returns { esFile, enFile } or null; never throws — failures surface to stderr.
// See docs/CLAUDE_LANE.md "Phase 6 — TTS Reels".
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const ES_VOICE_EDGE  = 'es-MX-DaliaNeural';
export const EN_VOICE_EDGE  = 'en-US-AriaNeural';
export const ES_VOICE_SPEAK = 'es';
export const EN_VOICE_SPEAK = 'en';

function statSize(p) {
  try { return statSync(p).size; } catch { return 0; }
}

// Try edge-tts via Python: executes a one-liner that imports edge_tts and saves
// the audio to outPath. Uses JSON.stringify so text is safely embedded as a
// Python string literal regardless of quotes or special characters.
function tryEdgeTTS(text, voice, outPath, { exec }) {
  const script = [
    'import asyncio, edge_tts',
    `async def _():`,
    `  c = edge_tts.Communicate(${JSON.stringify(text)}, ${JSON.stringify(voice)})`,
    `  await c.save(${JSON.stringify(outPath)})`,
    'asyncio.run(_()',
    ')',
  ].join('\n');
  try {
    exec('python3', ['-c', script], { stdio: 'pipe', timeout: 30_000 });
    return existsSync(outPath) && statSize(outPath) > 0;
  } catch (e) {
    process.stderr.write(`reel-tts edge-tts ${voice}: ${String(e.message).slice(0, 200)}\n`);
    return false;
  }
}

// espeak writes a WAV then ffmpeg converts to MP3.
function tryEspeak(text, lang, outPath, { exec }) {
  const wavPath = outPath.replace(/\.mp3$/, '.wav');
  try {
    exec('espeak', ['-v', lang, '-w', wavPath, text],
      { stdio: 'pipe', timeout: 20_000 });
    if (!existsSync(wavPath) || statSize(wavPath) === 0) return false;
    exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-i', wavPath, outPath], { stdio: 'pipe' });
    return existsSync(outPath) && statSize(outPath) > 0;
  } catch (e) {
    process.stderr.write(`reel-tts espeak ${lang}: ${String(e.message).slice(0, 200)}\n`);
    return false;
  }
}

/**
 * Generate bilingual TTS audio files.
 * @param {{ headline_es, summary_es, headline_en, summary_en, tmpDir }} params
 * @param {{ exec }} opts  Inject execFileSync for testability.
 * @returns {{ esFile: string|null, enFile: string|null } | null}
 *   null when no audio file was produced at all.
 */
export async function generateBilingualTTS(
  { headline_es, summary_es, headline_en, summary_en, tmpDir },
  { exec = execFileSync } = {},
) {
  mkdirSync(tmpDir, { recursive: true });

  const textEs = [headline_es, summary_es]
    .filter(Boolean).map(s => s.trim()).join('. ').replace(/\.{2,}/g, '.');
  const textEn = [headline_en, summary_en]
    .filter(Boolean).map(s => s.trim()).join('. ').replace(/\.{2,}/g, '.');

  const esFile = path.join(tmpDir, 'voice-es.mp3');
  const enFile = path.join(tmpDir, 'voice-en.mp3');

  const esOk = textEs
    ? (tryEdgeTTS(textEs, ES_VOICE_EDGE, esFile, { exec })
    || tryEspeak(textEs, ES_VOICE_SPEAK, esFile, { exec }))
    : false;

  const enOk = textEn
    ? (tryEdgeTTS(textEn, EN_VOICE_EDGE, enFile, { exec })
    || tryEspeak(textEn, EN_VOICE_SPEAK, enFile, { exec }))
    : false;

  if (!esOk && !enOk) {
    process.stderr.write('reel-tts: all TTS methods failed — Reel will use audio bed only\n');
    return null;
  }
  return { esFile: esOk ? esFile : null, enFile: enOk ? enFile : null };
}
