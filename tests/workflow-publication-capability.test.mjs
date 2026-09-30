import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dir = '.github/workflows';
const files = fs.readdirSync(dir).filter(name => /\.ya?ml$/.test(name));
const allowedWriters = new Set([
  'editorial-queue-promotion.yml',
  'media-claim-reconciliation.yml',
  'queue-discovery-index.yml',
]);
const forbiddenPublicationSecrets = /secrets\.(?:IG_PUBLISH_TOKEN|METRICOOL_API_KEY|METRICOOL_ACCOUNT_ID)/;

for (const file of files) {
  test(`workflow capability boundary: ${file}`, () => {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const effectiveWrite = /^\s*contents:\s*write\s*$/m.test(source);
    if (effectiveWrite) assert.ok(allowedWriters.has(file), `UNAPPROVED_CONTENTS_WRITE:${file}`);
    assert.equal(forbiddenPublicationSecrets.test(source), false, `PUBLICATION_SECRET_IN_WORKFLOW:${file}`);
  });
}

test('legacy publication workflows remain read-only or unreachable', () => {
  const claude = fs.readFileSync(path.join(dir, 'claude-publisher.yml'), 'utf8');
  const reservation = fs.readFileSync(path.join(dir, 'publication-reservation.yml'), 'utf8');
  const recovery = fs.readFileSync(path.join(dir, 'metricool-recovery.yml'), 'utf8');
  assert.equal(/^\s*contents:\s*write\s*$/m.test(claude), false);
  assert.equal(/^\s*contents:\s*write\s*$/m.test(reservation), false);
  assert.equal(/^\s*contents:\s*write\s*$/m.test(recovery), false);
  assert.equal(/\bschedule\s*:/m.test(claude), false);
  assert.equal(/\bschedule\s*:/m.test(reservation), false);
  assert.equal(/\bschedule\s*:/m.test(recovery), false);
});
