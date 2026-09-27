import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync('.github/workflows/editorial-queue-promotion.yml','utf8');

test('Promotion Controller has event and periodic recovery triggers',()=>{
  assert.match(workflow,/push:\n\s+branches:\n\s+- main/);
  assert.match(workflow,/paths:\n\s+- 'editorial\/promotions\/\*\.json'/);
  assert.match(workflow,/schedule:\n\s+- cron: '\*\/15 \* \* \* \*'/);
  assert.match(workflow,/EVENT_NAME.*github\.event_name/);
  assert.match(workflow,/EVENT_NAME" = "schedule/);
});

test('scheduled recovery delegates candidate validation to a testable selector',()=>{
  assert.match(workflow,/node scripts\/select-promotion-work\.mjs > \.promotion-selection\.json/);
  assert.match(workflow,/has_work=false/);
  assert.match(workflow,/has_work=true/);
  assert.match(workflow,/quarantined invalid approved manifest/);
  assert.match(workflow,/group: editorial-queue-promotion/);
  assert.doesNotMatch(workflow,/gh pr merge|--merge|--squash|--rebase/);
});

test('no-work schedule path cannot fall through into branch or PR creation',()=>{
  const gates=workflow.match(/if: steps\.promotion\.outputs\.has_work == 'true'/g) || [];
  assert.equal(gates.length,2);
  assert.match(workflow,/no valid approved unadmitted manifest/);
});
