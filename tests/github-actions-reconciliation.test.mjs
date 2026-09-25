import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileInstagramMedia } from '../scripts/reconcile-instagram-media.mjs';

const input = { mediaId: '17901642846667497', accessToken: 'test-token-value-is-never-sent-to-a-real-provider', expectedUsername: 'matrix24global' };
test('github reconciliation confirms only exact expected Instagram identity', async () => {
  const result = await reconcileInstagramMedia({ ...input, fetchImpl: async () => new Response(JSON.stringify({ id: input.mediaId, permalink: 'https://www.instagram.com/p/example/', username: input.expectedUsername })) });
  assert.deepEqual(result, { status: 'confirmed', media_id: input.mediaId, permalink: 'https://www.instagram.com/p/example/', username: input.expectedUsername });
});
test('github reconciliation fails closed and does not expose the token', async () => {
  const result = await reconcileInstagramMedia({ ...input, fetchImpl: async () => new Response(JSON.stringify({ id: input.mediaId, username: 'other' })) });
  assert.deepEqual(result, { status: 'unknown', reason: 'identity_mismatch' });
  assert.equal(JSON.stringify(result).includes(input.accessToken), false);
});
