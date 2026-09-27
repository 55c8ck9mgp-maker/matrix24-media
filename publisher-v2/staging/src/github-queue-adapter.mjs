const QUEUE_PATH = /^queue\/[a-z0-9][a-z0-9-]*\.json$/;
const SHA = /^[0-9a-f]{40}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function validRepo(repo) {
  return typeof repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}
function encode(value) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n')));
}
function decode(content) {
  try {
    const binary = atob(content);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, byte => byte.charCodeAt(0))));
  } catch {
    throw fail('GITHUB_QUEUE_RECORD_INVALID');
  }
}
function pathFor(record) {
  const path = record?.queue_path;
  if (typeof path !== 'string' || !QUEUE_PATH.test(path)) throw fail('GITHUB_QUEUE_PATH_INVALID');
  return path;
}
function shaFor(record) {
  if (typeof record?.sha !== 'string' || !SHA.test(record.sha)) throw fail('GITHUB_QUEUE_SHA_MISSING');
  return record.sha;
}
function append(record, entry) {
  return {...record, publish_attempt_history:[...(record.publish_attempt_history || []), entry]};
}
function transition(record, status, attemptId, result, extra = {}) {
  if (record.publish_attempt_id !== attemptId) throw fail('GITHUB_ATTEMPT_MISMATCH');
  return append({...record, ...extra, status}, {
    timestamp:new Date().toISOString(), stage:'publication', result,
    provider:'metricool', publish_attempt_id:attemptId, source:'publisher_v2'
  });
}

export function createGitHubQueueAdapter({repo, getAccessToken, fetchImpl = fetch, apiBase = 'https://api.github.com'} = {}) {
  if (!validRepo(repo) || typeof getAccessToken !== 'function' || typeof fetchImpl !== 'function') throw fail('GITHUB_ADAPTER_CONFIG_INVALID');

  async function token() {
    const value = await getAccessToken();
    if (typeof value !== 'string' || value.length < 20) throw fail('GITHUB_APP_TOKEN_UNAVAILABLE');
    return value;
  }
  async function request(path, init = {}) {
    const accessToken = await token();
    const response = await fetchImpl(apiBase + path, {
      ...init,
      headers:{accept:'application/vnd.github+json', authorization:'Bearer ' + accessToken, 'x-github-api-version':'2022-11-28', ...(init.headers || {})}
    });
    return response;
  }
  async function read(path) {
    const response = await request('/repos/' + repo + '/contents/' + path + '?ref=main', {method:'GET', headers:{'cache-control':'no-store'}});
    if (response.status === 404) throw fail('GITHUB_QUEUE_RECORD_MISSING');
    if (!response.ok) throw fail('GITHUB_QUEUE_READ_UNCONFIRMED');
    const body = await response.json();
    if (body?.encoding !== 'base64' || typeof body.content !== 'string' || !SHA.test(body.sha)) throw fail('GITHUB_QUEUE_RESPONSE_INVALID');
    const record = decode(body.content);
    if (!record || typeof record !== 'object' || record.queue_path !== path) throw fail('GITHUB_QUEUE_RECORD_INVALID');
    return {...record, sha:body.sha};
  }
  async function write(path, sha, record, message) {
    const response = await request('/repos/' + repo + '/contents/' + path, {method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify({message, content:encode(record), sha, branch:'main'})});
    if (response.status === 409 || response.status === 422) return {kind:'conflict'};
    if (!response.ok) throw fail('GITHUB_QUEUE_WRITE_UNCONFIRMED');
    const body = await response.json();
    if (!SHA.test(body?.content?.sha)) throw fail('GITHUB_QUEUE_RESPONSE_INVALID');
    return {kind:'written', record:{...record, sha:body.content.sha}};
  }

  return {
    async reserve(plan) {
      if (!plan || plan.action !== 'conditional_reservation' || !SHA.test(plan.expected_sha)) throw fail('GITHUB_RESERVATION_PLAN_INVALID');
      const path = pathFor(plan.replacement);
      const current = await read(path);
      if (current.sha !== plan.expected_sha) return {kind:'conflict'};
      if (current.status !== 'ready_to_publish' || current.content_id !== plan.replacement.content_id) return {kind:'conflict'};
      return write(path, current.sha, plan.replacement, 'publisher-v2: reserve publication attempt');
    },
    async markUnknown({record, attemptId, reason}) {
      const path = pathFor(record), sha = shaFor(record);
      const next = transition(record, 'publish_unknown', attemptId, 'publish_unknown', {publish_unknown_reason:reason});
      return write(path, sha, next, 'publisher-v2: quarantine ambiguous publication');
    },
    async returnReady({record, attemptId, reason}) {
      const path = pathFor(record), sha = shaFor(record);
      const next = transition(record, 'ready_to_publish', attemptId, 'returned_ready', {publish_attempt_id:null, publishing_started_at:null, provider:null, return_ready_reason:reason});
      const result = await write(path, sha, next, 'publisher-v2: return proven pre-write no-op to ready');
      return result.kind === 'written' ? {kind:'returned_ready', record:result.record} : result;
    },
    async archive({record, attemptId, instagram_media_id, instagram_permalink}) {
      const path = pathFor(record), sha = shaFor(record);
      if (typeof instagram_media_id !== 'string' || !/^[0-9]+$/.test(instagram_media_id)) throw fail('INSTAGRAM_MEDIA_ID_INVALID');
      const next = transition(record, 'published', attemptId, 'published', {instagram_media_id, instagram_permalink, published_at:new Date().toISOString()});
      return write(path, sha, next, 'publisher-v2: archive confirmed Instagram publication');
    }
  };
}
