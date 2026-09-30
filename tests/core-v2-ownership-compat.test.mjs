import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTORS, TRANSITION_ACTOR } from '../core-v2/actor-authority.mjs';
import { PLANES, TRANSITION_OWNERS } from '../scripts/queue-transition-ownership.mjs';

const CORE_ACTOR_TO_QUEUE_PLANE = Object.freeze({
  [ACTORS.PUBLISHER]: PLANES.PUBLICATION,
  [ACTORS.RECONCILER]: PLANES.RECOVERY,
  [ACTORS.HUMAN_RECOVERY]: PLANES.OWNER_MANUAL
});

const SHARED_PUBLICATION_TRANSITIONS = Object.freeze([
  'ready_to_publish->publishing',
  'publishing->published',
  'publishing->publish_unknown',
  'publish_unknown->published'
]);

test('Core v2 and durable queue agree on shared publication ownership', () => {
  for (const transition of SHARED_PUBLICATION_TRANSITIONS) {
    const actor = TRANSITION_ACTOR[transition];
    const expectedPlane = CORE_ACTOR_TO_QUEUE_PLANE[actor];
    assert.ok(actor, `Core v2 missing shared transition: ${transition}`);
    assert.ok(expectedPlane, `No queue-plane mapping for Core v2 actor: ${actor}`);
    assert.equal(TRANSITION_OWNERS[transition], expectedPlane, `ownership drift for ${transition}`);
  }
});
