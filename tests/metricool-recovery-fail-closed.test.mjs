import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('scripts/invoke-metricool-recovery.mjs', 'utf8');

test('deprecated Metricool recovery contains no external writer primitives', () => {
  for (const forbidden of [
    'api.metricool.com',
    'execSync',
    'METRICOOL_API_KEY',
    'METRICOOL_ACCOUNT_ID',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'https://api.github.com/repos/',
  ]) {
    assert.equal(source.includes(forbidden), false, `LEGACY_WRITER_PRIMITIVE_PRESENT:${forbidden}`);
  }
});
