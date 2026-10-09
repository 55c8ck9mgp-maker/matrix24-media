import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The owner discard must decide on the newest main, not on the checkout snapshot,
// and must stay serialized with the lane pipeline (same concurrency group).
const yml = fs.readFileSync(new URL('../.github/workflows/claude-lane-discard.yml', import.meta.url), 'utf8');

test('discard syncs to latest origin/main before the Discard step', () => {
  const sync = yml.indexOf('git reset --hard origin/main');
  const discard = yml.indexOf('- name: Discard');
  assert.ok(sync > 0, 'sync step present');
  assert.ok(sync < discard, 'sync runs before Discard');
  assert.ok(yml.includes('git fetch --depth 50 origin main'), 'fetches origin main');
});

test('discard stays in the shared claude-lane concurrency group without cancel', () => {
  assert.match(yml, /group: claude-lane\s*\n\s*cancel-in-progress: false/);
});

test('discard remains a dry run unless apply is exactly true', () => {
  assert.ok(yml.includes('apply:'));
  assert.ok(yml.includes("default: false"));
  const script = fs.readFileSync(new URL('../scripts/claude-lane/run-discard.mjs', import.meta.url), 'utf8');
  assert.ok(script.includes("process.env.DISCARD_APPLY === 'true'"));
});
