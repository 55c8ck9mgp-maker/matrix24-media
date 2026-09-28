// Single-owner policy for queue/<content_id>.json state transitions.
//
// Every writer (Cloudflare Media Worker, Auto Publisher, reconciliation, manual
// repair) commits to queue/ with the same GitHub identity, so a commit's author
// cannot tell us which plane made a write. This module attributes each write to
// exactly one plane from the diff itself and rejects any write that no single
// plane is allowed to make. It is pure: no GitHub, scheduler or provider access.

export const PLANES = Object.freeze({
  PROMOTION: 'promotion',
  MEDIA: 'media',
  PUBLICATION: 'publication',
  RECOVERY: 'recovery',
  OWNER_MANUAL: 'owner_manual'
});

const EDITORIAL_FIELDS = new Set([
  'content_id','timestamp','headline','category','editorial_category','event_date',
  'verified_source_urls','source_records','claim_checks','caption','hashtags',
  'image_generation_prompt','verification_note','verification_status','editorial_promotion',
  'source_verification_history','created_at',
  // Channel/schema scaffolding is an owner decision, not a scheduler's.
  'distribution_schema_version','facebook','threads'
]);
const MEDIA_FIELDS = new Set(['media_claim','public_image_url','image_filename','media_ready_at','image_spec']);
const CLAIM_FIELDS = new Set([
  'publish_attempt_id','publishing_started_at','provider','publication_provider','publication_provider_account',
  'metricool_scheduled_post_id','metricool_scheduled_post_uuid',
  'postiz_post_id','postiz_group'
]);
const EVIDENCE_FIELDS = new Set(['instagram_media_id','instagram_permalink','published_at']);
const SHARED_FIELDS = new Set(['status','publish_attempt_history']);
const HISTORY_CAP = 50; // Media Worker keeps the newest 50 history entries.

// Allowed status transitions and the one plane that owns each.
// Key: `${from}->${to}`; `null` means the record did not exist.
export const TRANSITION_OWNERS = Object.freeze({
  'null->blocked_media': PLANES.PROMOTION,
  'blocked_media->processing_media': PLANES.MEDIA,
  'processing_media->ready_to_publish': PLANES.MEDIA,
  'ready_to_publish->publishing': PLANES.PUBLICATION,
  'publishing->publishing': PLANES.PUBLICATION,
  'publishing->published': PLANES.PUBLICATION,
  'publishing->publish_unknown': PLANES.PUBLICATION,
  'publishing->ready_to_publish': PLANES.PUBLICATION,
  'publish_unknown->published': PLANES.RECOVERY,
  'publish_unknown->ready_to_publish': PLANES.RECOVERY,
  'published->published': PLANES.RECOVERY
});

// Fields each plane may change, besides the shared status + append-only history.
const PLANE_FIELDS = Object.freeze({
  [PLANES.PROMOTION]: null, // creates the record; every field is new
  [PLANES.MEDIA]: MEDIA_FIELDS,
  [PLANES.PUBLICATION]: new Set([...CLAIM_FIELDS, ...EVIDENCE_FIELDS, 'incident_history']),
  [PLANES.RECOVERY]: new Set([...CLAIM_FIELDS, ...EVIDENCE_FIELDS, 'incident_history']),
  [PLANES.OWNER_MANUAL]: null
});

const present = v => v != null && v !== '';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validMediaId = v => typeof v === 'string' && /^[0-9]+$/.test(v);
const validPermalink = v => typeof v === 'string' && /^https:\/\/(?:www\.)?instagram\.com\/[^\s]+/i.test(v);
const positiveEvidence = r => validMediaId(r?.instagram_media_id) || validPermalink(r?.instagram_permalink);

export function changedFields(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter(k => !same(before?.[k], after?.[k])).sort();
}

// History is append-only. The Media Worker may drop the oldest entries once the
// list reaches HISTORY_CAP; nothing else may rewrite or remove an entry.
export function historyAppendOnly(before = [], after = []) {
  const b = Array.isArray(before) ? before : [];
  const a = Array.isArray(after) ? after : [];
  for (let drop = 0; drop <= b.length; drop++) {
    if (drop > 0 && a.length !== HISTORY_CAP) break;
    const kept = b.slice(drop);
    if (kept.length <= a.length && kept.every((e, i) => same(e, a[i]))) {
      return { ok: true, appended: a.slice(kept.length) };
    }
  }
  return { ok: false, appended: [] };
}

function releaseProvesNoSend(before, after, appended) {
  // Returning a claimed record to ready_to_publish requires durable proof that the
  // provider write was never invoked for the released attempt.
  const attempt = before.publish_attempt_id;
  if (!attempt || present(after.publish_attempt_id) || present(after.publishing_started_at)) return false;
  if (present(before.metricool_scheduled_post_id) || present(before.metricool_scheduled_post_uuid)) return false;
  if (positiveEvidence(before) || positiveEvidence(after)) return false;
  return appended.some(e => e?.publish_attempt_id === attempt);
}

/**
 * Attribute one write (before -> after) to exactly one owning plane.
 * Returns { ok, plane, transition, violations[], warnings[] }.
 */
export function classifyQueueWrite(before, after) {
  const violations = [];
  const warnings = [];
  const from = before ? String(before.status ?? '') : null;
  const to = after ? String(after.status ?? '') : null;
  const transition = `${from}->${to}`;

  if (!after) {
    return { ok: false, plane: null, transition, violations: ['queue_record_deleted'], warnings };
  }
  if (before && before.content_id !== after.content_id) violations.push('content_id_changed');

  const history = historyAppendOnly(before?.publish_attempt_history, after.publish_attempt_history);
  if (before && !history.ok) violations.push('publish_attempt_history_rewritten');
  const appended = history.appended;
  const fields = before ? changedFields(before, after) : [];

  // Discarding is an explicit owner decision, never a scheduler's.
  if (to === 'discarded' && from !== 'discarded') {
    if (present(after.publish_attempt_id) || present(after.media_claim)) violations.push('discarded_retains_active_claim');
    warnings.push('owner_manual_discard');
    return { ok: violations.length === 0, plane: PLANES.OWNER_MANUAL, transition, violations, warnings };
  }

  // Editorial correction of a record nobody has claimed yet (reviewed PR only).
  const editorialOnly = before && from === to && fields.length > 0 &&
    fields.every(f => EDITORIAL_FIELDS.has(f) || f === 'publish_attempt_history');
  if (editorialOnly) {
    if (!['blocked_media', 'ready_to_publish'].includes(from)) violations.push('editorial_change_after_claim_or_terminal');
    if (fields.includes('content_id')) violations.push('content_id_changed');
    warnings.push('owner_manual_editorial_correction');
    return { ok: violations.length === 0, plane: PLANES.OWNER_MANUAL, transition, violations, warnings };
  }

  if (transition === 'processing_media->processing_media' && !same(before.media_claim, after.media_claim)) {
    // A second media run replaced a live claim: two schedulers raced for one record.
    violations.push('media_claim_owner_overwritten');
    return { ok: false, plane: PLANES.MEDIA, transition, violations, warnings };
  }

  const plane = TRANSITION_OWNERS[transition];
  if (!plane) {
    violations.push(`transition_not_owned:${transition}`);
    return { ok: false, plane: null, transition, violations, warnings };
  }
  if (!before && plane !== PLANES.PROMOTION) {
    // Only admission may create a record; unreachable with the current table.
    violations.push(`transition_not_owned:${transition}`);
    return { ok: false, plane: null, transition, violations, warnings };
  }

  if (plane === PLANES.PROMOTION) {
    if (present(after.media_claim) || present(after.public_image_url)) violations.push('admission_carries_media_state');
    if (present(after.publish_attempt_id) || positiveEvidence(after)) violations.push('admission_carries_publication_state');
    return { ok: violations.length === 0, plane, transition, violations, warnings };
  }

  const allowed = PLANE_FIELDS[plane];
  const foreign = fields.filter(f => !SHARED_FIELDS.has(f) && !allowed.has(f));
  for (const f of foreign) violations.push(`mixed_plane_write:${plane}:${f}`);

  switch (transition) {
    case 'blocked_media->processing_media':
      if (!after.media_claim?.id) violations.push('media_claim_missing');
      break;
    case 'processing_media->ready_to_publish':
      if (present(after.media_claim)) violations.push('media_claim_not_released');
      if (!/^https:\/\//.test(after.public_image_url || '')) violations.push('ready_without_public_image');
      break;
    case 'ready_to_publish->publishing':
      if (!present(after.publish_attempt_id) || !present(after.publishing_started_at)) violations.push('reservation_without_attempt');
      if (present(before.publish_attempt_id)) violations.push('reservation_over_existing_claim');
      if (positiveEvidence(before)) violations.push('reservation_over_publication_evidence');
      break;
    case 'publishing->publishing':
      if (before.publish_attempt_id !== after.publish_attempt_id) violations.push('claim_owner_overwritten');
      break;
    case 'publishing->published':
    case 'publish_unknown->published':
      if (!positiveEvidence(after)) violations.push('published_without_positive_evidence');
      if (present(after.publish_attempt_id) && after.publish_attempt_id !== before.publish_attempt_id) violations.push('claim_owner_overwritten');
      break;
    case 'publishing->publish_unknown':
      if (after.publish_attempt_id !== before.publish_attempt_id) violations.push('claim_owner_overwritten');
      break;
    case 'publishing->ready_to_publish':
    case 'publish_unknown->ready_to_publish':
      if (!releaseProvesNoSend(before, after, appended)) violations.push('claim_released_without_not_invoked_proof');
      break;
    case 'published->published':
      // Evidence enrichment only: add a missing permalink/media ID or drop leftover
      // claim fields. Never change evidence that already exists.
      for (const f of EVIDENCE_FIELDS) {
        if (present(before[f]) && !same(before[f], after[f])) violations.push(`terminal_evidence_changed:${f}`);
      }
      for (const f of CLAIM_FIELDS) {
        if (present(after[f]) && !same(before[f], after[f])) violations.push(`terminal_claim_added:${f}`);
      }
      break;
  }

  return { ok: violations.length === 0, plane, transition, violations, warnings };
}

// Which plane owns the next step for a record, and whether it looks stalled.
// Only the owner may act on a stalled record; every other scheduler must leave it.
export const DEFAULT_STALL_MINUTES = Object.freeze({
  blocked_media: 45,      // three Cloudflare */15 cycles
  processing_media: 45,
  ready_to_publish: 180,  // Auto Publisher cadence is not fixed; INC-018 signature
  publishing: 60,
  publish_unknown: 60
});

const NEXT_OWNER = Object.freeze({
  blocked_media: PLANES.MEDIA,
  processing_media: PLANES.MEDIA,
  ready_to_publish: PLANES.PUBLICATION,
  publishing: PLANES.RECOVERY,
  publish_unknown: PLANES.RECOVERY
});

function lastActivity(record) {
  const stamps = [record.timestamp, record.media_ready_at, record.publishing_started_at, record.media_claim?.started_at,
    ...(Array.isArray(record.publish_attempt_history) ? record.publish_attempt_history.map(h => h?.timestamp) : [])]
    .map(t => Date.parse(t || '')).filter(Number.isFinite);
  return stamps.length ? Math.max(...stamps) : null;
}

export function pendingOwner(record, { now = Date.now(), stallMinutes = DEFAULT_STALL_MINUTES } = {}) {
  const status = record?.status;
  const owner = NEXT_OWNER[status];
  if (!owner) return { status, owner: null, stalled: false };
  const since = lastActivity(record);
  const ageMinutes = since == null ? null : Math.floor((now - since) / 60000);
  const stalled = ageMinutes == null || ageMinutes >= stallMinutes[status];
  return { status, owner, stalled, age_minutes: ageMinutes, threshold_minutes: stallMinutes[status] };
}
