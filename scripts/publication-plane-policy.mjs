const ACTIVE = new Set(['publishing','publish_unknown']);

export function selectPublicationWork(records=[]) {
  const unresolved = records.filter(r => ACTIVE.has(r?.status));
  if (unresolved.length) return { action:'reconcile', records:unresolved };
  const ready = records.filter(r => r?.status === 'ready_to_publish')
    .sort((a,b)=>String(a.timestamp||'').localeCompare(String(b.timestamp||'')));
  return ready.length ? { action:'preflight', record:ready[0] } : { action:'noop', reason:'no_actionable_publication_work' };
}

export function assessReadyToPublish(record, evidence={}) {
  if (!record || record.status !== 'ready_to_publish') return {action:'blocked',gate:'status'};
  if (record.publish_attempt_id || record.publishing_started_at) return {action:'blocked',gate:'existing_claim'};
  if (record.instagram_media_id || record.instagram_permalink || record.published_at ||
      record.metricool_scheduled_post_id || record.metricool_scheduled_post_uuid) {
    return {action:'blocked',gate:'positive_or_prior_publication_evidence'};
  }
  if (record.verification_status !== 'verified_claim_consensus' || !record.editorial_promotion?.manifest_path ||
      !record.editorial_promotion?.draft_path || !record.editorial_promotion?.draft_sha256) {
    return {action:'blocked',gate:'provenance'};
  }
  if (!/^https:\/\//.test(record.public_image_url||'') || record.image_spec?.format !== 'JPEG' ||
      record.image_spec?.mode !== 'RGB' || record.image_spec?.width !== 1080 ||
      record.image_spec?.height !== 1350 || record.image_spec?.alpha !== false) {
    return {action:'blocked',gate:'media'};
  }
  const text=[record.caption||'', ...(record.hashtags||[])].join(' ').trim();
  if (!text || text.length > 2200) return {action:'blocked',gate:'caption'};
  if (evidence.readComplete !== true) return {action:'blocked',gate:'provider_read_incomplete'};
  if (evidence.positiveDuplicate === true) return {action:'blocked',gate:'duplicate'};
  if (!evidence.currentSha) return {action:'blocked',gate:'current_sha'};
  return {action:'reserve',sha:evidence.currentSha};
}

export function buildReservation(record,{attemptId,now}) {
  if (!record || record.status !== 'ready_to_publish') throw new Error('NOT_READY');
  if (record.publish_attempt_id || record.publishing_started_at) throw new Error('ALREADY_RESERVED');
  if (!attemptId || !now) throw new Error('INVALID_RESERVATION');
  return {...record,status:'publishing',publish_attempt_id:attemptId,publishing_started_at:now,provider:'metricool',
    publish_attempt_history:[...(record.publish_attempt_history||[]),{timestamp:now,stage:'publication',result:'started',provider:'metricool',publish_attempt_id:attemptId}]};
}

export function authorizeMetricoolWrite(record,attemptId) {
  const owned=record?.status==='publishing' && record.publish_attempt_id===attemptId && record.provider==='metricool';
  const alreadySent=Boolean(record?.metricool_scheduled_post_id || record?.metricool_scheduled_post_uuid ||
    record?.instagram_media_id || record?.instagram_permalink || record?.published_at);
  return owned && !alreadySent ? {action:'send_once'} : {action:'reconcile_only'};
}

export function classifyMetricoolEvidence(record,evidence={}) {
  if (!record || !ACTIVE.has(record.status)) return {action:'blocked',gate:'status'};
  if (evidence.status==='PUBLISHED' && (evidence.publicUrl || evidence.instagramMediaId)) {
    return {action:'archive_published',permalink:evidence.publicUrl||null,instagram_media_id:evidence.instagramMediaId||null};
  }
  if (record.metricool_scheduled_post_id || record.metricool_scheduled_post_uuid) return {action:'reconcile_only'};
  if (evidence.possibleSend === true) return {action:'publish_unknown'};
  if (evidence.actionNotInvoked === true) return {action:'return_ready',reason:'action_not_invoked'};
  return {action:'reconcile_only'};
}
