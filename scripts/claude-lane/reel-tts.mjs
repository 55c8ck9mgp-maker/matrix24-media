// Claude Lane Reels — bilingual TTS voiceover (Phase 6).
// Generates Spanish + English MP3 narrations from headlines and summaries.
// Primary engine: edge-tts via Python (Microsoft Edge TTS, high quality, no API key).
// Fallback: espeak (offline, Ubuntu package, robotic but functional).
// Returns { esFile, enFile } or null; never throws — failures surface to stderr.
// See docs/CLAUDE_LANE.md "Phase 6 — TTS Reels".
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const ES_VOICE_EDGE  = 'es-MX-DaliaNeural';
export const EN_VOICE_EDGE  = 'en-US-GuyNeural';
export const ES_VOICE_SPEAK = 'es';
export const EN_VOICE_SPEAK = 'en';

function statSize(p) {
  try { return statSync(p).size; } catch { return 0; }
}

// Try edge-tts via Python: executes a one-liner that imports edge_tts and saves
// the audio to outPath. Uses JSON.stringify so text is safely embedded as a
// Python string literal regardless of quotes or special characters.
// rate: e.g. '-10%' (slower/clearer) or '+0%' (default).
function tryEdgeTTS(text, voice, outPath, { exec, rate = '' }) {
  const rateArg = rate ? `, rate=${JSON.stringify(rate)}` : '';
  const script = [
    'import asyncio, edge_tts',
    `async def _():`,
    `  c = edge_tts.Communicate(${JSON.stringify(text)}, ${JSON.stringify(voice)}${rateArg})`,
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
    ? (tryEdgeTTS(textEn, EN_VOICE_EDGE, enFile, { exec, rate: '-10%' })
    || tryEspeak(textEn, EN_VOICE_SPEAK, enFile, { exec }))
    : false;

  if (!esOk && !enOk) {
    process.stderr.write('reel-tts: all TTS methods failed — Reel will use audio bed only\n');
    return null;
  }
  return { esFile: esOk ? esFile : null, enFile: enOk ? enFile : null };
}

/**
 * Generate English TTS with word-boundary timing via edge-tts streaming API.
 * Uses en-US-GuyNeural at -10% rate (news anchor style).
 * Falls back to non-streaming save() if streaming fails, then to espeak.
 *
 * @param {{ text, voice?, outPath, timingPath }} params
 *   text        English text to synthesize.
 *   voice       TTS voice (default: EN_VOICE_EDGE).
 *   outPath     Output MP3 path.
 *   timingPath  Path to write word-boundary timing JSON.
 * @param {{ exec }} opts  Inject execFileSync for testability.
 * @returns {{ file: string, wordTimings: Array } | null}
 *   file        Path to the generated MP3.
 *   wordTimings Array of {text, offset, duration} (100-ns tick units).
 *               Empty array when timing is unavailable (fallback paths).
 */
export async function generateEnTTSWithTiming(
  { text, voice = EN_VOICE_EDGE, outPath, timingPath },
  { exec = execFileSync } = {},
) {
  if (!text || !String(text).trim()) return null;
  mkdirSync(path.dirname(outPath), { recursive: true });

  // ── Primary: edge-tts streaming (captures WordBoundary timing) ─────────────
  const streamScript = [
    'import asyncio, edge_tts, json',
    'async def _():',
    '    timings = []',
    `    c = edge_tts.Communicate(${JSON.stringify(String(text))}, ${JSON.stringify(voice)}, rate="-10%")`,
    `    with open(${JSON.stringify(outPath)}, "wb") as f:`,
    '        async for chunk in c.stream():',
    '            if chunk["type"] == "audio":',
    '                f.write(chunk["data"])',
    '            elif chunk["type"] == "WordBoundary":',
    '                timings.append({"text": chunk["text"], "offset": chunk["offset"], "duration": chunk["duration"]})',
    `    with open(${JSON.stringify(timingPath)}, "w") as tf:`,
    '        json.dump(timings, tf)',
    'asyncio.run(_()',
    ')',
  ].join('\n');

  try {
    exec('python3', ['-c', streamScript], { stdio: 'pipe', timeout: 30_000 });
    if (existsSync(outPath) && statSize(outPath) > 0) {
      let wordTimings = [];
      if (timingPath && existsSync(timingPath)) {
        try { wordTimings = JSON.parse(readFileSync(timingPath, 'utf8')); } catch { /* skip */ }
      }
      return { file: outPath, wordTimings };
    }
  } catch (e) {
    process.stderr.write(`reel-tts stream ${voice}: ${String(e.message).slice(0, 200)}\n`);
  }

  // ── Fallback 1: non-streaming save() (no timing) ───────────────────────────
  if (tryEdgeTTS(String(text), voice, outPath, { exec, rate: '-10%' }))
    return { file: outPath, wordTimings: [] };

  // ── Fallback 2: espeak (robotic but offline) ───────────────────────────────
  if (tryEspeak(String(text), EN_VOICE_SPEAK, outPath, { exec }))
    return { file: outPath, wordTimings: [] };

  return null;
}
