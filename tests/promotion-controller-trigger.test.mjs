import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The legacy Promotion Controller was retired by the owner's cutover on
// 2026-10-03 (96e12c9). This file now runs only the read-only "Lite Editorial
// Research" job. These tests lock that boundary in place instead of asserting
// the retired triggers.
const workflow = fs.readFileSync('.github/workflows/editorial-queue-promotion.yml', 'utf8');

test('editorial workflow is the read-only Lite research job', () => {
  assert.match(workflow, /^name: MATRIX 24 Lite Editorial Research/m);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /pull-requests:\s*write/);
});

test('retired promotion path cannot create queue records, branches or PRs', () => {
  assert.doesNotMatch(workflow, /editorial\/promotions\/\*\.json/);
  assert.doesNotMatch(workflow, /gh pr (create|merge)|git push|--squash|--rebase/);
  assert.doesNotMatch(workflow, /queue\//);
});

test('research job stays serialized and bounded', () => {
  assert.match(workflow, /group: matrix24-lite-editorial/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /timeout-minutes: \d+/);
});
