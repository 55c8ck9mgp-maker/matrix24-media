import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_MEDIA_PUBLIC_BASE, deterministicFilename, inspectAsset, isCompleteJpeg, jpegFrame, planReconciliation, reconcileMediaClaim
} from '../scripts/reconcile-media-claim.mjs';
import { classifyQueueWrite } from '../scripts/queue-transition-ownership.mjs';
import { auditProductionState } from '../scripts/audit-production-state.mjs';

const id = 'matrix24-fixture-stuck-story';
const claimId = 'req-stuck-1';
const startedAt = '2026-09-28T10:00:00Z';
const now = Date.parse('2026-09-28T12:00:00Z');
const processing = {
  content_id: id, status: 'processing_media', headline: 'h', caption: 'c', verified_source_urls: ['https://example.test/s'],
  media_claim: { id: claimId, started_at: startedAt },
  publish_attempt_history: [{ timestamp: '2026-09-28T09:00:00Z', stage: 'promotion', result: 'admitted' }]
};
// SOI, APP0 (len 4), SOF0 1350x1080 with 3 components, SOS stub, EOI.
const frame = (h, w, c) => [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, c, ...Array(9).fill(0)];
const makeJpeg = (h = 1350, w = 1080, c = 3) =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, ...frame(h, w, c), 0xff, 0xda, 0x00, 0x02, 1, 2, 3, 0xff, 0xd9]);
const jpeg = makeJpeg();
const assetUrl = `${DEFAULT_MEDIA_PUBLIC_BASE}/${deterministicFilename(id)}`;

function response(status, body, type) {
  return new Response(body, { status, headers: type ? { 'content-type': type } : {} });
}
const fetchReturning = make => async () => make();

function root(record = processing) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix24-reconcile-'));
  fs.mkdirSync(path.join(r, 'queue'));
  fs.writeFileSync(path.join(r, 'queue', `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return r;
}
const read = r => JSON.parse(fs.readFileSync(path.join(r, 'queue', `${id}.json`), 'utf8'));

test('valid deterministic JPEG is adopted without a render and passes ownership', async () => {
  const r = root();
  const result = await reconcileMediaClaim({ root: r, contentId: id, claimId, now, apply: true,
    fetchImpl: fetchReturning(() => response(200, jpeg, 'image/jpeg')) });
  assert.equal(result.action, 'adopted');
  const after = read(r);
  assert.equal(after.status, 'ready_to_publish');
  assert.equal(after.public_image_url, assetUrl);
  assert.equal(after.image_filename, deterministicFilename(id));
  assert.equal(after.media_claim, undefined);
  assert.deepEqual(after.image_spec, { format: 'JPEG', mode: 'RGB', width: 1080, height: 1350, size_bytes: jpeg.length, alpha: false });
  const last = after.publish_attempt_history.at(-1);
  assert.equal(last.stage, 'media_reconciliation');
  assert.equal(last.result, 'adopted_existing_media');
  assert.equal(last.claim_id, claimId);
  assert.deepEqual(classifyQueueWrite(processing, after).violations, []);
  // The fixture has no editorial provenance; only the media-state findings matter here.
  const media = auditProductionState({ root: r, now }).findings.filter(f => /^(ready_|processing_media)/.test(f.issue));
  assert.deepEqual(media, []);
});

test('conclusively missing JPEG releases the claim back to blocked_media', async () => {
  for (const make of [() => response(404, ''),
    () => response(400, JSON.stringify({ statusCode: '404', code: 'NoSuchKey' }), 'application/json')]) {
    const r = root();
    const result = await reconcileMediaClaim({ root: r, contentId: id, claimId, now, apply: true, fetchImpl: fetchReturning(make) });
    assert.equal(result.action, 'released');
    const after = read(r);
    assert.equal(after.status, 'blocked_media');
    assert.equal(after.media_claim, undefined);
    assert.equal(after.publish_attempt_history.at(-1).result, 'released_no_media');
    const ownership = classifyQueueWrite(processing, after);
    assert.equal(ownership.ok, true, ownership.violations.join(','));
    assert.equal(ownership.plane, 'media');
  }
});

test('discard is an owner decision that needs a reason and releases the claim', async () => {
  const r = root();
  await assert.rejects(reconcileMediaClaim({ root: r, contentId: id, claimId, now, mode: 'discard', apply: true }), { code: 'DISCARD_REASON_REQUIRED' });
  const result = await reconcileMediaClaim({ root: r, contentId: id, claimId, now, mode: 'discard', reason: 'story is stale', apply: true,
    fetchImpl: () => { throw new Error('discard must not read storage'); } });
  assert.equal(result.action, 'discarded');
  const after = read(r);
  assert.equal(after.status, 'discarded');
  assert.equal(after.media_claim, undefined);
  assert.equal(after.publish_attempt_history.at(-1).reason, 'story is stale');
  assert.equal(classifyQueueWrite(processing, after).ok, true);
});

test('ambiguous or invalid storage reads never change the record', async () => {
  const cases = [
    [() => response(500, 'boom', 'text/plain'), 'ASSET_STATE_AMBIGUOUS'],
    [() => response(403, '', 'text/plain'), 'ASSET_STATE_AMBIGUOUS'],
    [() => { throw new TypeError('network'); }, 'ASSET_STATE_AMBIGUOUS'],
    [() => response(400, '{"statusCode":"500"}', 'application/json'), 'ASSET_STATE_AMBIGUOUS'],
    [() => response(200, jpeg.slice(0, 5), 'image/jpeg'), 'ASSET_INVALID_REQUIRES_STORAGE_REVIEW'],
    [() => response(200, jpeg, 'text/html'), 'ASSET_INVALID_REQUIRES_STORAGE_REVIEW'],
    [() => response(200, makeJpeg(1080, 1080), 'image/jpeg'), 'ASSET_INVALID_REQUIRES_STORAGE_REVIEW'],
    [() => response(200, makeJpeg(1350, 1080, 1), 'image/jpeg'), 'ASSET_INVALID_REQUIRES_STORAGE_REVIEW']
  ];
  for (const [make, code] of cases) {
    const r = root();
    const before = fs.readFileSync(path.join(r, 'queue', `${id}.json`), 'utf8');
    await assert.rejects(reconcileMediaClaim({ root: r, contentId: id, claimId, now, apply: true, fetchImpl: fetchReturning(make) }), { code });
    assert.equal(fs.readFileSync(path.join(r, 'queue', `${id}.json`), 'utf8'), before);
  }
});

test('only the exact stale claim the owner named is reconciled', () => {
  const asset = { url: assetUrl, filename: deterministicFilename(id), prior: false };
  const assetInfo = { state: 'missing', http_status: 404 };
  const plan = overrides => planReconciliation(overrides.record || processing,
    { contentId: id, claimId, asset, assetInfo, now, ...overrides });
  assert.throws(() => plan({ claimId: 'req-other' }), { code: 'CLAIM_ID_MISMATCH' });
  assert.throws(() => plan({ now: Date.parse(startedAt) + 30 * 60000 }), { code: 'CLAIM_NOT_STALE' });
  assert.throws(() => plan({ record: { ...processing, status: 'blocked_media' } }), { code: 'NOT_PROCESSING_MEDIA' });
  assert.throws(() => plan({ record: { ...processing, media_claim: undefined } }), { code: 'MEDIA_CLAIM_MISSING' });
  assert.throws(() => plan({ record: { ...processing, publish_attempt_id: 'att-1' } }), { code: 'PUBLICATION_STATE_PRESENT' });
  assert.throws(() => plan({ mode: 'retry' }), { code: 'MODE_INVALID' });
  assert.throws(() => plan({ asset: { ...asset, prior: true } }), { code: 'EXISTING_MEDIA_MISSING' });
});

test('dry run reports the plan and writes nothing', async () => {
  const r = root();
  const before = fs.readFileSync(path.join(r, 'queue', `${id}.json`), 'utf8');
  const result = await reconcileMediaClaim({ root: r, contentId: id, claimId, now,
    fetchImpl: fetchReturning(() => response(404, '')) });
  assert.equal(result.applied, false);
  assert.equal(result.to_status, 'blocked_media');
  assert.equal(fs.readFileSync(path.join(r, 'queue', `${id}.json`), 'utf8'), before);
});

test('ownership rejects a claim release without a reconciliation record', () => {
  const bare = { ...processing, status: 'blocked_media' };
  delete bare.media_claim;
  const r = classifyQueueWrite(processing, bare);
  assert.equal(r.ok, false);
  assert.ok(r.violations.includes('media_claim_released_without_reconciliation_record'));
  const foreignClaim = { ...bare, publish_attempt_history: [...processing.publish_attempt_history,
    { timestamp: '2026-09-28T12:00:00Z', stage: 'media_reconciliation', result: 'released_no_media', claim_id: 'req-other' }] };
  assert.ok(classifyQueueWrite(processing, foreignClaim).violations.includes('media_claim_released_without_reconciliation_record'));
});

test('JPEG completeness needs both SOI and EOI markers and a 1080x1350 frame', async () => {
  assert.equal(isCompleteJpeg(jpeg), true);
  assert.deepEqual(jpegFrame(jpeg), { width: 1080, height: 1350, components: 3 });
  assert.equal(isCompleteJpeg(jpeg.slice(0, -1)), false);
  assert.equal((await inspectAsset(assetUrl, { fetchImpl: fetchReturning(() => response(200, jpeg, 'image/jpeg')) })).state, 'valid');
});
