// Staging policy only. It does not authenticate requests, access GitHub, write a
// queue record, schedule work, or invoke a publication provider.
const SHA = /^[0-9a-f]{40}$/;
const PATH = /^queue\/[a-z0-9][a-z0-9-]*\.json$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const FIELDS = new Set(['content_id','queue_path','expected_sha','attempt_id','requested_at']);

const blocked = gate => ({action:'reject', gate});

function exactFields(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === FIELDS.size && Object.keys(value).every(key => FIELDS.has(key));
}

function utc(value) {
  return typeof value === 'string' && TIME.test(value) && Number.isFinite(Date.parse(value));
}

export function validateReservationRequest(request) {
  if (!exactFields(request)) return blocked('request_shape');
  if (typeof request.content_id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,127}$/.test(request.content_id)) return blocked('content_id');
  if (typeof request.queue_path !== 'string' || !PATH.test(request.queue_path)) return blocked('queue_path');
  if (typeof request.expected_sha !== 'string' || !SHA.test(request.expected_sha)) return blocked('expected_sha');
  if (typeof request.attempt_id !== 'string' || !UUID.test(request.attempt_id)) return blocked('attempt_id');
  if (!utc(request.requested_at)) return blocked('requested_at');
  return {action:'validate'};
}

// `verified` must be set by a server-side authentication adapter after it
// verifies a short-lived credential. Caller-provided JSON cannot set this value.
export function authorizeReservationIdentity(identity) {
  if (!identity || identity.verified !== true) return blocked('identity_unverified');
  if (identity.subject !== 'matrix24-auto-publisher') return blocked('identity_subject');
  if (!Array.isArray(identity.scopes) || identity.scopes.length !== 1 || identity.scopes[0] !== 'queue:reserve') {
    return blocked('identity_scope');
  }
  return {action:'authorize'};
}

export function planReservation({request, identity, current}) {
  const requestResult = validateReservationRequest(request);
  if (requestResult.action !== 'validate') return requestResult;
  const identityResult = authorizeReservationIdentity(identity);
  if (identityResult.action !== 'authorize') return identityResult;
  if (!current || typeof current !== 'object') return blocked('current_record');
  if (current.queue_path !== request.queue_path || current.content_id !== request.content_id) return blocked('record_binding');
  if (current.sha !== request.expected_sha) return blocked('sha_conflict');
  if (current.status !== 'ready_to_publish') return blocked('status');
  if (current.publish_attempt_id || current.publishing_started_at || current.instagram_media_id ||
      current.instagram_permalink || current.published_at || current.metricool_scheduled_post_id ||
      current.metricool_scheduled_post_uuid) return blocked('existing_evidence');

  // This value is a proposed conditional replacement. A future transport must
  // re-read and compare this exact SHA atomically; this function grants no write.
  return {action:'conditional_reservation', expected_sha:request.expected_sha, replacement:{
    ...structuredClone(current), status:'publishing', publish_attempt_id:request.attempt_id,
    publishing_started_at:request.requested_at, provider:'metricool',
    publish_attempt_history:[...(current.publish_attempt_history || []), {
      timestamp:request.requested_at, stage:'publication', result:'reservation_started',
      provider:'metricool', publish_attempt_id:request.attempt_id, source:'reservation_broker'
    }]
  }};
}

export function authorizeBrokerCapability(capability) {
  // Defense-in-depth: the broker contract has exactly one capability.
  return capability === 'queue:reserve' ? {action:'allow'} : blocked('capability');
}
