// Claude Lane queue record: schema and transition rules.
// Spec: docs/CLAUDE_LANE.md. Records live in claude-lane/queue/<content_id>.json
// and are never mixed with the Core v2 queue under queue/.

export const LANE = 'claude';
export const STATUSES = Object.freeze([
  'draft', 'ready_to_publish', 'publishing', 'published', 'publish_unknown', 'skipped_duplicate',
  // Terminal. Only the owner's recovery workflow sets it, from publish_unknown,
  // after a fresh feed read shows no matching post (docs/CLAUDE_LANE.md "Recovery").
  'discarded',
]);
export const CAPTION_MAX = 2200;
export const HASHTAGS_MAX = 30;
const ID_RE = /^claude-\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const isHttps = value => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};
const hostOf = value => new URL(value).hostname.replace(/^www\./, '').toLowerCase();
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;

export const AI_NOTE = 'Imagen ilustrativa generada con IA; no es una fotografía del hecho. / AI-generated illustration; not a photograph of the event.';

export function composeCaption(record) {
  const tags = (record.hashtags ?? []).join(' ');
  const sources = `Fuentes / Sources: ${(record.source_names ?? []).join(', ')}`;
  return [`🇪🇸 ${record.caption_es.trim()}`, `🇺🇸 ${record.caption_en.trim()}`, sources,
    record.ai_illustration ? AI_NOTE : '', tags].filter(nonEmpty).join('\n\n');
}

// Optional visual fields written by the drafts task (card v2). All are optional;
// invalid values are rejected so a bad draft never reaches the renderer.
function visualErrors(r) {
  const e = [];
  const str = (k, max) => { if (r[k] != null && (typeof r[k] !== 'string' || r[k].length > max)) e.push(`BAD_${k.toUpperCase()}`); };
  str('summary_es', 300); str('summary_en', 280); str('highlight_es', 60); str('highlight_en', 60);
  str('image_prompt', 700); str('visual_label', 30);
  if (r.ai_illustration != null && typeof r.ai_illustration !== 'boolean') e.push('BAD_AI_ILLUSTRATION');
  if (r.map != null) {
    const m = r.map;
    const okFocus = Array.isArray(m.focus) && m.focus.length <= 4 && m.focus.every(x => typeof x === 'string' && x.length <= 40);
    const mk = m.marker;
    const okMarker = mk == null || (Number.isFinite(mk.lat) && Math.abs(mk.lat) <= 90 && Number.isFinite(mk.lon)
      && Math.abs(mk.lon) <= 180 && (mk.label == null || (typeof mk.label === 'string' && mk.label.length <= 30)));
    const okLabels = m.labels == null || (typeof m.labels === 'object' && !Array.isArray(m.labels)
      && Object.keys(m.labels).length <= 8 && Object.values(m.labels).every(v => typeof v === 'string' && v.length <= 30));
    if (typeof m !== 'object' || !okFocus || !okMarker || !okLabels) e.push('BAD_MAP');
  }
  return e;
}

export const FB_STATUSES = Object.freeze(['publishing', 'published', 'publish_unknown', 'failed']);

// Optional `facebook` sub-object written only by scripts/claude-lane/facebook.mjs
// (Facebook Page mirror, approved by Justen 2026-10-07).
export function facebookErrors(record) {
  const fb = record?.facebook;
  if (fb == null) return [];
  const e = [];
  if (typeof fb !== 'object' || Array.isArray(fb)) return ['BAD_FACEBOOK'];
  if (record.status !== 'published') e.push('FACEBOOK_BEFORE_INSTAGRAM_PUBLISHED');
  if (!FB_STATUSES.includes(fb.status)) e.push('BAD_FACEBOOK_STATUS');
  if (!nonEmpty(fb.attempt_id)) e.push('MISSING_FACEBOOK_ATTEMPT_ID');
  if (fb.status === 'published' && !/^\d+(?:_\d+)?$/.test(String(fb.post_id ?? ''))) e.push('FACEBOOK_PUBLISHED_NEEDS_POST_ID');
  return e;
}

export function validateLaneRecord(record) {
  const errors = [];
  const need = (cond, code) => { if (!cond) errors.push(code); };
  if (!record || typeof record !== 'object' || Array.isArray(record)) return ['NOT_AN_OBJECT'];

  need(record.lane === LANE, 'LANE_MUST_BE_CLAUDE');
  need(typeof record.content_id === 'string' && ID_RE.test(record.content_id), 'BAD_CONTENT_ID');
  need(STATUSES.includes(record.status), 'BAD_STATUS');
  need(typeof record.created_at === 'string' && ISO_RE.test(record.created_at), 'BAD_CREATED_AT');
  need(nonEmpty(record.headline), 'MISSING_HEADLINE');
  need(nonEmpty(record.caption_es), 'MISSING_CAPTION_ES');
  need(nonEmpty(record.caption_en), 'MISSING_CAPTION_EN');

  const urls = Array.isArray(record.source_urls) ? record.source_urls : [];
  need(urls.length >= 2 && urls.every(isHttps), 'NEED_TWO_HTTPS_SOURCES');
  if (urls.length >= 2 && urls.every(isHttps)) {
    need(new Set(urls.map(hostOf)).size >= 2, 'SOURCES_NOT_INDEPENDENT');
  }
  need(Array.isArray(record.source_names) && record.source_names.length >= 2
    && record.source_names.every(nonEmpty), 'NEED_SOURCE_NAMES');

  // Optional breaking-news flag: absent, or exactly true.
  need(record.breaking === undefined || record.breaking === true, 'BAD_BREAKING_FLAG');

  const tags = record.hashtags ?? [];
  need(Array.isArray(tags) && tags.length <= HASHTAGS_MAX
    && tags.every(t => /^#[\p{L}\p{N}_]+$/u.test(t)), 'BAD_HASHTAGS');

  if (nonEmpty(record.caption_es) && nonEmpty(record.caption_en) && Array.isArray(record.source_names)) {
    need(composeCaption(record).length <= CAPTION_MAX, 'CAPTION_TOO_LONG');
  }

  const s = record.status;
  const afterReady = ['ready_to_publish', 'publishing', 'published', 'publish_unknown', 'discarded'].includes(s);
  if (afterReady) need(isHttps(record.image_url) && /\.jpe?g(\?|$)/i.test(record.image_url), 'NEED_HTTPS_JPEG');
  // Optional media format (absent = 'image', the existing behaviour).
  const fmt = record.media_format ?? 'image';
  need(['image', 'carousel', 'reel'].includes(fmt), 'BAD_MEDIA_FORMAT');
  if (fmt === 'carousel' && afterReady) {
    need(Array.isArray(record.carousel_urls) && record.carousel_urls.length >= 2 && record.carousel_urls.length <= 10
      && record.carousel_urls.every(u => isHttps(u) && /\.jpe?g(\?|$)/i.test(u)), 'BAD_CAROUSEL_URLS');
  }
  if (fmt === 'reel' && afterReady) {
    need(isHttps(record.video_url) && /\.mp4(\?|$)/i.test(record.video_url), 'NEED_HTTPS_MP4');
  }
  if (['publishing', 'published', 'publish_unknown', 'discarded'].includes(s)) {
    need(nonEmpty(record.publish_attempt_id), 'MISSING_PUBLISH_ATTEMPT_ID');
  } else {
    need(record.publish_attempt_id == null, 'UNEXPECTED_PUBLISH_ATTEMPT_ID');
  }
  if (s === 'published') need(/^\d+$/.test(String(record.ig_media_id ?? '')), 'PUBLISHED_NEEDS_MEDIA_ID');
  else need(record.ig_media_id == null, 'UNEXPECTED_MEDIA_ID');
  need(Array.isArray(record.history), 'MISSING_HISTORY');
  if (s === 'discarded') {
    need(Array.isArray(record.history) && record.history.some(h => isOwnerDiscard(h, record.publish_attempt_id)),
      'DISCARD_NEEDS_OWNER_RECORD');
  }
  errors.push(...visualErrors(record));
  errors.push(...facebookErrors(record));
  return errors;
}

// The owner's discard record: who decided, for which attempt, and the evidence
// (a complete feed read with zero matches).
export function isOwnerDiscard(entry, attemptId) {
  return Boolean(entry) && entry.event === 'owner_discard' && nonEmpty(attemptId)
    && entry.publish_attempt_id === attemptId && nonEmpty(entry.decided_by)
    && Number.isInteger(entry.feed_checked) && entry.feed_checked > 0 && entry.feed_matches === 0;
}

// Allowed lane transitions. There is deliberately no automatic way back to
// ready_to_publish from publishing/publish_unknown: that would be a blind retry.
const TRANSITIONS = {
  'null->draft': 'research',
  'draft->ready_to_publish': 'render',
  'draft->skipped_duplicate': 'dedupe',
  'ready_to_publish->skipped_duplicate': 'dedupe',
  'ready_to_publish->publishing': 'publisher',
  'publishing->published': 'publisher',
  'publishing->publish_unknown': 'publisher',
  'publish_unknown->published': 'reconciler',
  // Owner recovery only: the last history entry must be the owner's discard for
  // this same attempt, with a fresh feed read that found no match. Terminal: the
  // story is never re-queued, so this can never become a second publication.
  'publish_unknown->discarded': 'owner_discard',
  // Only when media_publish was provably never called (container failed or
  // never became ready): nothing can be public, so the claim is released.
  'publishing->ready_to_publish': 'publisher_not_invoked',
};

export function checkLaneTransition(prev, next) {
  const from = prev ? prev.status : 'null';
  const key = `${from}->${next.status}`;
  if (from === next.status) {
    if (prev.publish_attempt_id !== next.publish_attempt_id) return { ok: false, error: 'ATTEMPT_ID_CHANGED' };
    if (prev.ig_media_id && prev.ig_media_id !== next.ig_media_id) return { ok: false, error: 'MEDIA_ID_CHANGED' };
    return { ok: true, owner: 'noop' };
  }
  const owner = TRANSITIONS[key];
  if (!owner) return { ok: false, error: `TRANSITION_NOT_ALLOWED:${key}` };
  if (key === 'ready_to_publish->publishing' && prev.publish_attempt_id != null) {
    return { ok: false, error: 'ATTEMPT_ALREADY_USED' };
  }
  if (key === 'publishing->ready_to_publish') {
    const last = Array.isArray(next.history) ? next.history[next.history.length - 1] : null;
    if (!last || last.event !== 'not_invoked' || last.publish_attempt_id !== prev.publish_attempt_id) {
      return { ok: false, error: 'RELEASE_NEEDS_NOT_INVOKED_PROOF' };
    }
    return { ok: true, owner };
  }
  if (key === 'publish_unknown->discarded') {
    const last = Array.isArray(next.history) ? next.history[next.history.length - 1] : null;
    if (prev.publish_attempt_id !== next.publish_attempt_id) return { ok: false, error: 'ATTEMPT_ID_CHANGED' };
    if (next.ig_media_id != null) return { ok: false, error: 'UNEXPECTED_MEDIA_ID' };
    if (!isOwnerDiscard(last, prev.publish_attempt_id)) return { ok: false, error: 'DISCARD_NEEDS_OWNER_RECORD' };
    return { ok: true, owner };
  }
  if (from === 'publishing' && prev.publish_attempt_id !== next.publish_attempt_id) {
    return { ok: false, error: 'ATTEMPT_ID_CHANGED' };
  }
  return { ok: true, owner };
}
