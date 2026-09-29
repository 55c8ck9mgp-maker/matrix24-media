// SHA-conditional (compare-and-swap) access to queue/<content_id>.json through the
// GitHub Contents API. Used by the Claude Publisher and the Instagram
// reconciliation workflow.
//
// Safety contract (INC-005): a write always carries the SHA of the exact snapshot
// the caller built its new record from. A 409/422 conflict is returned to the
// caller as { ok: false, reason: 'sha_conflict' } and is NEVER retried here with a
// newer SHA, because pasting a new SHA onto an old snapshot silently overwrites
// whatever another plane wrote in between.
import crypto from 'node:crypto';

const SAFE_PATH = /^queue\/matrix24-[a-z0-9-]+\.json$/;

export class GitHubCasError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

// Git blob SHA of a UTF-8 string, identical to what the Contents API reports.
export function gitBlobSha(content) {
  const hash = crypto.createHash('sha1');
  hash.update(`blob ${Buffer.byteLength(content, 'utf8')}\0`, 'utf8');
  hash.update(content, 'utf8');
  return hash.digest('hex');
}

export function serializeRecord(record) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

function assertPath(queuePath) {
  if (!SAFE_PATH.test(queuePath || '')) throw new GitHubCasError('QUEUE_PATH_INVALID', String(queuePath));
}

export function createGitHubQueueClient({ token, repository, ref = 'main', fetchImpl = fetch, apiBase = 'https://api.github.com' }) {
  if (!token) throw new GitHubCasError('NO_GITHUB_TOKEN');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new GitHubCasError('NO_GITHUB_REPOSITORY');
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json'
  };

  async function read(queuePath) {
    assertPath(queuePath);
    const res = await fetchImpl(`${apiBase}/repos/${repository}/contents/${queuePath}?ref=${encodeURIComponent(ref)}`, { headers });
    if (res.status === 404) return { exists: false };
    if (!res.ok) throw new GitHubCasError('QUEUE_READ_FAILED', `HTTP ${res.status}`);
    const body = await res.json();
    const content = Buffer.from(body.content || '', 'base64').toString('utf8');
    if (gitBlobSha(content) !== body.sha) throw new GitHubCasError('QUEUE_READ_SHA_MISMATCH', queuePath);
    return { exists: true, sha: body.sha, content, record: JSON.parse(content) };
  }

  async function write(queuePath, record, expectedSha, message) {
    assertPath(queuePath);
    if (!expectedSha) throw new GitHubCasError('EXPECTED_SHA_REQUIRED', queuePath);
    const content = serializeRecord(record);
    const res = await fetchImpl(`${apiBase}/repos/${repository}/contents/${queuePath}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), sha: expectedSha, branch: ref })
    });
    if (res.status === 409 || res.status === 422) return { ok: false, reason: 'sha_conflict', status: res.status };
    if (!res.ok) return { ok: false, reason: 'write_failed', status: res.status };
    const body = await res.json();
    return { ok: true, sha: body.content?.sha || gitBlobSha(content), commit: body.commit?.sha || null };
  }

  return { read, write };
}
