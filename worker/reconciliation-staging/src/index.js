import { getDirectMedia, bindDirectLookupToAccount } from '../../staging/reliability/direct-media-client.mjs';
import { assessDirectMediaLookup } from '../../staging/reliability/policy.mjs';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function callbackPage() {
  return new Response(
    '<!doctype html><title>MATRIX 24 staging authorization complete</title><p>Authorization complete. You may close this window.</p>',
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'"
      }
    }
  );
}

function configured(env) {
  return env?.MATRIX24_MODE === 'staging-reconciliation' &&
    typeof env.IG_READ_TOKEN === 'string' && env.IG_READ_TOKEN.length >= 20 &&
    typeof env.IG_ACCOUNT_ID === 'string' && /^\d+$/.test(env.IG_ACCOUNT_ID) &&
    typeof env.IG_USERNAME === 'string' && env.IG_USERNAME.length > 0;
}

export async function handle(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/auth/instagram/callback') return callbackPage();
  if (request.method === 'GET' && url.pathname === '/health') {
    return response({ status: 'ok', mode: env?.MATRIX24_MODE || 'unconfigured',
      publication_allowed: false, claims_writable: false, cron_enabled: false });
  }
  const match = request.method === 'GET' && url.pathname.match(/^\/lookup\/([0-9]+)$/);
  if (!match) return response({ error: 'not_found' }, 404);
  if (!configured(env)) return response({ error: 'staging_not_configured' }, 503);

  const lookup = await getDirectMedia({ mediaId: match[1], accessToken: env.IG_READ_TOKEN, fetchImpl });
  if (lookup.kind !== 'ig_media') {
    const status = lookup.kind === 'lookup_not_found' ? 404 : 502;
    return response({ status: 'unverified', reason: lookup.reason || lookup.kind,
      diagnostic: lookup.diagnostic || null }, status);
  }
  const bound = bindDirectLookupToAccount(lookup, {
    accountId: env.IG_ACCOUNT_ID, expectedUsername: env.IG_USERNAME
  });
  const result = assessDirectMediaLookup({ account_id: env.IG_ACCOUNT_ID, media_id: match[1] }, bound);
  return response({ status: result.publication || 'unknown', action: result.action,
    media_id: result.media_id || null, permalink: result.permalink || null,
    verification_source: result.verification_source || null });
}

export default { fetch: handle };
