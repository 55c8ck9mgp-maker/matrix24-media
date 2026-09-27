import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync('.github/workflows/editorial-queue-promotion.yml','utf8');

test('Promotion Controller has event and periodic recovery triggers',()=>{
  assert.match(workflow,/push:\n\s+branches:\n\s+- main/);
  assert.match(workflow,/paths:\n\s+- 'editorial\/promotions\/\*\.json'/);
  assert.match(workflow,/schedule:\n\s+- cron: '\*\/15 \* \* \* \*'/);
  assert.match(workflow,/EVENT_NAME.*github\.event_name/);
  assert.match(workflow,/EVENT_NAME\" = \"schedule/);
});

test('scheduled recovery is bounded and reuses deterministic admission',()=>{
  assert.match(workflow,/m\?\.approved===true/);
  assert.match(workflow,/!queues\.has\(m\.content_id\)/);
  assert.match(workflow,/process\.stdout\.write\(p\); break;/);
  assert.match(workflow,/node scripts\/prepare-editorial-queue-pr\.mjs/);
  assert.match(workflow,/group: editorial-queue-promotion/);
  assert.doesNotMatch(workflow,/gh pr merge|--merge|--squash|--rebase/);
});
