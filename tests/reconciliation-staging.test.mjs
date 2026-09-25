import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../worker/reconciliation-staging/src/index.js';

const env = { MATRIX24_MODE: 'staging-reconciliation', IG_READ_TOKEN: 'test-token-value-is-never-sent-to-a-real-provider', IG_ACCOUNT_ID: '17841423605720355', IG_USERNAME: 'matrix24global' };
const request = path => new Request(`https://matrix24-reconciliation-staging.workers.dev${path}`);

test('health has no write or cron authority', async () => {
  const result = await handle(request('/health'), env);
  assert.deepEqual(await result.json(), { status: 'ok', mode: 'staging-reconciliation', publication_allowed: false, claims_writable: false, cron_enabled: false });
});

test('lookup confirms only exact configured account and never returns token', async () => {
  let calls = 0;
  const result = await handle(request('/lookup/17901642846667497'), env, async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: '17901642846667497', username: 'matrix24global', permalink: 'https://www.instagram.com/p/example/' }));
  });
  const body = await result.json();
  assert.equal(calls, 1); assert.equal(result.status, 200);
  assert.deepEqual(body, { status: 'confirmed', action: 'direct_lookup_verified', media_id: '17901642846667497', permalink: 'https://www.instagram.com/p/example/', verification_source: 'direct_lookup' });
  assert.equal(JSON.stringify(body).includes(env.IG_READ_TOKEN), false);
});

test('lookup is unavailable without staging secret and fails closed on username mismatch', async () => {
  const missing = await handle(request('/lookup/17901642846667497'), { ...env, IG_READ_TOKEN: '' });
  assert.equal(missing.status, 503);
  const mismatch = await handle(request('/lookup/17901642846667497'), env, async () => new Response(JSON.stringify({ id: '17901642846667497', username: 'wrong' })));
  assert.deepEqual(await mismatch.json(), { status: 'unknown', action: 'lookup_unverified', media_id: null, permalink: null, verification_source: null });
});
