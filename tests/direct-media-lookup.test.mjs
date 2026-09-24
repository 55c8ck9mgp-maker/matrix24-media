import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDirectMediaLookup } from '../worker/staging/reliability/policy.mjs';

const record = { content_id: 'fixture-news', account_id: 'fixture-account',
  status: 'published', media_id: '17900000000000001' };

test('direct lookup accepts only exact owned Media ID', () => {
  const verified = assessDirectMediaLookup(record, { kind: 'ig_media', id: record.media_id,
    owner_id: record.account_id, permalink: 'https://www.instagram.com/p/example/' });
  assert.equal(verified.action, 'direct_lookup_verified');
  assert.equal(verified.publication, 'confirmed');
  assert.equal(verified.publishAllowed, false);
  assert.equal(verified.clearClaim, false);
  for (const lookup of [
    { kind: 'ig_media', id: record.media_id, owner_id: 'other' },
    { kind: 'ig_media', id: '17900000000000002', owner_id: record.account_id },
    { kind: 'container', id: record.media_id, owner_id: record.account_id },
  ]) assert.notEqual(assessDirectMediaLookup(record, lookup).action, 'direct_lookup_verified');
});
