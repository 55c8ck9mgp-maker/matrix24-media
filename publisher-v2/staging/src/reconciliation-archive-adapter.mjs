// Closes item 5 of docs/reliability/PUBLICATION_PLANE_V2_STAGING.md's
// "Required production adapter" list: "Reconciliation adapter that can
// archive a matching Instagram media ID but cannot initiate a replacement
// publication."
//
// This module writes nothing new: it composes two already-reviewed pieces
// exactly as they already exist —
//   - the read side (worker/staging/reliability/direct-media-client.mjs +
//     policy.mjs's assessDirectMediaLookup), which is not just staged: it is
//     the real logic already deployed as the matrix24-reconciliation-staging
//     Worker, verified directly from Cloudflare.
//   - the write side (publisher-v2/staging/src/github-queue-adapter.mjs's
//     archive()), fixed in PR #80 to report a genuine write as {kind:'archived'}.
//
// It takes a candidate Instagram media ID as an explicit input (the same
// manual shape as the existing instagram-reconciliation.yml workflow /
// scripts/reconcile-instagram-media.mjs) rather than inventing any
// auto-discovery of "recent posts that might match" — that kind of fuzzy
// matching is exactly what policy.mjs's assessPublication() already refuses
// to auto-adopt ("A candidate caption match needs manual/authoritative
// identity resolution. Never auto-adopt it.").
//
// This module has no cron, no credential, and is not wired into any
// GitHub Actions workflow. Doing so requires the same GitHub App identity
// gate already required for the reservation broker (see
// docs/reliability/RESERVATION_BROKER_STAGING.md) plus a read-capable
// Instagram token — neither exists yet.
import {getDirectMedia, bindDirectLookupToAccount} from '../../../worker/staging/reliability/direct-media-client.mjs';
import {assessDirectMediaLookup} from '../../../worker/staging/reliability/policy.mjs';

const UNRESOLVED_STATES = new Set(['publishing', 'publish_unknown']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function createReconciliationArchiveAdapter({
  accountId,
  expectedUsername,
  getAccessToken,
  fetchImpl = fetch,
  queueAdapter
} = {}) {
  if (typeof accountId !== 'string' || !/^[0-9]+$/.test(accountId)) throw fail('RECONCILIATION_ACCOUNT_ID_INVALID');
  if (typeof expectedUsername !== 'string' || expectedUsername.length === 0) throw fail('RECONCILIATION_USERNAME_INVALID');
  if (typeof getAccessToken !== 'function') throw fail('RECONCILIATION_TOKEN_PROVIDER_INVALID');
  if (!queueAdapter || typeof queueAdapter.archive !== 'function') throw fail('RECONCILIATION_QUEUE_ADAPTER_INVALID');

  return {
    // record: the queue record as currently read from GitHub (must include sha).
    // attemptId: the publish_attempt_id this record is claimed under.
    // candidateMediaId: an Instagram media ID a human (or the manual
    // reconciliation workflow) already suspects belongs to this attempt —
    // never discovered automatically here.
    async reconcile({record, attemptId, candidateMediaId}) {
      if (!record || record.publish_attempt_id !== attemptId) {
        return {kind: 'not_applicable', reason: 'attempt_not_owned'};
      }
      if (!UNRESOLVED_STATES.has(record.status)) {
        return {kind: 'not_applicable', reason: 'not_unresolved'};
      }
      if (typeof candidateMediaId !== 'string' || !/^[0-9]+$/.test(candidateMediaId)) {
        return {kind: 'not_applicable', reason: 'candidate_media_id_invalid'};
      }

      let lookup;
      try {
        lookup = await getDirectMedia({mediaId: candidateMediaId, accessToken: await getAccessToken(), fetchImpl});
      } catch {
        return {kind: 'unverified', reason: 'lookup_exception'};
      }
      if (lookup.kind !== 'ig_media') {
        return {kind: 'unverified', reason: lookup.reason || lookup.kind};
      }

      const bound = bindDirectLookupToAccount(lookup, {accountId, expectedUsername});
      const assessment = assessDirectMediaLookup({account_id: accountId, media_id: candidateMediaId}, bound);
      if (assessment.action !== 'direct_lookup_verified' || assessment.publication !== 'confirmed') {
        // Includes the identity-conflict case: a real Instagram post exists
        // at this ID, but it is not confirmed to be on our own account.
        // Never archive on an unverified or conflicting lookup.
        return {kind: 'unverified', reason: assessment.action};
      }

      // Only a durably confirmed, account-bound, exact media ID may complete
      // the record. archive() itself re-reads and re-checks ownership before
      // writing (github-queue-adapter.mjs's ownedCurrent()), so this call
      // still cannot archive a record that has since changed underneath us.
      return queueAdapter.archive({
        record,
        attemptId,
        instagram_media_id: assessment.media_id,
        instagram_permalink: assessment.permalink
      });
    }
  };
}
