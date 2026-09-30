import {planReservation} from '../../../scripts/reservation-broker-policy.mjs';

const mediaId = value => typeof value === 'string' && /^[0-9]+$/.test(value);
const unresolved = new Set(['publishing','publish_unknown']);

function safeResult(action, extra = {}) {
  return {action, external_send_authorized:false, ...extra};
}

function ownedReservation(record, attemptId) {
  return record?.status === 'publishing' && record.publish_attempt_id === attemptId && record.provider === 'metricool';
}

async function quarantine(adapter, record, attemptId, reason, providerResult = null) {
  try {
    await adapter.markUnknown({record, attemptId, reason, providerResult});
  } catch {
    // The durable reservation survives. Recovery must reconcile it, never resend.
  }
  return safeResult('reconcile_only',{reason});
}

export async function runPublicationCycle({request, identity, current, adapter}) {
  if (!adapter || typeof adapter !== 'object') return safeResult('blocked',{gate:'adapter'});
  if (unresolved.has(current?.status)) {
    try {
      await adapter.reconcile?.({record:current});
      return safeResult('reconcile_only',{reason:'unresolved_attempt'});
    } catch {
      return safeResult('reconcile_only',{reason:'reconciliation_unconfirmed'});
    }
  }

  const plan = planReservation({request, identity, current});
  if (plan.action !== 'conditional_reservation') return safeResult('blocked',{gate:plan.gate});

  let reserved;
  try {
    reserved = await adapter.reserve?.(plan);
  } catch {
    return safeResult('reservation_unconfirmed');
  }
  if (reserved?.kind === 'conflict') return safeResult('reservation_conflict');
  if (reserved?.kind !== 'reserved' || !ownedReservation(reserved.record, request.attempt_id)) {
    return safeResult('reservation_unconfirmed');
  }

  // Persist a durable pre-send receipt before crossing the provider boundary.
  // If this write is not confirmed, Metricool MUST NOT be invoked.
  let owned = reserved.record;
  try {
    const preSend = await adapter.persistPreSend?.({record:owned, attemptId:request.attempt_id});
    if (preSend?.kind !== 'pre_send_persisted' || !ownedReservation(preSend.record, request.attempt_id)) {
      return safeResult('reconcile_only',{reason:'pre_send_receipt_unconfirmed'});
    }
    owned = preSend.record;
  } catch {
    return safeResult('reconcile_only',{reason:'pre_send_receipt_unconfirmed'});
  }

  // The only social boundary. Nothing after this point authorizes a second call.
  let send;
  try {
    send = await adapter.send?.({record:owned, attemptId:request.attempt_id});
  } catch {
    return quarantine(adapter, owned, request.attempt_id, 'send_exception');
  }
  if (send?.kind === 'not_invoked' && send.proof === 'transport_not_called') {
    try {
      const released = await adapter.returnReady?.({record:owned, attemptId:request.attempt_id, reason:'action_not_invoked'});
      return released?.kind === 'returned_ready' ? safeResult('returned_ready') : safeResult('reconcile_only',{reason:'release_unconfirmed'});
    } catch {
      return safeResult('reconcile_only',{reason:'release_unconfirmed'});
    }
  }
  if (send?.kind !== 'published' || !mediaId(send.instagram_media_id)) {
    return quarantine(adapter, owned, request.attempt_id, 'send_ambiguous', send);
  }
  try {
    const archived = await adapter.archive?.({record:owned, attemptId:request.attempt_id,
      instagram_media_id:send.instagram_media_id, instagram_permalink:send.instagram_permalink || null});
    if (archived?.kind === 'archived') return safeResult('published',{instagram_media_id:send.instagram_media_id});
  } catch {
    // The social write may have succeeded. Leave claim intact and reconcile only.
  }
  return safeResult('reconcile_only',{reason:'archive_unconfirmed_after_positive_send'});
}
