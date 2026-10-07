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
  // Claude Lane (docs/CLAUDE_LANE.md, approved by Justen 2026-10-06): writes only
  // under claude-lane/ and only when vars.CLAUDE_LANE_ENABLED == 'true'.
  'claude-lane-pipeline.yml',
  // Facebook Page mirror (approved by Justen 2026-10-07): writes only the
  // `facebook` sub-object of claude-lane/ records, only when both switches are 'true'.
  'claude-lane-facebook.yml',
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

test('Claude Lane pipeline is gated by the owner switch and the lane-only store', () => {
  const wf = fs.readFileSync(path.join(dir, 'claude-lane-pipeline.yml'), 'utf8');
  assert.match(wf, /CLAUDE_LANE_ENABLED: \$\{\{ vars\.CLAUDE_LANE_ENABLED \}\}/);
  assert.match(wf, /node scripts\/claude-lane\/run-lane\.mjs/);
  assert.doesNotMatch(wf, /git push|git add|gh pr/);
  assert.doesNotMatch(wf, /secrets\.(IG_PUBLISH_TOKEN|IG_READ_TOKEN|METRICOOL)/);
});

test('Claude Lane Facebook mirror is gated by both owner switches and the lane-only store', () => {
  const wf = fs.readFileSync(path.join(dir, 'claude-lane-facebook.yml'), 'utf8');
  assert.match(wf, /CLAUDE_LANE_ENABLED: \$\{\{ vars\.CLAUDE_LANE_ENABLED \}\}/);
  assert.match(wf, /CLAUDE_LANE_FB_ENABLED: \$\{\{ vars\.CLAUDE_LANE_FB_ENABLED \}\}/);
  assert.match(wf, /if: github\.event_name != 'schedule' \|\| startsWith\(vars\.CLAUDE_LANE_FB_ENABLED, 'true'\)/);
  assert.match(wf, /node scripts\/claude-lane\/run-facebook\.mjs/);
  assert.doesNotMatch(wf, /git push|git add|gh pr/);
  assert.doesNotMatch(wf, /secrets\.(IG_PUBLISH_TOKEN|IG_READ_TOKEN|METRICOOL|IG_CLAUDE_ACCESS_TOKEN)/);
});
