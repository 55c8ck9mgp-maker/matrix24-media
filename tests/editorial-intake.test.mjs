import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEditorialDraft } from '../scripts/validate-editorial-intake.mjs';

const sourceA = 'https://example.com/reuters';
const sourceB = 'https://example.org/ap';
const validDraft = {
  content_id: 'matrix24-test-story', researched_at: '2026-09-25T00:00:00Z', event_date: '2026-09-24', headline: 'Test story', category: 'Sports', editorial_category: 'Sports', caption: 'Caption', image_generation_prompt: 'Prompt', verification_note: 'Two sources checked', verification_status: 'verified_two_independent_reports', candidate_status: 'verified_draft_requires_editorial_promotion', promotion_eligible: false,
  verified_source_urls: [sourceA, sourceB],
  source_records: [
    { source_name: 'Reuters', url: sourceA, supports: ['Fact A'] },
    { source_name: 'AP', url: sourceB, supports: ['Fact B'] }
  ],
  claim_checks: [{ claim: 'Fact A', supporting_urls: [sourceA] }]
};

test('editorial intake accepts a two-source non-promotable draft', () => {
  assert.doesNotThrow(() => validateEditorialDraft(structuredClone(validDraft)));
});

test('editorial intake rejects implicit publication eligibility', () => {
  const draft = structuredClone(validDraft);
  draft.promotion_eligible = true;
  assert.throws(() => validateEditorialDraft(draft), /promotion_eligible must be false/);
});

test('editorial intake rejects claims unsupported by the verified source set', () => {
  const draft = structuredClone(validDraft);
  draft.claim_checks[0].supporting_urls = ['https://unverified.example.net/source'];
  assert.throws(() => validateEditorialDraft(draft), /outside verified_source_urls/);
});
