// Unit tests for Phase 6 TTS modules.
// Tests reel-tts.mjs (generateBilingualTTS with injected exec)
// and the new reel-render.mjs helpers (buildVoiceConcatArgs, buildVoiceoverMixArgs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { generateBilingualTTS, ES_VOICE_EDGE, EN_VOICE_EDGE } from '../scripts/claude-lane/reel-tts.mjs';
import { buildVoiceConcatArgs, buildVoiceoverMixArgs } from '../scripts/claude-lane/reel-render.mjs';

// ── buildVoiceConcatArgs ────────────────────────────────────────────────────

test('buildVoiceConcatArgs: rejects when both voices null', () => {
  const r = buildVoiceConcatArgs({ esFile: null, enFile: null, outPath: '/tmp/out.mp3' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'at_least_one_voice_required');
});

test('buildVoiceConcatArgs: rejects non-mp3 outPath', () => {
  const r = buildVoiceConcatArgs({ esFile: '/tmp/es.mp3', enFile: null, outPath: '/tmp/out.m4a' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'outPath_must_be_mp3');
});

test('buildVoiceConcatArgs: ES only — simple copy args', () => {
  const r = buildVoiceConcatArgs({ esFile: '/tmp/es.mp3', enFile: null, outPath: '/tmp/out.mp3' });
  assert.equal(r.ok, true);
  assert.ok(r.args.includes('/tmp/es.mp3'));
  assert.ok(r.args.includes('/tmp/out.mp3'));
  // Single-input: no concat filter needed
  assert.ok(!r.args.some(a => typeof a === 'string' && a.includes('concat')));
});

test('buildVoiceConcatArgs: EN only — simple copy args', () => {
  const r = buildVoiceConcatArgs({ esFile: null, enFile: '/tmp/en.mp3', outPath: '/tmp/out.mp3' });
  assert.equal(r.ok, true);
  assert.ok(r.args.includes('/tmp/en.mp3'));
});

test('buildVoiceConcatArgs: both voices — uses concat filter', () => {
  const r = buildVoiceConcatArgs({ esFile: '/tmp/es.mp3', enFile: '/tmp/en.mp3', outPath: '/tmp/out.mp3' });
  assert.equal(r.ok, true);
  assert.ok(r.args.includes('/tmp/es.mp3'));
  assert.ok(r.args.includes('/tmp/en.mp3'));
  assert.ok(r.args.some(a => typeof a === 'string' && a.includes('concat')),
    'should use FFmpeg concat filter for two voices');
  // Silence gap should be present
  assert.ok(r.args.some(a => typeof a === 'string' && a.includes('aevalsrc=0')),
    'should include silence between ES and EN');
});

// ── buildVoiceoverMixArgs ───────────────────────────────────────────────────

test('buildVoiceoverMixArgs: rejects non-m4a bedPath', () => {
  const r = buildVoiceoverMixArgs({ bedPath: '/tmp/b.mp3', voicePath: '/tmp/v.mp3', outPath: '/tmp/o.m4a' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bedPath_must_be_m4a');
});

test('buildVoiceoverMixArgs: rejects missing voicePath', () => {
  const r = buildVoiceoverMixArgs({ bedPath: '/tmp/b.m4a', voicePath: null, outPath: '/tmp/o.m4a' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'voicePath_required');
});

test('buildVoiceoverMixArgs: rejects non-m4a outPath', () => {
  const r = buildVoiceoverMixArgs({ bedPath: '/tmp/b.m4a', voicePath: '/tmp/v.mp3', outPath: '/tmp/o.mp3' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'outPath_must_be_m4a');
});

test('buildVoiceoverMixArgs: returns valid FFmpeg args', () => {
  const r = buildVoiceoverMixArgs({ bedPath: '/tmp/b.m4a', voicePath: '/tmp/v.mp3', outPath: '/tmp/o.m4a' });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.args));
  assert.ok(r.args.includes('/tmp/b.m4a'));
  assert.ok(r.args.includes('/tmp/v.mp3'));
  assert.ok(r.args.includes('/tmp/o.m4a'));
  assert.ok(r.args.some(a => typeof a === 'string' && a.includes('amix')),
    'should mix the two audio streams');
  assert.ok(r.args.some(a => typeof a === 'string' && a.includes('adelay')),
    'should delay voice to leave room for sting');
});

test('buildVoiceoverMixArgs: custom sting delay encoded in adelay filter', () => {
  const r = buildVoiceoverMixArgs({
    bedPath: '/tmp/b.m4a', voicePath: '/tmp/v.mp3', outPath: '/tmp/o.m4a',
    stingDelaySec: 2,
  });
  assert.equal(r.ok, true);
  assert.ok(r.args.some(a => typeof a === 'string' && a.includes('adelay=2000')),
    'adelay should be 2000ms for stingDelaySec=2');
});

test('buildVoiceoverMixArgs: bed ducked to 0.25', () => {
  const r = buildVoiceoverMixArgs({ bedPath: '/tmp/b.m4a', voicePath: '/tmp/v.mp3', outPath: '/tmp/o.m4a' });
  assert.equal(r.ok, true);
  assert.ok(r.args.some(a => typeof a === 'string' && a.includes('volume=0.25')),
    'bed should be ducked to 0.25 while voice plays');
});

// ── generateBilingualTTS with mocked exec ───────────────────────────────────

test('generateBilingualTTS: returns null when both texts empty', async () => {
  const tmpDir = join(tmpdir(), `tts-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const neverCalled = () => { throw new Error('exec should not be called'); };
  const r = await generateBilingualTTS(
    { headline_es: '', summary_es: '', headline_en: '', summary_en: '', tmpDir },
    { exec: neverCalled },
  );
  assert.equal(r, null);
});

test('generateBilingualTTS: returns null when exec always throws', async () => {
  const tmpDir = join(tmpdir(), `tts-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const alwaysFail = () => { throw new Error('no TTS available'); };
  const r = await generateBilingualTTS(
    { headline_es: 'Titular ES', summary_es: 'Resumen', headline_en: 'Headline EN', summary_en: 'Summary', tmpDir },
    { exec: alwaysFail },
  );
  assert.equal(r, null, 'should return null when all engines fail');
});

test('generateBilingualTTS: returns paths when exec writes output files', async () => {
  const tmpDir = join(tmpdir(), `tts-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  // Mock exec: writes a 1-byte placeholder for any .mp3 output argument
  const fakeExec = (_cmd, args) => {
    const out = args.find(a => typeof a === 'string' && a.endsWith('.mp3'));
    if (out) writeFileSync(out, 'x'); // non-empty placeholder
  };
  const r = await generateBilingualTTS(
    { headline_es: 'Titular', summary_es: '', headline_en: 'Headline', summary_en: '', tmpDir },
    { exec: fakeExec },
  );
  assert.ok(r !== null, 'should return result when exec produces files');
  assert.ok(r.esFile !== null || r.enFile !== null, 'at least one voice file expected');
});

test('ES_VOICE_EDGE and EN_VOICE_EDGE are non-empty strings', () => {
  assert.equal(typeof ES_VOICE_EDGE, 'string');
  assert.ok(ES_VOICE_EDGE.length > 0);
  assert.equal(typeof EN_VOICE_EDGE, 'string');
  assert.ok(EN_VOICE_EDGE.length > 0);
});
