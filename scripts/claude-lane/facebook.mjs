// Claude Lane — Facebook Page mirror (docs/CLAUDE_LANE.md, "Facebook").
// Approved by Justen 2026-10-07: every story the lane publishes on Instagram is
// also posted, once, to the Matrix24global Facebook Page.
//
// Kept separate from the Instagram publisher on purpose (Phase 3 rule: no single
// transaction across platforms). It only reads records the Instagram side has
// already marked `published`, and only ever writes the record's `facebook`
// sub-object. The record's own status, attempt id and Instagram fields are never
// touched, so a Facebook failure can never affect Instagram.
//
// Same safety rules as the Instagram side:
//   - durable claim (facebook.status = publishing) committed BEFORE the API call;
//   - exactly one API call per attempt, never retried; an uncertain result is
//     recorded as publish_unknown and left for a human;
//   - live only when the lane switch AND the Facebook switch are both "true".
import { composeCaption, facebookErrors, FB_STATUSES } from './lane-record.mjs';
export { facebookErrors, FB_STATUSES };

export const GRAPH = 'https://graph.facebook.com/v23.0';
// Only stories published on Instagram within this window are mirrored, so turning
// the switch on never back-fills the page with old stories.
export const FB_WINDOW_MS = 60 * 60 * 1000;
export const FB_MIN_SPACING_MS = 10 * 60 * 1000;
export const TOKEN_WARN_DAYS = 14;

const nonEmpty = v => typeof v === 'string' && v.trim().length > 0;

// Allowed changes of the facebook sub-object. No way back from any state: a
// second attempt for the same story would be a blind retry.
const FB_TRANSITIONS = new Set(['null->publishing', 'publishing->published', 'publishing->publish_unknown', 'publishing->failed']);
export function checkFacebookTransition(prev, next) {
  const from = prev?.facebook?.status ?? 'null';
  const to = next?.facebook?.status ?? 'null';
  if (from === to) return { ok: same(prev?.facebook, next?.facebook), error: 'FACEBOOK_CHANGED_WITHOUT_TRANSITION' };
  if (!FB_TRANSITIONS.has(`${from}->${to}`)) return { ok: false, error: `FACEBOOK_TRANSITION_NOT_ALLOWED:${from}->${to}` };
  if (from !== 'null' && prev.facebook.attempt_id !== next.facebook.attempt_id) return { ok: false, error: 'FACEBOOK_ATTEMPT_ID_CHANGED' };
  // Nothing outside the facebook sub-object and the history may change.
  const strip = r => { const { facebook, history, ...rest } = r; return rest; };
  if (!same(strip(prev), strip(next))) return { ok: false, error: 'FACEBOOK_WRITE_TOUCHED_INSTAGRAM_FIELDS' };
  return { ok: true };
}
function same(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }

export function instagramPublishedAt(record) {
  const ev = [...(record.history || [])].reverse().find(h => ['published', 'reconciled'].includes(h?.event));
  const t = Date.parse(ev?.at || '');
  return Number.isFinite(t) ? t : null;
}

// Classify the Graph API answer to POST /{page}/photos. Only a clear rejection is
// `failed`; anything that might have created a post is `publish_unknown`.
export function classifyPostResult({ status, body, networkError }) {
  if (networkError) return { outcome: 'publish_unknown', reason: 'network_error' };
  if (status >= 200 && status < 300 && /^\d+$/.test(String(body?.id ?? ''))) {
    return { outcome: 'published', photo_id: String(body.id), post_id: String(body.post_id || body.id) };
  }
  const err = body?.error;
  if (status >= 400 && status < 500 && err && !err.is_transient && ![1, 2].includes(Number(err.code))) {
    return { outcome: 'failed', reason: `graph_error_${err.code ?? 'unknown'}${err.error_subcode ? `_${err.error_subcode}` : ''}` };
  }
  return { outcome: 'publish_unknown', reason: `http_${status}${err?.code ? `_code_${err.code}` : ''}` };
}

// Thin Graph API client. Tokens travel only in headers or POST bodies and are
// never put in a URL, a log line or an error message.
export function createFacebookClient({ userToken, pageId, fetchImpl = fetch, onSecret = () => {} }) {
  let pageToken = null;
  const getJson = async (url, token) => {
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
    let body = null; try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  };
  return {
    // Resolves the Page token from the user token and checks the Page grants
    // CREATE_CONTENT. Never returns the token itself.
    async pageAccess() {
      if (!nonEmpty(userToken)) return { ok: false, reason: 'missing_user_token' };
      const { status, body } = await getJson(`${GRAPH}/me/accounts?fields=id,name,tasks,access_token&limit=100`, userToken);
      if (status !== 200) return { ok: false, reason: `accounts_http_${status}${body?.error?.code ? `_code_${body.error.code}` : ''}` };
      const page = (body?.data || []).find(p => String(p.id) === String(pageId));
      if (!page) return { ok: false, reason: 'page_not_granted' };
      if (!Array.isArray(page.tasks) || !page.tasks.includes('CREATE_CONTENT')) return { ok: false, reason: 'page_missing_create_content' };
      if (!nonEmpty(page.access_token)) return { ok: false, reason: 'page_token_missing' };
      pageToken = page.access_token;
      onSecret(pageToken);
      return { ok: true, page_id: String(page.id), page_name: page.name };
    },
    // Expiry of the stored user token (0 = never). Read-only.
    async tokenInfo() {
      const q = new URLSearchParams({ input_token: userToken });
      const res = await fetchImpl(`${GRAPH}/debug_token?${q}`, { headers: { authorization: `Bearer ${userToken}` } });
      let body = null; try { body = await res.json(); } catch { body = null; }
      const d = body?.data;
      if (!d) return { ok: false, reason: `debug_http_${res.status}` };
      return { ok: true, valid: d.is_valid === true, expires_at: Number(d.expires_at) || 0, scopes: d.scopes || [] };
    },
    async postPhoto({ url, caption }) {
      if (!pageToken) throw new Error('PAGE_ACCESS_NOT_RESOLVED');
      const form = new URLSearchParams({ url, caption, published: 'true', access_token: pageToken });
      try {
        const res = await fetchImpl(`${GRAPH}/${pageId}/photos`, { method: 'POST', body: form });
        let body = null; try { body = await res.json(); } catch { body = null; }
        return classifyPostResult({ status: res.status, body });
      } catch {
        return classifyPostResult({ networkError: true });
      }
    },
  };
}

function withFacebook(record, facebook, event, nowIso) {
  return { ...record, facebook, history: [...(record.history || []), { at: nowIso, ...event }] };
}

export async function runFacebook({
  mode = 'dry-run', enabled = false, store, fb,
  now = Date.now(), clock = () => Date.now(), newAttemptId = () => crypto.randomUUID(), windowMs = FB_WINDOW_MS,
}) {
  if (mode !== 'dry-run' && mode !== 'live') return { outcome: 'bad_mode' };
  const live = mode === 'live';
  if (live && enabled !== true) return { outcome: 'disabled' };
  const nowIso = new Date(now).toISOString();

  const entries = await store.list();
  const stuck = entries.filter(e => e.record.facebook?.status === 'publishing').map(e => e.record.content_id);
  const lastReserved = Math.max(0, ...entries.map(e => Date.parse(e.record.facebook?.reserved_at || '') || 0));
  const eligible = entries
    .filter(e => e.record.status === 'published' && e.record.facebook == null)
    .map(e => ({ ...e, at: instagramPublishedAt(e.record) }))
    .filter(e => e.at != null && now - e.at <= windowMs && now >= e.at)
    .sort((a, b) => a.at - b.at);
  if (!eligible.length) return { outcome: 'no_candidate', stuck };
  if (now - lastReserved < FB_MIN_SPACING_MS) return { outcome: 'spacing', next_after: new Date(lastReserved + FB_MIN_SPACING_MS).toISOString(), stuck };

  const access = await fb.pageAccess();
  if (!access.ok) return { outcome: 'page_access_error', reason: access.reason, stuck };

  const { record: candidate, sha } = eligible[0];
  const caption = composeCaption(candidate);
  const attempt = newAttemptId();
  const reserved = withFacebook(candidate, { status: 'publishing', attempt_id: attempt, reserved_at: nowIso },
    { event: 'facebook_reserved', facebook_attempt_id: attempt }, nowIso);
  const check = (prev, next) => {
    const t = checkFacebookTransition(prev, next);
    const v = facebookErrors(next);
    if (!t.ok || v.length) throw new Error(`INVALID_FACEBOOK_WRITE:${next.content_id}:${t.ok ? v.join(',') : t.error}`);
  };
  check(candidate, reserved);
  if (!live) {
    return { outcome: 'would_post', content_id: candidate.content_id, page: access.page_name, image_url: candidate.image_url,
      caption_length: caption.length, waiting: eligible.length, stuck };
  }

  // Durable claim BEFORE the Facebook call.
  const claim = await store.write(reserved, sha, `claude-lane: facebook reserve ${candidate.content_id}`);
  if (!claim.ok) return { outcome: 'claim_conflict', content_id: candidate.content_id };

  // The only public side effect. Exactly once per attempt.
  const res = await fb.postPhoto({ url: candidate.image_url, caption });
  const doneIso = new Date(clock()).toISOString();
  const base = { status: res.outcome, attempt_id: attempt, reserved_at: nowIso };
  const facebook = res.outcome === 'published'
    ? { ...base, post_id: res.post_id, photo_id: res.photo_id, published_at: doneIso }
    : { ...base, reason: res.reason };
  const done = withFacebook(reserved, facebook,
    { event: `facebook_${res.outcome}`, facebook_attempt_id: attempt, ...(res.post_id ? { facebook_post_id: res.post_id } : { reason: res.reason }) }, doneIso);
  check(reserved, done);
  const w = await store.write(done, claim.sha, `claude-lane: facebook ${res.outcome} ${candidate.content_id}`);
  return { outcome: w.ok ? `facebook_${res.outcome}` : 'facebook_record_write_failed', content_id: candidate.content_id,
    post_id: res.post_id ?? null, reason: res.reason ?? null, stuck };
}
