import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateEditorialDraft } from './validate-editorial-intake.mjs';

const PROMOTION_PREFIX = 'editorial/promotions/';
const DRAFT_PREFIX = 'editorial/verified/';

function fail(message) {
  throw new Error(`editorial promotion rejected: ${message}`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fail(`${file} is not readable JSON`);
  }
}

function isSafeRelative(value, prefix) {
  return typeof value === 'string' && value.startsWith(prefix) && value.endsWith('.json') && !value.includes('..');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function buildEditorialPromotion({ promotion, draft, draftPath, draftSha, existingContentIds = [] }) {
  if (!promotion || typeof promotion !== 'object' || Array.isArray(promotion)) fail('manifest must contain an object');
  if (!isSafeRelative(promotion.draft_path, DRAFT_PREFIX)) fail('manifest.draft_path must reference editorial/verified/*.json');
  if (promotion.draft_path !== draftPath) fail('manifest.draft_path does not match supplied draft');
  if (typeof promotion.draft_sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(promotion.draft_sha256)) fail('manifest.draft_sha256 must be a SHA-256 digest');
  if (promotion.draft_sha256 !== draftSha) fail('draft content no longer matches the approved manifest');
  if (promotion.approved !== true) fail('manifest.approved must be true');
  if (typeof promotion.approved_at !== 'string' || Number.isNaN(Date.parse(promotion.approved_at))) fail('manifest.approved_at must be an ISO timestamp');
  if (typeof promotion.approval_note !== 'string' || !promotion.approval_note.trim()) fail('manifest.approval_note is required');
  if (typeof draft.content_id !== 'string' || !/^matrix24-[a-z0-9-]+$/.test(draft.content_id)) fail('draft.content_id must be a safe matrix24 identifier');

  validateEditorialDraft(draft, draftPath);
  if (!draft.candidate_status.includes('requires_editorial_promotion')) fail('draft must require explicit editorial promotion');
  if (draft.promotion_eligible !== false) fail('draft must remain non-promotable without its separate manifest');
  if (existingContentIds.includes(draft.content_id)) fail(`content_id already exists in queue: ${draft.content_id}`);

  return {
    // A queue PR must be reproducible from the reviewed manifest. Never use wall-clock time here.
    timestamp: promotion.approved_at,
    content_id: draft.content_id,
    status: 'blocked_media',
    headline: draft.headline,
    category: draft.category,
    editorial_category: draft.editorial_category,
    event_date: draft.event_date,
    verified_source_urls: draft.verified_source_urls,
    source_records: draft.source_records,
    claim_checks: draft.claim_checks,
    caption: draft.caption,
    hashtags: draft.hashtags || [],
    image_generation_prompt: draft.image_generation_prompt,
    verification_note: draft.verification_note,
    verification_status: draft.verification_status,
    editorial_promotion: {
      manifest_path: promotion.manifest_path || null,
      draft_path: draftPath,
      draft_sha256: draftSha,
      approved_at: promotion.approved_at,
      approval_note: promotion.approval_note
    }
  };
}

export function buildPromotionFromFiles({ root = process.cwd(), manifestPath, now, queuePaths = [] }) {
  if (!isSafeRelative(manifestPath, PROMOTION_PREFIX)) fail('only editorial/promotions/*.json manifests are accepted');
  const absoluteManifest = path.resolve(root, manifestPath);
  const promotion = readJson(absoluteManifest);
  const draftPath = promotion.draft_path;
  if (!isSafeRelative(draftPath, DRAFT_PREFIX)) fail('manifest.draft_path must reference editorial/verified/*.json');
  const absoluteDraft = path.resolve(root, draftPath);
  const draftBytes = fs.readFileSync(absoluteDraft);
  const draft = JSON.parse(draftBytes.toString('utf8'));
  const existingContentIds = queuePaths.map((queuePath) => readJson(path.resolve(root, queuePath)).content_id).filter(Boolean);
  const record = buildEditorialPromotion({
    promotion: { ...promotion, manifest_path: manifestPath },
    draft,
    draftPath,
    draftSha: sha256(draftBytes),
    now,
    existingContentIds
  });
  return { outputPath: `queue/${record.content_id}.json`, record };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [manifestPath] = process.argv.slice(2);
  if (!manifestPath) fail('usage: node scripts/build-editorial-promotion.mjs editorial/promotions/<manifest>.json');
  const queuePaths = fs.readdirSync('queue').filter((name) => name.endsWith('.json')).map((name) => `queue/${name}`);
  const { outputPath, record } = buildPromotionFromFiles({ manifestPath, queuePaths });
  console.log(JSON.stringify({ output_path: outputPath, record }, null, 2));
}
