import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildEditorialPromotion, buildPromotionFromFiles } from '../scripts/build-editorial-promotion.mjs';
import { validateEditorialQueuePromotion } from '../scripts/validate-editorial-queue-promotion.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const draft = {
  content_id: 'matrix24-fixture-promotion', researched_at: '2026-09-25T00:00:00Z', event_date: '2026-09-24', headline: 'Fixture story', category: 'Technology', editorial_category: 'Technology', caption: 'Caption', hashtags: ['#MATRIX24'], image_generation_prompt: 'Prompt', verification_note: 'Two sources checked', verification_status: 'verified_two_independent_reports', candidate_status: 'verified_draft_requires_editorial_promotion', promotion_eligible: false,
  verified_source_urls: ['https://example.com/reuters', 'https://example.org/ap'],
  source_records: [{ source_name: 'Reuters', url: 'https://example.com/reuters', supports: ['Fact A'] }, { source_name: 'AP', url: 'https://example.org/ap', supports: ['Fact B'] }],
  claim_checks: [{ claim: 'Fact A', supporting_urls: ['https://example.com/reuters'] }]
};
const draftSha = crypto.createHash('sha256').update(JSON.stringify(draft)).digest('hex');
const promotion = { draft_path: 'editorial/verified/fixture.json', draft_sha256: draftSha, approved: true, approved_at: '2026-09-25T00:01:00Z', approval_note: 'Editorial review complete' };

test('builds a blocked_media record only from an approved exact draft revision', () => {
  const record = buildEditorialPromotion({ promotion, draft, draftPath: promotion.draft_path, draftSha });
  assert.equal(record.status, 'blocked_media');
  assert.equal(record.content_id, draft.content_id);
  assert.equal(record.editorial_promotion.draft_sha256, draftSha);
  assert.equal(record.timestamp, promotion.approved_at);
});

test('rejects a manifest whose draft digest no longer matches', () => {
  assert.throws(() => buildEditorialPromotion({ promotion: { ...promotion, draft_sha256: 'a'.repeat(64) }, draft, draftPath: promotion.draft_path, draftSha }), /no longer matches/);
});

test('rejects duplicate content before a queue record is created', () => {
  assert.throws(() => buildEditorialPromotion({ promotion, draft, draftPath: promotion.draft_path, draftSha, existingContentIds: [draft.content_id] }), /already exists in queue/);
});


test('accepts only the exact deterministic queue record bound to an approved base manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix24-promotion-'));
  try {
    fs.mkdirSync(path.join(root, 'editorial/verified'), { recursive: true });
    fs.mkdirSync(path.join(root, 'editorial/promotions'), { recursive: true });
    fs.mkdirSync(path.join(root, 'queue'), { recursive: true });
    const bytes = `${JSON.stringify(draft, null, 2)}\n`;
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const manifest = { ...promotion, draft_sha256: digest };
    fs.writeFileSync(path.join(root, 'editorial/verified/fixture.json'), bytes);
    fs.writeFileSync(path.join(root, 'editorial/promotions/fixture.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const built = buildPromotionFromFiles({ root, manifestPath: 'editorial/promotions/fixture.json', queuePaths: [] });
    const candidate = path.join(root, 'candidate.json');
    fs.writeFileSync(candidate, `${JSON.stringify(built.record, null, 2)}\n`);
    assert.doesNotThrow(() => validateEditorialQueuePromotion({ root, queuePath: built.outputPath, candidatePath: candidate }));
    fs.writeFileSync(candidate, JSON.stringify({ ...built.record, headline: 'Tampered headline' }));
    assert.throws(() => validateEditorialQueuePromotion({ root, queuePath: built.outputPath, candidatePath: candidate }), /not the exact deterministic output/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('repeated promotion remains duplicate-safe after first queue admission', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix24-repeat-promotion-'));
  try {
    fs.mkdirSync(path.join(root, 'editorial/verified'), { recursive: true });
    fs.mkdirSync(path.join(root, 'editorial/promotions'), { recursive: true });
    fs.mkdirSync(path.join(root, 'queue'), { recursive: true });
    const bytes = `${JSON.stringify(draft, null, 2)}\n`;
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const manifest = { ...promotion, draft_sha256: digest };
    fs.writeFileSync(path.join(root, 'editorial/verified/fixture.json'), bytes);
    fs.writeFileSync(path.join(root, 'editorial/promotions/fixture.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const first = buildPromotionFromFiles({ root, manifestPath: 'editorial/promotions/fixture.json', queuePaths: [] });
    fs.writeFileSync(path.join(root, first.outputPath), `${JSON.stringify(first.record, null, 2)}\n`);
    assert.throws(
      () => buildPromotionFromFiles({ root, manifestPath: 'editorial/promotions/fixture.json', queuePaths: [first.outputPath] }),
      /already exists in queue/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects an unapproved manifest before production admission', () => {
  assert.throws(
    () => buildEditorialPromotion({ promotion: { ...promotion, approved: false }, draft, draftPath: promotion.draft_path, draftSha }),
    /approved must be true/
  );
});
