// Minimal Instagram Graph API client for the Claude Publisher and the Instagram
// reconciliation workflow. Tokens are passed in by the caller and never logged.
//
// Read calls (listRecentMedia, getMedia) have no side effects.
// createContainer has no public side effect: an unpublished container is private
// and expires on its own. publishContainer is the ONLY call that makes a post
// public, and callers must invoke it at most once per publish_attempt_id.
const DEFAULT_API = 'https://graph.instagram.com/v23.0';
const NUMERIC_ID = /^[0-9]+$/;

export class InstagramError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

export function normalizeCaption(text) {
  return String(text || '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

// The exact caption the publisher sends: editorial caption, blank line, hashtags.
export function buildInstagramCaption(record) {
  const tags = Array.isArray(record?.hashtags) ? record.hashtags.filter(t => typeof t === 'string' && t.trim()) : [];
  const caption = String(record?.caption || '').trim();
  return tags.length ? `${caption}\n\n${tags.join(' ')}` : caption;
}

// A feed item belongs to a record only when its caption begins with the record's
// full editorial caption (whitespace-normalized). Providers may append hashtags,
// so a prefix match is used; a partial or fuzzy match never counts.
export function captionMatchesRecord(feedCaption, record) {
  const want = normalizeCaption(record?.caption);
  if (want.length < 40) return false; // too short to identify a story on its own
  return normalizeCaption(feedCaption).startsWith(want);
}

export function createInstagramClient({ accessToken, igUserId = 'me', fetchImpl = fetch, apiBase = DEFAULT_API, sleep }) {
  if (typeof accessToken !== 'string' || accessToken.trim().length < 20) throw new InstagramError('MISSING_ACCESS_TOKEN');
  if (igUserId !== 'me' && !NUMERIC_ID.test(String(igUserId))) throw new InstagramError('INVALID_IG_USER_ID');
  const auth = { authorization: `Bearer ${accessToken}`, accept: 'application/json' };
  const wait = sleep || (ms => new Promise(r => setTimeout(r, ms)));

  async function getJson(url) {
    let res;
    try {
      res = await fetchImpl(url, { method: 'GET', headers: auth, redirect: 'manual' });
    } catch {
      throw new InstagramError('READ_NETWORK');
    }
    if (!res.ok) throw new InstagramError('READ_HTTP', String(res.status));
    try { return await res.json(); } catch { throw new InstagramError('READ_INVALID_JSON'); }
  }

  async function postForm(path, params) {
    const res = await fetchImpl(`${apiBase}/${path}`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      redirect: 'manual'
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, ok: res.ok, body };
  }

  // Newest-first account media, following pagination up to maxItems. Any failure
  // throws: callers must treat an incomplete read as "unknown", never as "absent".
  async function listRecentMedia({ maxItems = 100 } = {}) {
    const items = [];
    let url = `${apiBase}/${igUserId}/media?fields=id,caption,permalink,timestamp,username&limit=50`;
    while (url && items.length < maxItems) {
      const page = await getJson(url);
      if (!Array.isArray(page?.data)) throw new InstagramError('READ_INVALID_PAGE');
      for (const m of page.data) {
        if (typeof m?.id === 'string' && NUMERIC_ID.test(m.id)) items.push(m);
      }
      const next = page?.paging?.next;
      url = typeof next === 'string' && next.startsWith('https://graph.instagram.com/') ? next : null;
    }
    return items.slice(0, maxItems);
  }

  async function getMedia(mediaId) {
    if (!NUMERIC_ID.test(String(mediaId))) throw new InstagramError('INVALID_MEDIA_ID');
    return getJson(`${apiBase}/${mediaId}?fields=id,permalink,timestamp,username`);
  }

  // Step 1 (private): create the media container. A failure here means nothing
  // was made public.
  async function createContainer({ imageUrl, caption }) {
    let r;
    try {
      r = await postForm(`${igUserId}/media`, { image_url: imageUrl, caption });
    } catch {
      return { ok: false, reason: 'container_network' };
    }
    if (!r.ok || typeof r.body?.id !== 'string' || !NUMERIC_ID.test(r.body.id)) {
      return { ok: false, reason: `container_http_${r.status}` };
    }
    return { ok: true, containerId: r.body.id };
  }

  // Poll the private container until it is ready. Read-only.
  async function waitContainer(containerId, { attempts = 10, intervalMs = 3000 } = {}) {
    for (let i = 0; i < attempts; i++) {
      let body;
      try {
        body = await getJson(`${apiBase}/${containerId}?fields=status_code`);
      } catch {
        body = null;
      }
      const code = body?.status_code;
      if (code === 'FINISHED') return { ok: true };
      if (code === 'ERROR' || code === 'EXPIRED') return { ok: false, reason: `container_${code.toLowerCase()}` };
      await wait(intervalMs);
    }
    return { ok: false, reason: 'container_not_ready' };
  }

  // Step 2 (PUBLIC): publish the container. Called at most once per attempt.
  // Returns sent:false only when the request provably never reached Instagram;
  // every other non-success is ambiguous and must be reconciled, not retried.
  async function publishContainer(containerId) {
    let r;
    try {
      r = await postForm(`${igUserId}/media_publish`, { creation_id: containerId });
    } catch {
      return { outcome: 'unknown', reason: 'publish_network' };
    }
    if (r.ok && typeof r.body?.id === 'string' && NUMERIC_ID.test(r.body.id)) {
      return { outcome: 'published', mediaId: r.body.id };
    }
    // Numeric Meta error codes only (no message text) so the cause is diagnosable
    // from the record; the outcome stays 'unknown' whatever the code says.
    const err = r.body?.error;
    const code = Number.isInteger(err?.code) ? `_code_${err.code}` : '';
    const sub = Number.isInteger(err?.error_subcode) ? `_sub_${err.error_subcode}` : '';
    return { outcome: 'unknown', reason: `publish_http_${r.status}${code}${sub}` };
  }

  return { listRecentMedia, getMedia, createContainer, waitContainer, publishContainer };
}
