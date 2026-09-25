import test from 'node:test';
import assert from 'node:assert/strict';

import { handle } from '../worker/reconciliation-staging/src/index.js';

test('OAuth callback is static and discards authorization query parameters', async () => {
  let providerCalls = 0;
  const response = await handle(
    new Request('https://matrix24-reconciliation-staging.example/auth/instagram/callback?code=secret&state=opaque'),
    {},
    async () => {
      providerCalls += 1;
      throw new Error('provider must not be called');
    }
  );

  assert.equal(response.status, 200);
  assert.equal(providerCalls, 0);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text();
  assert.match(body, /Authorization complete/);
  assert.doesNotMatch(body, /secret|opaque/);
});
