import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { CONFIRM, CAPTION_CAROUSEL, CAPTION_REEL } from '../scripts/claude-lane/format-test.mjs';

test('the test is blocked unless the exact confirmation is given', () => {
  const r = spawnSync(process.execPath, ['scripts/claude-lane/format-test.mjs'], { env: { ...process.env, CONFIRM_INPUT: 'nope' }, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /confirmation_missing/);
});
test('captions are marked as tests and in both languages', () => {
  for (const c of [CAPTION_CAROUSEL, CAPTION_REEL]) {
    assert.match(c, /prueba/i);
    assert.match(c, /test/i);
  }
  assert.equal(CONFIRM, 'PUBLICAR_PRUEBA_FORMATOS');
});
