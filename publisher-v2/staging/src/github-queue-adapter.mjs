const QUEUE_PATH = /^queue\/[a-z0-9][a-z0-9-]*\.json$/;
const SHA = /^[0-9a-f]{40}$/;
const ATTEMPT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code) { const error = new Error(code); error.code = code; return error; }
function validRepo(repo) { return typeof repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo); }
function encode(value) { return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n'))); }
function decode(content) {
  try { const binary = atob(content); return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, byte => byte.charCodeAt(0)))); }
  catch { throw fail('GITHUB_QUEUE_RECORD_INVALID'); }
}
function pathFor(record) { const path = record?.queue_path; if (typeof path !== 'string' || !QUEUE_PATH.test(path)) throw fail('GITHUB_QUEUE_PATH_INVALID'); return path; }
function shaFor(record) { if (typeof record?.sha !== 'string' || !SHA.test(record.sha)) throw fail('GITHUB_QUEUE_SHA_MISSING'); return record.sha; }
function append(record, entry) { return {...record, publish_attempt_history:[...(record.publish_attempt_history || []), entry]}; }
function transition(record, status, attemptId, result, extra = {}) {
  if (record.publish_attempt_id !== attemptId) throw fail('GITHUB_ATTEMPT_MISMATCH');
  return append({...record, ...extra, status}, {timestamp:new Date().toISOString(),stage:'publication',result,provider:'metricool',publish_attempt_id:attemptId,source:'publisher_v2'});
}
function sameSnapshot(current, supplied) {
  if (current.sha !== shaFor(supplied)) return false;
  const {sha: currentSha, ...currentRecord} = current;
  const {sha: suppliedSha, ...suppliedRecord} = supplied;
  return JSON.stringify(currentRecord) === JSON.stringify(suppliedRecord);
}

export function createGitHubQueueAdapter({repo, getAccessToken, fetchImpl = fetch, apiBase = 'https://api.github.com'} = {}) {
  if (!validRepo(repo) || typeof getAccessToken !== 'function' || typeof fetchImpl !== 'function') throw fail('GITHUB_ADAPTER_CONFIG_INVALID');
  async function token() { const value = await getAccessToken(); if (typeof value !== 'string' || value.length < 20) throw fail('GITHUB_APP_TOKEN_UNAVAILABLE'); return value; }
  async function request(path, init = {}) {
    const accessToken = await token();
    return fetchImpl(apiBase + path, {...init,headers:{accept:'application/vnd.github+json',authorization:'Bearer ' + accessToken,'x-github-api-version':'2022-11-28',...(init.headers || {})}});
  }
  async function read(path) {
    const response = await request('/repos/' + repo + '/contents/' + path + '?ref=main',{method:'GET',headers:{'cache-control':'no-store'}});
    if (response.status === 404) throw fail('GITHUB_QUEUE_RECORD_MISSING');
    if (!response.ok) throw fail('GITHUB_QUEUE_READ_UNCONFIRMED');
    const body = await response.json();
    if (body?.encoding !== 'base64' || typeof body.content !== 'string' || !SHA.test(body.sha)) throw fail('GITHUB_QUEUE_RESPONSE_INVALID');
    const record = decode(body.content);
    if (!record || typeof record !== 'object' || record.queue_path !== path) throw fail('GITHUB_QUEUE_RECORD_INVALID');
    return {...record,sha:body.sha};
  }
  async function write(path, sha, record, message) {
    const response = await request('/repos/' + repo + '/contents/' + path,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({message,content:encode(record),sha,branch:'main'})});
    if (response.status === 409 || response.status === 422) return {kind:'conflict'};
    if (!response.ok) throw fail('GITHUB_QUEUE_WRITE_UNCONFIRMED');
    const body = await response.json();
    if (!SHA.test(body?.content?.sha)) throw fail('GITHUB_QUEUE_RESPONSE_INVALID');
    return {kind:'written',record:{...record,sha:body.content.sha}};
  }
  async function ownedCurrent(record, attemptId) {
    const path = pathFor(record);
    const current = await read(path);
    if (!sameSnapshot(current, record) || current.publish_attempt_id !== attemptId || current.status !== 'publishing' || current.provider !== 'metricool') throw fail('GITHUB_STATE_CHANGED');
    return current;
  }
  return {
    async reserve(plan) {
      const proposed = plan?.replacement;
      if (!plan || plan.action !== 'conditional_reservation' || !SHA.test(plan.expected_sha) || !ATTEMPT.test(proposed?.publish_attempt_id) || typeof proposed?.publishing_started_at !== 'string') throw fail('GITHUB_RESERVATION_PLAN_INVALID');
      const path = pathFor(proposed), current = await read(path);
      if (current.sha !== plan.expected_sha || current.status !== 'ready_to_publish' || current.content_id !== proposed.content_id || current.publish_attempt_id || current.instagram_media_id || current.metricool_scheduled_post_id) return {kind:'conflict'};
      const next = append({...current,status:'publishing',publish_attempt_id:proposed.publish_attempt_id,publishing_started_at:proposed.publishing_started_at,provider:'metricool'}, {timestamp:proposed.publishing_started_at,stage:'publication',result:'reservation_started',provider:'metricool',publish_attempt_id:proposed.publish_attempt_id,source:'publisher_v2'});
      const result = await write(path,current.sha,next,'publisher-v2: reserve publication attempt');
      // engine.mjs recognizes a completed reservation only by this exact
      // domain kind. write() reports the generic transport outcome
      // ('written'); translate it here so a real, committed reservation is
      // never mistaken for an unconfirmed one (see INC-018 follow-up: this
      // mismatch previously caused every real reservation to be treated as
      // failed even though the GitHub write had already succeeded, which
      // would have left the record stuck in 'publishing' with no send ever
      // attempted and no automatic recovery).
      return result.kind === 'written' ? {kind:'reserved',record:result.record} : result;
    },
    async persistPreSend({record,attemptId}) {
      const current = await ownedCurrent(record,attemptId);
      const next = append(current,{timestamp:new Date().toISOString(),stage:'publication',result:'metricool_pre_send',provider:'metricool',publish_attempt_id:attemptId,source:'publisher_v2'});
      const result = await write(pathFor(current),current.sha,next,'publisher-v2: persist Metricool pre-send receipt');
      return result.kind === 'written' ? {kind:'pre_send_persisted',record:result.record} : result;
    },
    async persistAttemptResult({record,attemptId,providerResult,reason}) {
      const current = await ownedCurrent(record,attemptId);
      const receipt = providerResult?.classification?.receipt;
      const matchingReceipt = receipt?.kind === 'metricool_scheduled' &&
        receipt.content_id === current.content_id && receipt.attempt_id === attemptId &&
        typeof receipt.metricool_id === 'string' && receipt.metricool_id.length > 0 &&
        typeof receipt.metricool_uuid === 'string' && receipt.metricool_uuid.length > 0;
      const positiveMediaId = typeof providerResult?.instagram_media_id === 'string' && /^[0-9]+$/.test(providerResult.instagram_media_id);
      const receiptFields = matchingReceipt ? {
        metricool_scheduled_post_id: receipt.metricool_id,
        metricool_scheduled_post_uuid: receipt.metricool_uuid
      } : {};
      const evidenceFields = positiveMediaId ? {
        instagram_media_id: providerResult.instagram_media_id,
        instagram_permalink: providerResult.instagram_permalink || null
      } : {};
      const next = append({...current,...receiptFields,...evidenceFields}, {
        timestamp:new Date().toISOString(),stage:'publication',result:'attempt_result_persisted',provider:'metricool',
        publish_attempt_id:attemptId,reason:reason || null,source:'publisher_v2'
      });
      const result = await write(pathFor(current),current.sha,next,'publisher-v2: persist publication attempt result');
      return result.kind === 'written' ? {kind:'attempt_result_persisted',record:result.record} : result;
    }
  };
}
