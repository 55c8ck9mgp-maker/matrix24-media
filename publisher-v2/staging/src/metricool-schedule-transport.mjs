// Real HTTP transport for the "one Metricool call maximum" step described in
// docs/reliability/PUBLICATION_PLANE_V2_STAGING.md. This module makes the
// actual network call; every decision about what the result means is left to
// the already-reviewed, already-tested pure classifiers in
// worker/staging/reliability/metricool-adapter.mjs. This module must never
// re-implement that judgment.
//
// IMPORTANT — unverified integration surface (see
// docs/reliability/METRICOOL_TRANSPORT_STAGING.md for the full gate list):
// the endpoint path, headers, query parameters and request body fields below
// were sourced from Metricool's own public help-center documentation and a
// third-party open-source CLI that uses the same API, not from a live call
// against this project's account. They are not deployed anywhere by this
// change and must be validated against one real, non-production Metricool
// call before any activation.
//
// A successful HTTP round trip here can only ever prove that Metricool
// *accepted a schedule request* (an id/uuid receipt) — never that Instagram
// actually published anything. That is why every outcome below, success or
// failure, maps onto the engine's existing 'ambiguous' (reconcile_only) path
// rather than 'published': only a real Instagram media ID, obtained
// separately through account-bound reconciliation, is allowed to complete a
// publish (see docs/ARCHITECTURE.md and INC-018/INC-010).
import {
  prepareMetricoolSubmission,
  classifyMetricoolScheduleResult,
  classifyMetricoolPreWriteFailure
} from '../../../worker/staging/reliability/metricool-adapter.mjs';

const DEFAULT_API_BASE = 'https://app.metricool.com/api';
const SCHEDULE_PATH = '/v2/scheduler/posts';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validId(value) {
  return typeof value === 'string' && value.length > 0;
}

async function sha256Hex(cryptoImpl, value) {
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function buildCaptionText(record) {
  const caption = typeof record?.caption === 'string' ? record.caption : '';
  const hashtags = Array.isArray(record?.hashtags) ? record.hashtags.filter(tag => typeof tag === 'string') : [];
  return [caption, hashtags.join(' ')].filter(part => part.length > 0).join('\n\n');
}

export function createMetricoolScheduleTransport({
  userId,
  blogId,
  accountId,
  getApiToken,
  fetchImpl = fetch,
  cryptoImpl = crypto,
  apiBase = DEFAULT_API_BASE,
  nowIso = () => new Date().toISOString()
} = {}) {
  if (!validId(userId) || !validId(blogId) || !validId(accountId)) throw fail('METRICOOL_TRANSPORT_CONFIG_INVALID');
  if (typeof getApiToken !== 'function' || typeof fetchImpl !== 'function') throw fail('METRICOOL_TRANSPORT_CONFIG_INVALID');

  async function payloadHashFor(record) {
    const canonical = JSON.stringify({
      caption: record?.caption ?? null,
      hashtags: record?.hashtags ?? null,
      public_image_url: record?.public_image_url ?? null
    });
    return 'sha256:' + await sha256Hex(cryptoImpl, canonical);
  }

  return {
    // Contract expected by publisher-v2/staging/src/engine.mjs's
    // runPublicationCycle: return {kind:'not_invoked', proof:'transport_not_called', ...}
    // only when we can PROVE no HTTP call was made; return {kind:'ambiguous'}
    // for every other non-terminal outcome; never return {kind:'published'}
    // from this module (see header comment).
    async send({record, attemptId}) {
      const payload_hash = await payloadHashFor(record);
      const attempt = {
        status: record?.status,
        content_id: record?.content_id,
        attempt_id: attemptId,
        account_id: accountId,
        payload_hash
      };

      const preflight = prepareMetricoolSubmission(attempt);
      if (preflight.action !== 'persist_metricool_pre_send_receipt') {
        // Nothing was sent: the record wasn't a genuinely owned 'publishing'
        // attempt. This is a durable, pre-network proof of non-invocation.
        return {kind: 'not_invoked', proof: 'transport_not_called', reason: preflight.action};
      }

      const body = {
        text: buildCaptionText(record),
        publicationDate: {dateTime: nowIso().slice(0, 19), timezone: 'UTC'},
        providers: [{network: 'instagram'}],
        autoPublish: true,
        draft: false,
        media: validId(record?.public_image_url) ? [record.public_image_url] : []
      };

      const url = `${apiBase}${SCHEDULE_PATH}?userId=${encodeURIComponent(userId)}&blogId=${encodeURIComponent(blogId)}`;

      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Mc-Auth': await getApiToken()
          },
          body: JSON.stringify(body)
        });
      } catch {
        // The request may have reached Metricool before the network failure.
        // This is exactly the ambiguous-network-outcome case the staging
        // contract requires: no retry, no assumption of failure, quarantine
        // and let reconciliation resolve it later.
        const failure = classifyMetricoolPreWriteFailure(attempt, {});
        return {kind: 'ambiguous', reason: 'metricool_network_exception', classification: failure};
      }

      let result = {};
      if (response.ok) {
        try {
          result = await response.json();
        } catch {
          result = {};
        }
      }

      const classified = classifyMetricoolScheduleResult(attempt, result);
      // classified.publication is either 'pending_provider' (schedule
      // accepted — still not Instagram-side proof) or 'unknown' (ambiguous
      // outcome). Neither is ever mapped to 'published' here.
      return {
        kind: 'ambiguous',
        reason: classified.publication === 'pending_provider'
          ? 'metricool_schedule_pending_reconciliation'
          : 'metricool_schedule_outcome_ambiguous',
        classification: classified
      };
    }
  };
}
