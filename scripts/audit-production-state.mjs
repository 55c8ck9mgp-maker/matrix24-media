import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pendingOwner } from './queue-transition-ownership.mjs';

const SAFE_ID = /^matrix24-[a-z0-9-]+$/;
const STATES = new Set(['blocked_media','processing_media','ready_to_publish','publishing','publish_unknown','published','discarded']);
const ACTIVE_PRODUCTION = new Set(['blocked_media','processing_media','ready_to_publish','publishing','publish_unknown']);

// A media render takes well under a minute and the Worker cron runs every 15 minutes.
// A claim older than this is stuck and needs explicit reconciliation (claims never expire).
export const STALE_MEDIA_CLAIM_MS = 60 * 60 * 1000;

const validMediaId = value => typeof value === 'string' && /^[0-9]+(?:_[0-9]+)?$/.test(value);
const validPermalink = value => typeof value === 'string' && /^https:\/\/(?:www\.)?instagram\.com\/[^\s]+/i.test(value);
const validHttps = value => typeof value === 'string' && /^https:\/\//i.test(value);
const validSha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function jsonFiles(root, relativeDir) {
  const absolute = path.join(root, relativeDir);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute).filter(name => name.endsWith('.json')).sort().map(name => `${relativeDir}/${name}`);
}

function readJson(root, relativePath, findings) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
  } catch (error) {
    findings.push({ severity:'critical', path:relativePath, issue:'unreadable_json', detail:String(error?.message || error) });
    return null;
  }
}

function present(value) {
  return value != null && value !== '';
}

export function auditProductionState({ root = process.cwd(), now = Date.now() } = {}) {
  const findings = [];
  const warnings = [];
  const queueFiles = jsonFiles(root, 'queue');
  const verifiedFiles = jsonFiles(root, 'editorial/verified');
  const promotionFiles = jsonFiles(root, 'editorial/promotions');
  const queueById = new Map();
  const queueByPath = new Map();
  const verifiedById = new Map();

  for (const file of verifiedFiles) {
    const draft = readJson(root, file, findings);
    if (!draft) continue;
    const id = draft.content_id;
    if (!SAFE_ID.test(id || '')) findings.push({severity:'critical',path:file,issue:'invalid_verified_content_id'});
    if (file !== `editorial/verified/${id}.json`) findings.push({severity:'critical',path:file,issue:'verified_path_content_id_mismatch'});
    if (verifiedById.has(id)) findings.push({severity:'critical',path:file,issue:'duplicate_verified_content_id'});
    verifiedById.set(id, file);
  }

  for (const file of queueFiles) {
    const record = readJson(root, file, findings);
    if (!record) continue;
    const id = record.content_id;
    if (!SAFE_ID.test(id || '')) findings.push({severity:'critical',path:file,issue:'invalid_queue_content_id'});
    if (file !== `queue/${id}.json`) findings.push({severity:'critical',path:file,issue:'queue_path_content_id_mismatch'});
    if (queueById.has(id)) findings.push({severity:'critical',path:file,issue:'duplicate_queue_content_id',other_path:queueById.get(id).path});
    queueById.set(id,{path:file,record});
    queueByPath.set(file,record);

    if (!STATES.has(record.status)) {
      findings.push({severity:'critical',path:file,issue:'unknown_queue_status',status:record.status});
      continue;
    }

    const mediaIdPresent = present(record.instagram_media_id);
    const permalinkPresent = present(record.instagram_permalink);
    if (mediaIdPresent && !validMediaId(record.instagram_media_id)) findings.push({severity:'critical',path:file,issue:'invalid_instagram_media_id'});
    if (permalinkPresent && !validPermalink(record.instagram_permalink)) findings.push({severity:'critical',path:file,issue:'invalid_instagram_permalink'});

    const positivePublicationEvidence = validMediaId(record.instagram_media_id) || validPermalink(record.instagram_permalink);
    const publicationClaim = Boolean(record.publish_attempt_id || record.publishing_started_at);

    if (record.status === 'published') {
      if (!positivePublicationEvidence) findings.push({severity:'critical',path:file,issue:'published_without_positive_publication_evidence'});
      if (publicationClaim) findings.push({severity:'critical',path:file,issue:'published_retains_active_publication_claim'});
      if (record.media_claim) findings.push({severity:'high',path:file,issue:'published_retains_media_claim'});
    }

    if (record.status === 'discarded') {
      if (publicationClaim || record.media_claim) findings.push({severity:'critical',path:file,issue:'discarded_retains_active_claim'});
    }

    if (record.status === 'blocked_media') {
      if (record.media_claim) findings.push({severity:'critical',path:file,issue:'blocked_media_has_media_claim'});
      if (present(record.public_image_url)) findings.push({severity:'critical',path:file,issue:'blocked_media_has_public_asset'});
      if (publicationClaim || positivePublicationEvidence) findings.push({severity:'critical',path:file,issue:'blocked_media_has_publication_state'});
    }

    if (record.status === 'processing_media') {
      if (!record.media_claim?.id || !record.media_claim?.started_at) findings.push({severity:'critical',path:file,issue:'processing_media_missing_owned_claim'});
      const claimStartedAt = Date.parse(record.media_claim?.started_at || '');
      if (Number.isFinite(claimStartedAt) && now - claimStartedAt > STALE_MEDIA_CLAIM_MS) {
        findings.push({severity:'high',path:file,issue:'processing_media_claim_stale_requires_reconciliation',claim_id:record.media_claim.id,started_at:record.media_claim.started_at});
      }
      if (publicationClaim || positivePublicationEvidence) findings.push({severity:'critical',path:file,issue:'processing_media_has_publication_state'});
    }

    if (record.status === 'ready_to_publish') {
      const spec = record.image_spec || {};
      if (!validHttps(record.public_image_url)) findings.push({severity:'critical',path:file,issue:'ready_missing_https_public_image'});
      if (!(spec.format === 'JPEG' && spec.mode === 'RGB' && spec.width === 1080 && spec.height === 1350 && spec.alpha === false)) {
        findings.push({severity:'critical',path:file,issue:'ready_invalid_image_spec'});
      }
      if (record.media_claim) findings.push({severity:'critical',path:file,issue:'ready_retains_media_claim'});
      if (publicationClaim || positivePublicationEvidence) findings.push({severity:'critical',path:file,issue:'ready_has_publication_state'});
    }

    if (record.status === 'publishing') {
      if (!record.publish_attempt_id || !record.publishing_started_at) findings.push({severity:'critical',path:file,issue:'publishing_missing_owned_claim'});
      if (positivePublicationEvidence) findings.push({severity:'high',path:file,issue:'publishing_already_has_positive_evidence_requires_reconciliation'});
    }

    if (record.status === 'publish_unknown') {
      if (!record.publish_attempt_id || !record.publishing_started_at) findings.push({severity:'critical',path:file,issue:'publish_unknown_missing_owned_claim'});
    }
  }

  for (const file of promotionFiles) {
    const manifest = readJson(root, file, findings);
    if (!manifest) continue;
    const filenameId = path.basename(file, '.json');
    if (!SAFE_ID.test(filenameId)) findings.push({severity:'critical',path:file,issue:'invalid_promotion_filename'});
    const expectedDraft = `editorial/verified/${filenameId}.json`;

    if (manifest.draft_path !== expectedDraft) findings.push({severity:'critical',path:file,issue:'promotion_draft_path_filename_mismatch'});
    const draftAbsolute = path.join(root, expectedDraft);
    if (!fs.existsSync(draftAbsolute)) {
      findings.push({severity:'critical',path:file,issue:'promotion_references_missing_verified_draft'});
    } else if (validSha256(manifest.draft_sha256)) {
      const actual = sha256(fs.readFileSync(draftAbsolute));
      if (actual !== manifest.draft_sha256) findings.push({severity:'critical',path:file,issue:'promotion_draft_sha_mismatch'});
    } else {
      findings.push({severity:'critical',path:file,issue:'promotion_invalid_draft_sha'});
    }

    if (present(manifest.content_id)) {
      if (!SAFE_ID.test(manifest.content_id) || manifest.content_id !== filenameId) findings.push({severity:'critical',path:file,issue:'promotion_content_id_filename_mismatch'});
    } else if (manifest.approved === true) {
      if (queueById.has(filenameId)) {
        warnings.push({path:file,issue:'legacy_approved_manifest_without_content_id_is_inert_because_queue_exists'});
      } else {
        findings.push({severity:'critical',path:file,issue:'approved_legacy_manifest_without_content_id_and_without_admitted_queue'});
      }
    }

    if (manifest.approved === true && present(manifest.content_id) && queueById.has(manifest.content_id)) {
      const record = queueById.get(manifest.content_id).record;
      if (ACTIVE_PRODUCTION.has(record.status) && record.editorial_promotion?.manifest_path !== file) {
        findings.push({severity:'critical',path:queueById.get(manifest.content_id).path,issue:'active_queue_manifest_binding_mismatch'});
      }
    }
  }

  for (const [id,{path:queuePath,record}] of queueById.entries()) {
    if (!ACTIVE_PRODUCTION.has(record.status)) continue;
    const provenance = record.editorial_promotion;
    if (!provenance || provenance.manifest_path !== `editorial/promotions/${id}.json` ||
        provenance.draft_path !== `editorial/verified/${id}.json` || !validSha256(provenance.draft_sha256)) {
      findings.push({severity:'critical',path:queuePath,issue:'active_queue_missing_canonical_editorial_provenance'});
      continue;
    }
    const manifest = readJson(root, provenance.manifest_path, findings);
    if (!manifest || manifest.approved !== true || manifest.content_id !== id || manifest.draft_sha256 !== provenance.draft_sha256) {
      findings.push({severity:'critical',path:queuePath,issue:'active_queue_provenance_not_bound_to_current_approved_manifest'});
    }
  }

  // A stalled record names the one plane allowed to act on it. Every other
  // scheduler must leave it alone; see docs/SCHEDULERS.md.
  for (const {path:queuePath,record} of queueById.values()) {
    const pending = pendingOwner(record, { now });
    if (pending.stalled) warnings.push({path:queuePath,issue:'stalled_transition',status:pending.status,owner:pending.owner,age_minutes:pending.age_minutes,threshold_minutes:pending.threshold_minutes});
  }

  const counts = {};
  for (const {record} of queueById.values()) counts[record.status] = (counts[record.status] || 0) + 1;

  return {
    ok: findings.length === 0,
    counts,
    queue_records: queueById.size,
    verified_drafts: verifiedById.size,
    promotion_manifests: promotionFiles.length,
    findings,
    warnings
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = auditProductionState();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
