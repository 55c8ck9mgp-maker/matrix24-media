// Read-only Instagram media lookup adapter. It is not wired to a Worker route.
// Callers must provide a short-lived staging secret at runtime; never log it.
const MEDIA_ID = /^[0-9]+$/;
const OWNER_ID = /^[0-9]+$/;

function networkDiagnostic(error) {
  if (error?.name === 'AbortError') return 'abort';
  if (error?.name === 'TimeoutError') return 'timeout';
  if (error?.name === 'TypeError') return 'fetch';
  return 'unknown';
}

export async function getDirectMedia({ mediaId, accessToken, fetchImpl = fetch }) {
  if (typeof mediaId !== 'string' || !MEDIA_ID.test(mediaId)) return { kind: 'invalid_request', reason: 'invalid_media_id' };
  if (typeof accessToken !== 'string' || accessToken.trim().length < 20) return { kind: 'invalid_request', reason: 'missing_access_token' };
  let response;
  try {
    response = await fetchImpl(`https://graph.instagram.com/${mediaId}?fields=id,permalink,username`, {
      method: 'GET', headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }, redirect: 'manual'
    });
  } catch (error) {
    return { kind: 'lookup_unavailable', reason: 'network', diagnostic: networkDiagnostic(error) };
  }
  if (response.status >= 300 && response.status < 400) {
    return { kind: 'lookup_unavailable', reason: `redirect_${response.status}` };
  }
  if (response.status === 401 || response.status === 403) return { kind: 'lookup_unavailable', reason: 'authentication' };
  if (response.status === 404) return { kind: 'lookup_not_found' };
  if (!response.ok) return { kind: 'lookup_unavailable', reason: `http_${response.status}` };
  let body;
  try { body = await response.json(); } catch { return { kind: 'lookup_unavailable', reason: 'invalid_json' }; }
  if (typeof body?.id !== 'string' || !MEDIA_ID.test(body.id) || body.id !== mediaId) return { kind: 'lookup_unavailable', reason: 'identity_mismatch' };
  return { kind: 'ig_media', id: body.id, permalink: typeof body.permalink === 'string' ? body.permalink : null, username: typeof body.username === 'string' ? body.username : null };
}

export function bindDirectLookupToAccount(lookup, { accountId, expectedUsername }) {
  if (!lookup || lookup.kind !== 'ig_media' || typeof accountId !== 'string' || !OWNER_ID.test(accountId)) return { kind: 'lookup_unverified' };
  if (typeof expectedUsername !== 'string' || !expectedUsername || lookup.username !== expectedUsername) return { kind: 'lookup_unverified' };
  return { ...lookup, owner_id: accountId };
}
