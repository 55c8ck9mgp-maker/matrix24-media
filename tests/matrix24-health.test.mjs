import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMatrix24Health } from '../scripts/classify-matrix24-health.mjs';

test('HEALTHY when no blocker exists', () => {
  assert.equal(classifyMatrix24Health({queueRecords:[{status:'published',instagram_media_id:'1'}],provider:{instagram_content_publish:true}}).state,'HEALTHY');
});
test('BLOCKED_PROVIDER for unresolved instagram_content_publish denial', () => {
  const q={content_id:'matrix24-x',status:'ready_to_publish',publish_attempt_history:[{result:'action_not_invoked',reason:'instagram_content_publish_permission_missing_error_10_after_oauth_reauthorization'}]};
  const r=classifyMatrix24Health({queueRecords:[q],provider:{account_id:'17841423605720355'}});
  assert.deepEqual(r,{state:'BLOCKED_PROVIDER',reason:'instagram_content_publish',account_id:'17841423605720355'});
});
test('positive provider confirmation clears historical permission blocker', () => {
  const q={status:'ready_to_publish',publish_attempt_history:[{reason:'instagram_content_publish_permission_missing_error_10'}]};
  assert.equal(classifyMatrix24Health({queueRecords:[q],provider:{instagram_content_publish:true}}).state,'HEALTHY');
});
test('AMBIGUOUS takes precedence over provider blocker', () => {
  const q={content_id:'matrix24-x',status:'publish_unknown',publish_attempt_id:'a',publish_attempt_history:[{reason:'instagram_content_publish_permission_missing_error_10'}]};
  assert.equal(classifyMatrix24Health({queueRecords:[q],provider:{instagram_content_publish:false}}).state,'AMBIGUOUS');
});
test('ACTION_REQUIRED for impossible terminal/current claim combination', () => {
  const q={content_id:'matrix24-x',status:'published',instagram_media_id:'1',publish_attempt_id:'stale'};
  assert.equal(classifyMatrix24Health({queueRecords:[q],provider:{instagram_content_publish:true}}).state,'ACTION_REQUIRED');
});
test('ACTION_REQUIRED takes precedence over provider blocker', () => {
  const q={content_id:'matrix24-x',status:'ready_to_publish',publishing_started_at:'2026-09-26T00:00:00Z',publish_attempt_history:[{reason:'instagram_content_publish_permission_missing_error_10'}]};
  assert.equal(classifyMatrix24Health({queueRecords:[q],provider:{instagram_content_publish:false}}).state,'ACTION_REQUIRED');
});
test('ACTION_REQUIRED when publishing has no attempt id', () => {
  const q={content_id:'matrix24-x',status:'publishing',publishing_started_at:'2026-09-26T00:00:00Z'};
  assert.equal(classifyMatrix24Health({queueRecords:[q],provider:{instagram_content_publish:false}}).state,'ACTION_REQUIRED');
});
test('ACTION_REQUIRED when publishing has no started timestamp', () => {
  const q={content_id:'matrix24-x',status:'publishing',publish_attempt_id:'a'};
  assert.equal(classifyMatrix24Health({queueRecords:[q],provider:{instagram_content_publish:true}}).state,'ACTION_REQUIRED');
});
