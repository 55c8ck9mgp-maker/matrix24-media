// Wires the REAL engine.mjs to the REAL github-queue-adapter.mjs (not each
// module's own hand-rolled mock) against a fake GitHub fixture. This is the
// missing coverage that let a kind-name contract mismatch ship merged to
// main undetected: engine.mjs and github-queue-adapter.mjs were each fully
// covered in isolation, but never proven to interoperate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runPublicationCycle} from '../publisher-v2/staging/src/engine.mjs';
import {createGitHubQueueAdapter} from '../publisher-v2/staging/src/github-queue-adapter.mjs';

const sha = char => char.repeat(40);
const attempt = '11111111-1111-4111-8111-111111111111';
const record = (overrides = {}) => ({
  content_id: 'matrix24-fixture-story',
  queue_path: 'queue/matrix24-fixture-story.json',
  status: 'ready_to_publish',
  caption: 'fixture caption',
  publish_attempt_history: [],
  ...overrides
});
const b64 = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const response = (status, body = {}) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

// A minimal fake GitHub that tracks its own committed state across sequential
// PUTs, so a full reserve -> archive cycle sees the effect of its own writes,
// the same way the real Contents API would.
function fakeGithub(initialRecord) {
  let state = {...initialRecord, sha: sha('a')};
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({url, init});
    if (init.method === 'GET') {
      const {sha: currentSha, ...withoutSha} = state;
      return response(200, {encoding: 'base64', content: b64({...withoutSha, queue_path: initialRecord.queue_path}), sha: currentSha});
    }
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body);
      if (body.sha !== state.sha) return response(409, {message: 'sha mismatch'});
      const next = JSON.parse(atob(body.content));
      const nextSha = sha('b');
      state = {...next, sha: nextSha};
      return response(200, {content: {sha: nextSha}});
    }
    return response(500);
  };
  return {calls, fetchImpl, currentState: () => state};
}

function requestFor(current) {
  return {
    content_id: current.content_id,
    queue_path: current.queue_path,
    expected_sha: current.sha,
    attempt_id: attempt,
    requested_at: '2026-09-27T23:00:00Z'
  };
}

const identity = () => ({verified: true, subject: 'matrix24-auto-publisher', scopes: ['queue:reserve']});

test('real engine + real GitHub adapter: successful reservation must be recognized as reserved, not treated as unconfirmed', async () => {
  const initial = record();
  const github = fakeGithub(initial);
  const adapter = createGitHubQueueAdapter({repo: '55c8ck9mgp-maker/matrix24-media', getAccessToken: async () => 'x'.repeat(20), fetchImpl: github.fetchImpl});
  const current = {...initial, sha: sha('a')};

  const reservePlanAdapter = {
    ...adapter,
    async send() { return {kind: 'published', instagram_media_id: '18000000000000001'}; }
  };

  const result = await runPublicationCycle({request: requestFor(current), identity: identity(), current, adapter: reservePlanAdapter});

  // The GitHub write for the reservation genuinely happened (state moved to
  // 'publishing' in the fake remote); the engine must recognize that as a
  // successful reservation and proceed, not silently drop it as unconfirmed.
  assert.equal(result.action, 'reconcile_only');
  assert.equal(result.reason, 'positive_send_requires_reconciliation');

  const finalState = github.currentState();
  assert.equal(finalState.status, 'publishing');
  assert.equal(finalState.publish_attempt_id, attempt);
  assert.equal(finalState.instagram_media_id, '18000000000000001');
});

test('real engine + real GitHub adapter: a genuine SHA conflict is reported as a conflict, not silently unconfirmed', async () => {
  const initial = record();
  const github = fakeGithub(initial);
  const adapter = createGitHubQueueAdapter({repo: '55c8ck9mgp-maker/matrix24-media', getAccessToken: async () => 'x'.repeat(20), fetchImpl: github.fetchImpl});
  const current = {...initial, sha: sha('a')};
  const staleRequest = {...requestFor(current), expected_sha: sha('c')};

  const result = await runPublicationCycle({request: staleRequest, identity: identity(), current: {...current, sha: sha('c')}, adapter});

  assert.equal(result.action, 'reservation_conflict');
});


test('duplicate delivery of the same attempt authorizes exactly one provider send total', async () => {
  const initial = record();
  const github = fakeGithub(initial);
  const adapter = createGitHubQueueAdapter({
    repo: '55c8ck9mgp-maker/matrix24-media',
    getAccessToken: async () => 'x'.repeat(20),
    fetchImpl: github.fetchImpl
  });
  let sends = 0;
  const statefulAdapter = {
    ...adapter,
    async send() {
      sends += 1;
      return {kind: 'ambiguous'};
    }
  };

  const first = {...initial, sha: sha('a')};
  const firstResult = await runPublicationCycle({
    request: requestFor(first),
    identity: identity(),
    current: first,
    adapter: statefulAdapter
  });
  assert.equal(firstResult.action, 'reconcile_only');
  assert.equal(sends, 1);

  // Simulate duplicate delivery after the first invocation durably claimed
  // the record. The second delivery observes the same queue state rather than
  // a fresh fixture. It must route to reconciliation and never call send again.
  const remote = github.currentState();
  const secondCurrent = {...remote};
  const secondResult = await runPublicationCycle({
    request: {
      content_id: secondCurrent.content_id,
      queue_path: secondCurrent.queue_path,
      expected_sha: secondCurrent.sha,
      attempt_id: attempt,
      requested_at: '2026-09-27T23:01:00Z'
    },
    identity: identity(),
    current: secondCurrent,
    adapter: statefulAdapter
  });

  assert.equal(secondResult.action, 'reconcile_only');
  assert.equal(sends, 1);
  assert.equal(github.currentState().publish_attempt_id, attempt);
  assert.equal(github.currentState().status, 'publishing');
});
