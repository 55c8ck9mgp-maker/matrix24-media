import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { adoptDraft, produce } from '../scripts/claude-lane/run-lane.mjs';
import { validateLaneRecord } from '../scripts/claude-lane/lane-record.mjs';

const NOW = new Date('2026-10-06T16:00:00Z');
const draft = (id, patch = {}) => ({
  lane: 'claude', content_id: `claude-20261006-${id}`, status: 'draft', created_at: '2026-10-06T15:30:00Z',
  category: 'World', headline: 'English headline', headline_es: 'Titular en español',
  caption_es: 'Texto.', caption_en: 'Text.', source_urls: ['https://reuters.com/x', 'https://apnews.com/y'],
  source_names: ['Reuters', 'AP'], hashtags: ['#MATRIX24'], ...patch,
});
let hasPillow = true;
try { execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' }); } catch { hasPillow = false; }
const skip = !hasPillow && process.env.CLAUDE_LANE_REQUIRE_RENDER !== '1' && 'Pillow not installed';
const store = (records = []) => ({ async list() { return records.map(r => ({ record: r, sha: 's' })); }, async write() { throw new Error('dry-run must not write'); } });

test('adoption keeps content, resets every state field', () => {
  const r = adoptDraft(draft('a', { status: 'published', image_url: 'https://evil/x.jpg', publish_attempt_id: 'p', ig_media_id: '9', history: [{ x: 1 }], extra: 'drop' }), NOW);
  assert.equal(r.status, 'draft'); assert.equal(r.image_url, null); assert.equal(r.publish_attempt_id, null);
  assert.equal(r.ig_media_id, null); assert.equal(r.extra, undefined); assert.equal(r.history[0].event, 'adopted_from_drafts_branch');
  assert.deepEqual(validateLaneRecord(r), []);
});

test('dry-run adopts the oldest valid new draft and never writes', { skip }, async () => {
  const r = await produce(store(), NOW, [draft('bad', { caption_en: '' }), draft('good')]);
  assert.equal(r.outcome, 'would_create'); assert.equal(r.content_id, 'claude-20261006-good');
  assert.equal(r.rejected[0].id, 'claude-20261006-bad');
});

test('already adopted, stale or backlog drafts are not adopted', async () => {
  assert.equal((await produce(store([{ ...draft('a'), status: 'published' }]), NOW, [draft('a')])).outcome, 'no_new_valid_draft');
  const stale = await produce(store(), NOW, [draft('old', { created_at: '2026-10-04T10:00:00Z' })]);
  assert.equal(stale.rejected[0].errs[0], 'STALE_DRAFT');
  assert.equal((await produce(store([{ ...draft('q'), status: 'ready_to_publish', image_url: 'https://x/a.jpg' }]), NOW, [draft('b')])).outcome, 'backlog_present');
  assert.equal((await produce(store(), NOW, [])).outcome, 'no_drafts');
});
