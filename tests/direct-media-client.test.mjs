import test from 'node:test';
import assert from 'node:assert/strict';
import { getDirectMedia, bindDirectLookupToAccount } from '../worker/staging/reliability/direct-media-client.mjs';

const mediaId = '17901642846667497';
const token = 'test-token-value-is-never-sent-to-a-real-provider';

test('direct lookup makes exactly one bounded GET and returns no token', async () => {
  let request;
  const result = await getDirectMedia({ mediaId, accessToken: token, fetchImpl: async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ id: mediaId, permalink: 'https://www.instagram.com/p/example/', username: 'matrix24global' }));
  }});
  assert.equal(request.url, `https://graph.instagram.com/${mediaId}?fields=id,permalink,username`);
  assert.equal(request.init.method, 'GET'); assert.equal(request.init.redirect, 'error');
  assert.equal(result.kind, 'ig_media'); assert.equal(JSON.stringify(result).includes(token), false);
});

test('direct lookup fails closed for invalid IDs, auth failures, and mismatched responses', async () => {
  assert.deepEqual(await getDirectMedia({ mediaId: 'bad', accessToken: token }), { kind: 'invalid_request', reason: 'invalid_media_id' });
  assert.deepEqual(await getDirectMedia({ mediaId, accessToken: 'short' }), { kind: 'invalid_request', reason: 'missing_access_token' });
  assert.deepEqual(await getDirectMedia({ mediaId, accessToken: token, fetchImpl: async () => new Response('', { status: 401 }) }), { kind: 'lookup_unavailable', reason: 'authentication' });
  assert.deepEqual(await getDirectMedia({ mediaId, accessToken: token, fetchImpl: async () => new Response(JSON.stringify({ id: '17901642846667498' })) }), { kind: 'lookup_unavailable', reason: 'identity_mismatch' });
});

test('account binding requires the configured numeric account and exact username', () => {
  const lookup = { kind: 'ig_media', id: mediaId, username: 'matrix24global' };
  assert.deepEqual(bindDirectLookupToAccount(lookup, { accountId: '17841423605720355', expectedUsername: 'matrix24global' }), { ...lookup, owner_id: '17841423605720355' });
  assert.equal(bindDirectLookupToAccount(lookup, { accountId: 'wrong', expectedUsername: 'matrix24global' }).kind, 'lookup_unverified');
  assert.equal(bindDirectLookupToAccount(lookup, { accountId: '17841423605720355', expectedUsername: 'other' }).kind, 'lookup_unverified');
});
