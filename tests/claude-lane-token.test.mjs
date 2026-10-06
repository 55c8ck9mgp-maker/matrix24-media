import test from 'node:test';
import assert from 'node:assert/strict';
import { assess } from '../scripts/claude-lane/refresh-token.mjs';

test('same token with long life is a successful refresh', () => {
  assert.deepEqual(assess('abc', { access_token: 'abc', expires_in: 5184000 }), { outcome: 'refreshed', days: 60 });
});
test('changed token asks the owner to update the secret without revealing it', () => {
  const r = assess('abc', { access_token: 'xyz', expires_in: 5184000 });
  assert.equal(r.outcome, 'token_changed_update_secret');
  assert.equal(JSON.stringify(r).includes('xyz'), false);
});
test('short remaining life and API errors fail loudly', () => {
  assert.equal(assess('abc', { access_token: 'abc', expires_in: 86400 * 5 }).outcome, 'expiring_soon');
  assert.equal(assess('abc', { error: { message: 'Session has expired' } }).outcome, 'refresh_failed');
  assert.equal(assess('abc', null).outcome, 'refresh_failed');
});
