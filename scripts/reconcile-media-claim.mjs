// Media Plane reconciler for a stuck processing_media claim (Worker >= v3.2.1
// never re-takes a claimed record). Owner-triggered only: never scheduled, never
// by age alone. It renders nothing and never deletes storage objects.
//
//   mode "auto":    the deterministic JPEG exists and is valid -> ready_to_publish
//                   (adopted, no second render); it is conclusively absent ->
//                   blocked_media with the claim released so the Worker renders it
//                   on a later cycle. Anything else (bad object, ambiguous read)
//                   is refused and the claim stays as is.
//   mode "discard": owner decision -> discarded, claim released, reason recorded.
//
// Every outcome appends a `media_reconciliation` entry to publish_attempt_history.
// Decision doc: docs/reliability/MEDIA_CLAIM_RETRY_DECISION.md
//
// Usage:
//   node scripts/reconcile-media-claim.mjs --content-id <id> --claim-id <id> \
//     [--mode auto|discard] [--reason <text>] [--apply]
// Without --apply it only prints the plan (dry run).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { STALE_MEDIA_CLAIM_MS } from './audit-production-state.mjs';
import { classifyQueueWrite } from './queue-transition-ownership.mjs';

// Public, unauthenticated read path of the production bucket (see queue/ records).
export const DEFAULT_MEDIA_PUBLIC_BASE = 'https://hrbzhfffhdepqepjrfcq.supabase.co/storage/v1/object/public/matrix24';
const MAX_JPEG_BYTES = 8 * 1024 * 1024; // same bound as the Worker
const HISTORY_CAP = 50;
const SAFE_ID = /^matrix24-[a-z0-9-]+$/;
const SAFE_CLAIM_ID = /^[A-Za-z0-9-]{1,80}$/;
const MODES = new Set(['auto', 'discard']);

export class ReconcileError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const present = value => value != null && value !== '';

export function deterministicFilename(contentId) {
  return `matrix24-${sha256(contentId)}-v1.jpg`;
}

// The object the Worker would reuse: an existing public_image_url, else the
// deterministic name. Mirrors processQueue in worker/releases/v3.2.1/worker.js.
export function expectedAsset(record, base = DEFAULT_MEDIA_PUBLIC_BASE) {
  const root = base.replace(/\/+$/, '');
  if (present(record.public_image_url)) {
    if (!record.public_image_url.startsWith(`${root}/`)) throw new ReconcileError('IMAGE_URL_NOT_ALLOWED', record.public_image_url);
    return { url: record.public_image_url, filename: record.image_filename || record.public_image_url.slice(root.length + 1), prior: true };
  }
  const filename = deterministicFilename(record.content_id);
  return { url: `${root}/${filename}`, filename, prior: false };
}

export function isCompleteJpeg(bytes) {
  const n = bytes?.length || 0;
  return n >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[n - 2] === 0xff && bytes[n - 1] === 0xd9;
}

// Frame header of a baseline/progressive JPEG: {width, height, components} or null.
export function jpegFrame(bytes) {
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null; // image data before any frame header
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    const sof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (sof) {
      if (i + 10 > bytes.length) return null;
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], components: bytes[i + 9] };
    }
    i += 2 + length;
  }
  return null;
}

// What the Worker writes and the publisher requires (scripts/publication-plane-policy.mjs).
const EXPECTED_FRAME = { width: 1080, height: 1350, components: 3 };

// Reads the whole object: a HEAD alone cannot tell a complete JPEG from a
// truncated or wrong object. Returns {state: 'valid'|'missing'|'invalid'|'ambiguous'}.
export async function inspectAsset(url, { fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20000) });
  } catch (error) {
    return { state: 'ambiguous', detail: `fetch_failed:${error?.name || 'error'}` };
  }
  const type = (response.headers.get('content-type') || '').toLowerCase();
  if (response.status === 404) return { state: 'missing', http_status: 404 };
  if (response.status === 400 && type.startsWith('application/json')) {
    // Supabase wraps NoSuchKey in HTTP 400.
    try {
      const error = JSON.parse(await response.text());
      if (String(error.statusCode) === '404' && error.code === 'NoSuchKey') return { state: 'missing', http_status: 400 };
    } catch { /* fall through */ }
    return { state: 'ambiguous', http_status: 400 };
  }
  if (response.status !== 200) {
    await response.body?.cancel?.();
    return { state: 'ambiguous', http_status: response.status };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!type.startsWith('image/jpeg')) return { state: 'invalid', http_status: 200, detail: `content_type:${type || 'none'}`, size_bytes: bytes.length };
  if (bytes.length > MAX_JPEG_BYTES) return { state: 'invalid', http_status: 200, detail: 'too_large', size_bytes: bytes.length };
  if (!isCompleteJpeg(bytes)) return { state: 'invalid', http_status: 200, detail: 'not_a_complete_jpeg', size_bytes: bytes.length };
  const frame = jpegFrame(bytes);
  if (!frame || frame.width !== EXPECTED_FRAME.width || frame.height !== EXPECTED_FRAME.height || frame.components !== EXPECTED_FRAME.components) {
    return { state: 'invalid', http_status: 200, detail: frame ? `frame:${frame.width}x${frame.height}x${frame.components}` : 'no_frame_header', size_bytes: bytes.length };
  }
  return { state: 'valid', http_status: 200, size_bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function appendHistory(record, entry) {
  const history = Array.isArray(record.publish_attempt_history) ? record.publish_attempt_history : [];
  return [...history, entry].slice(-HISTORY_CAP);
}

// Checks shared by every mode. Refuses anything but the exact stale claim the
// owner named, so a claim that changed since it was inspected is never touched.
export function checkClaim(record, { contentId, claimId, now }) {
  if (!SAFE_CLAIM_ID.test(claimId || '')) throw new ReconcileError('CLAIM_ID_INVALID');
  if (!record || typeof record !== 'object') throw new ReconcileError('RECORD_NOT_FOUND', contentId);
  if (record.content_id !== contentId) throw new ReconcileError('CONTENT_ID_MISMATCH', record.content_id);
  if (record.status !== 'processing_media') throw new ReconcileError('NOT_PROCESSING_MEDIA', record.status);
  if (!record.media_claim?.id || !record.media_claim?.started_at) throw new ReconcileError('MEDIA_CLAIM_MISSING');
  if (record.media_claim.id !== claimId) throw new ReconcileError('CLAIM_ID_MISMATCH', `record has ${record.media_claim.id}`);
  if (present(record.publish_attempt_id) || present(record.instagram_media_id) || present(record.instagram_permalink)) {
    throw new ReconcileError('PUBLICATION_STATE_PRESENT');
  }
  const startedAt = Date.parse(record.media_claim.started_at);
  if (!Number.isFinite(startedAt)) throw new ReconcileError('MEDIA_CLAIM_MISSING', 'unparseable started_at');
  // Not proof of failure (the owner decides that); it keeps us clear of a render
  // that may still be running. A still-running Worker loses its final SHA write anyway.
  if (now - startedAt < STALE_MEDIA_CLAIM_MS) throw new ReconcileError('CLAIM_NOT_STALE', `started_at ${record.media_claim.started_at}`);
}

// Pure: returns the next record and a summary, or throws ReconcileError.
export function planReconciliation(record, { contentId, claimId, mode = 'auto', reason = '', asset = null, assetInfo = null, now = Date.now() }) {
  if (!MODES.has(mode)) throw new ReconcileError('MODE_INVALID', mode);
  checkClaim(record, { contentId, claimId, now });
  const at = new Date(now).toISOString();
  const claim = record.media_claim;
  const next = structuredClone(record);
  delete next.media_claim;
  const base = { timestamp: at, stage: 'media_reconciliation', claim_id: claim.id, claim_started_at: claim.started_at };

  if (mode === 'discard') {
    const why = String(reason || '').trim();
    if (!why) throw new ReconcileError('DISCARD_REASON_REQUIRED');
    next.status = 'discarded';
    next.publish_attempt_history = appendHistory(record, { ...base, result: 'discarded_by_owner', reason: why.slice(0, 500) });
    return { action: 'discarded', record: next };
  }

  if (!asset || !assetInfo) throw new ReconcileError('ASSET_NOT_INSPECTED');
  if (assetInfo.state === 'valid') {
    next.status = 'ready_to_publish';
    next.public_image_url = asset.url;
    next.image_filename = asset.filename;
    next.media_ready_at = at;
    next.image_spec = { format: 'JPEG', mode: 'RGB', width: EXPECTED_FRAME.width, height: EXPECTED_FRAME.height, size_bytes: assetInfo.size_bytes, alpha: false };
    next.publish_attempt_history = appendHistory(record, {
      ...base, result: 'adopted_existing_media', image_filename: asset.filename, public_image_url: asset.url,
      size_bytes: assetInfo.size_bytes, image_sha256: assetInfo.sha256
    });
    return { action: 'adopted', record: next };
  }
  if (assetInfo.state === 'missing') {
    // An existing public_image_url that vanished is not a fresh render case.
    if (asset.prior) throw new ReconcileError('EXISTING_MEDIA_MISSING', asset.url);
    next.status = 'blocked_media';
    next.publish_attempt_history = appendHistory(record, {
      ...base, result: 'released_no_media', checked_url: asset.url, http_status: assetInfo.http_status
    });
    return { action: 'released', record: next };
  }
  if (assetInfo.state === 'invalid') {
    // The Worker uploads with x-upsert: false, so a re-render could never replace
    // this object. Someone has to inspect/remove it first, or discard the record.
    throw new ReconcileError('ASSET_INVALID_REQUIRES_STORAGE_REVIEW', `${asset.url} ${assetInfo.detail || ''}`.trim());
  }
  throw new ReconcileError('ASSET_STATE_AMBIGUOUS', `${asset.url} http ${assetInfo.http_status ?? 'none'} ${assetInfo.detail || ''}`.trim());
}

export function findQueueRecord(root, contentId) {
  if (!SAFE_ID.test(contentId || '')) throw new ReconcileError('CONTENT_ID_INVALID', contentId);
  const dir = path.join(root, 'queue');
  const matches = [];
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    const record = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    if (record?.content_id === contentId) matches.push({ path: `queue/${name}`, record });
  }
  if (matches.length === 0) throw new ReconcileError('RECORD_NOT_FOUND', contentId);
  if (matches.length > 1) throw new ReconcileError('DUPLICATE_CONTENT_ID', matches.map(m => m.path).join(','));
  return matches[0];
}

export async function reconcileMediaClaim({
  root = process.cwd(), contentId, claimId, mode = 'auto', reason = '', apply = false,
  now = Date.now(), base = DEFAULT_MEDIA_PUBLIC_BASE, fetchImpl = fetch
}) {
  const { path: queuePath, record } = findQueueRecord(root, contentId);
  checkClaim(record, { contentId, claimId, now });
  let asset = null; let assetInfo = null;
  if (mode === 'auto') {
    asset = expectedAsset(record, base);
    assetInfo = await inspectAsset(asset.url, { fetchImpl });
  }
  const plan = planReconciliation(record, { contentId, claimId, mode, reason, asset, assetInfo, now });
  // Same single-owner policy CI enforces on queue/ writes; fail before writing.
  const ownership = classifyQueueWrite(record, plan.record);
  if (!ownership.ok) throw new ReconcileError('OWNERSHIP_VIOLATION', ownership.violations.join(','));
  if (apply) fs.writeFileSync(path.join(root, queuePath), `${JSON.stringify(plan.record, null, 2)}\n`);
  return {
    ok: true, applied: apply, action: plan.action, content_id: contentId, claim_id: claimId, queue_path: queuePath,
    from_status: record.status, to_status: plan.record.status, plane: ownership.plane,
    asset: asset ? { url: asset.url, ...assetInfo } : null
  };
}

function parseArgs(argv) {
  const out = { mode: 'auto', reason: '', apply: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (['--content-id', '--claim-id', '--mode', '--reason'].includes(arg)) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      out[key] = argv[++i] ?? '';
    } else throw new ReconcileError('USAGE', `unknown argument ${arg}`);
  }
  if (!out.contentId || !out.claimId) throw new ReconcileError('USAGE', '--content-id and --claim-id are required');
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await reconcileMediaClaim({ ...args, base: process.env.MATRIX24_MEDIA_PUBLIC_BASE || DEFAULT_MEDIA_PUBLIC_BASE });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, code: error.code || 'UNEXPECTED', error: String(error.message || error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
