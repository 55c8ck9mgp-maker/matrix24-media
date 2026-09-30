import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const engine = fs.readFileSync('publisher-v2/staging/src/engine.mjs','utf8');
const adapter = fs.readFileSync('publisher-v2/staging/src/github-queue-adapter.mjs','utf8');

test('Publisher v2 cannot take Recovery or Human Recovery transitions', () => {
  for (const forbidden of ['adapter.archive', 'adapter.markUnknown', 'adapter.returnReady']) {
    assert.equal(engine.includes(forbidden), false, `PUBLISHER_OWNS_RECOVERY_ACTION:${forbidden}`);
  }
  for (const forbidden of ['async archive(', 'async markUnknown(', 'async returnReady(']) {
    assert.equal(adapter.includes(forbidden), false, `PUBLISHER_ADAPTER_EXPOSES_RECOVERY_ACTION:${forbidden}`);
  }
});
