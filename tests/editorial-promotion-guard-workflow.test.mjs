import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/editorial-promotion-guard.yml', 'utf8');

test('promotion guard keeps execution on trusted base and materializes candidate from head', () => {
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /ref: \$\{\{ env\.BASE_REF \}\}/);
  assert.match(workflow, /grep '\^queue\/\.\*\\\.json\$'/);
  assert.match(workflow, /git show "\$HEAD_REF:\$queue" > \/tmp\/promotion-candidate\.json/);
  assert.match(workflow, /git checkout --detach "\$BASE_REF"/);
  assert.doesNotMatch(workflow, /cp "\$queue" \/tmp\/promotion-candidate\.json/);
});
