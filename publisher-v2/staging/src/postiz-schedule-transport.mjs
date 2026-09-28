// Real HTTP transport for a Postiz "one provider call maximum" schedule
// step, mirroring publisher-v2/staging/src/metricool-schedule-transport.mjs
// exactly in structure and safety posture. This module makes the actual
// network call; every decision about what the result means is left to the
// pure classifiers in worker/staging/reliability/postiz-adapter.mjs. This
// module must never re-implement that judgment.
//
// IMPORTANT — unverified integration surface (see
// docs/reliability/POSTIZ_TRANSPORT_STAGING.md for the full gate list): the
// endpoint path, headers, and request/response body fields below were
// sourced from Postiz's own public API documentation, not from a live call
// against a running Postiz instance (self-hosted or otherwise — none exists
// for this project yet). They are not deployed anywhere by this change and
// must be validated against one real, non-production Postiz instance before
// any activation.
//
// A successful HTTP round trip here can only ever prove that Postiz
// *accepted a schedule request* — never that Instagram actually published
// anything. That is why every outcome below, success or failure, maps onto
// the engine's existing 'ambiguous' (reconcile_only) path rather than
// 'published': only a real Instagram media ID, obtained separately through
// account-bound reconciliation, is allowed to complete a publish (see
// docs/ARCHITECTURE.md and INC-018/INC-010).
import {
  preparePostizSubmission,
  classifyPostizScheduleResult,
  classifyPostizPreWriteFailure
} from '../../../worker/staging/reliability/postiz-adapter.mjs';

const DEFAULT_API_BASE = 'https://api.postiz.com/public/v1';
const SCHEDULE_PATH = '/posts';

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

export function createPostizScheduleTransport({
  integrationId,
  accountId,
  getApiKey,
  fetchImpl = fetch,
  cryptoImpl = crypto,
  apiBase = DEFAULT_API_BASE,
  nowIso = () => new Date().toISOString()
} = {}) {
  if (!validId(integrationId) || !validId(accountId)) throw fail('POSTIZ_TRANSPORT_CONFIG_INVALID');
  if (typeof getApiKey !== 'function' || typeof fetchImpl !== 'function') throw fail('POSTIZ_TRANSPORT_CONFIG_INVALID');

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

      const preflight = preparePostizSubmission(attempt);
      if (preflight.action !== 'persist_postiz_pre_send_receipt') {
        // Nothing was sent: the record wasn't a genuinely owned 'publishing'
        // attempt. This is a durable, pre-network proof of non-invocation.
        return {kind: 'not_invoked', proof: 'transport_not_called', reason: preflight.action};
      }

      const body = {
        type: 'schedule',
        date: nowIso(),
        posts: [{
          integration: {id: integrationId},
          value: [{
            content: buildCaptionText(record),
            image: validId(record?.public_image_url) ? [{id: record.public_image_url, path: record.public_image_url}] : []
          }],
          settings: {__type: 'instagram'}
        }]
      };

      const url = `${apiBase}${SCHEDULE_PATH}`;

      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'Authorization': await getApiKey()
          },
          body: JSON.stringify(body)
        });
      } catch {
        // The request may have reached Postiz before the network failure.
        // This is exactly the ambiguous-network-outcome case the staging
        // contract requires: no retry, no assumption of failure, quarantine
        // and let reconciliation resolve it later.
        const failure = classifyPostizPreWriteFailure(attempt, {});
        return {kind: 'ambiguous', reason: 'postiz_network_exception', classification: failure};
      }

      let result = {};
      if (response.ok) {
        try {
          result = await response.json();
        } catch {
          result = {};
        }
      }

      const classified = classifyPostizScheduleResult(attempt, result);
      // classified.publication is either 'pending_provider' (schedule
      // accepted — still not Instagram-side proof) or 'unknown' (ambiguous
      // outcome). Neither is ever mapped to 'published' here.
      return {
        kind: 'ambiguous',
        reason: classified.publication === 'pending_provider'
          ? 'postiz_schedule_pending_reconciliation'
          : 'postiz_schedule_outcome_ambiguous',
        classification: classified
      };
    }
  };
}
