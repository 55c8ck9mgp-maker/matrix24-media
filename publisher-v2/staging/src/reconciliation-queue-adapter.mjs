const QUEUE_PATH = /^queue\/[a-z0-9][a-z0-9-]*\.json$/;
const SHA = /^[0-9a-f]{40}$/;
const ATTEMPT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_ID = /^[0-9]+(?:_[0-9]+)?$/;

function fail(code) { const error = new Error(code); error.code = code; return error; }
function validRepo(repo) { return typeof repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo); }
function encode(value) { return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n'))); }
function decode(content) {
  try { const binary = atob(content); return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, byte => byte.charCodeAt(0)))); }
  catch { throw fail('RECONCILIATION_QUEUE_RECORD_INVALID'); }
}
function pathFor(record) {
  const path = record?.queue_path;
  if (typeof path !== 'string' || !QUEUE_PATH.test(path)) throw fail('RECONCILIATION_QUEUE_PATH_INVALID');
  return path;
}
function sameSnapshot(current, supplied) {
  if (current.sha !== supplied?.sha) return false;
  const {sha: currentSha, ...currentRecord} = current;
  const {sha: suppliedSha, ...suppliedRecord} = supplied || {};
  return JSON.stringify(currentRecord) === JSON.stringify(suppliedRecord);
}

export function createReconciliationQueueAdapter({repo, getAccessToken, fetchImpl = fetch, apiBase = 'https://api.github.com'} = {}) {
  if (!validRepo(repo) || typeof getAccessToken !== 'function' || typeof fetchImpl !== 'function') throw fail('RECONCILIATION_QUEUE_ADAPTER_CONFIG_INVALID');
  async function token() {
    const value = await getAccessToken();
    if (typeof value !== 'string' || value.length < 20) throw fail('RECONCILIATION_GITHUB_TOKEN_UNAVAILABLE');
    return value;
  }
  async function request(path, init = {}) {
    const accessToken = await token();
    return fetchImpl(apiBase + path, {...init, headers:{accept:'application/vnd.github+json',authorization:'Bearer ' + accessToken,'x-github-api-version':'2022-11-28',...(init.headers || {})}});
  }
  async function read(path) {
    const response = await request('/repos/' + repo + '/contents/' + path + '?ref=main', {method:'GET',headers:{'cache-control':'no-store'}});
    if (!response.ok) throw fail('RECONCILIATION_QUEUE_READ_UNCONFIRMED');
    const body = await response.json();
    if (body?.encoding !== 'base64' || typeof body.content !== 'string' || !SHA.test(body.sha)) throw fail('RECONCILIATION_QUEUE_RESPONSE_INVALID');
    const record = decode(body.content);
    if (!record || record.queue_path !== path) throw fail('RECONCILIATION_QUEUE_RECORD_INVALID');
    return {...record, sha:body.sha};
  }
  async function write(path, sha, record) {
    const response = await request('/repos/' + repo + '/contents/' + path, {
      method:'PUT',headers:{'content-type':'application/json'},
      body:JSON.stringify({message:'reconciliation: confirm published attempt',content:encode(record),sha,branch:'main'})
    });
    if (response.status === 409 || response.status === 422) return {kind:'conflict'};
    if (!response.ok) throw fail('RECONCILIATION_QUEUE_WRITE_UNCONFIRMED');
    const body = await response.json();
    if (!SHA.test(body?.content?.sha)) throw fail('RECONCILIATION_QUEUE_RESPONSE_INVALID');
    return {kind:'written',record:{...record,sha:body.content.sha}};
  }

  return {
    async confirmPublished({record, attemptId, instagram_media_id, instagram_permalink}) {
      if (!ATTEMPT.test(attemptId || '') || !MEDIA_ID.test(instagram_media_id || '')) throw fail('RECONCILIATION_CONFIRMATION_INVALID');
      const path = pathFor(record);
      const current = await read(path);
      if (!sameSnapshot(current, record) || current.publish_attempt_id !== attemptId || !['publishing','publish_unknown'].includes(current.status)) {
        return {kind:'conflict'};
      }
      const next = {
        ...current,
        status:'published',
        instagram_media_id,
        instagram_permalink: instagram_permalink || current.instagram_permalink || null,
        published_at: new Date().toISOString(),
        publish_attempt_history:[...(current.publish_attempt_history || []), {
          timestamp:new Date().toISOString(),stage:'reconciliation',result:'published_confirmed',
          provider:current.provider || 'metricool',publish_attempt_id:attemptId,source:'reconciliation_v2'
        }]
      };
      delete next.sha;
      const result = await write(path,current.sha,next);
      return result.kind === 'written' ? {kind:'confirmed_published',record:result.record} : result;
    }
  };
}
