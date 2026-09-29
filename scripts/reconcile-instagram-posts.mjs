// Instagram queue reconciliation (Recovery plane).
//
// Reads the account's own Instagram media through the Graph API and compares it
// with queue/ records. It has exactly one write, and only with --apply:
//
//   published (permalink, no instagram_media_id) -> published + instagram_media_id
//
// The media ID is taken only from an account media item whose permalink
// shortcode equals the record's archived permalink. That write is the
// `published->published` evidence enrichment the Recovery plane owns in
// scripts/queue-transition-ownership.mjs, and it goes through a SHA-conditional
// GitHub contents write re-planned against a fresh read on every attempt.
//
// Everything else is report-only:
// - `publishing` records are never modified (the publisher owns them). Caption
//   matches are listed as candidates for a human or the publisher to review.
// - A record that cannot be matched keeps its status. "Not found" is not
//   evidence of non-publication (DIRECT_MEDIA_LOOKUP.md), and
//   `published -> publish_unknown` is not an owned transition.
// - Two account posts matching one record are reported as a suspected duplicate.
//
// Retries: Graph API reads and GitHub CAS conflicts retry up to 3 times with
// exponential backoff. Neither is an external side effect: reads change nothing,
// and each GitHub attempt re-reads the record and skips it once the ID is there.
//
// Usage:
//   IG_READ_TOKEN=... IG_USERNAME=matrix24global node scripts/reconcile-instagram-posts.mjs
//   ... GH_TOKEN=... GITHUB_REPOSITORY=owner/repo node scripts/reconcile-instagram-posts.mjs --apply
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyQueueWrite, PLANES } from './queue-transition-ownership.mjs';

const GRAPH_ORIGIN = 'https://graph.instagram.com';
const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,timestamp,permalink,username';
const MAX_ATTEMPTS = 3;
const MAX_PAGES = 10; // 10 x 50 posts; the oldest open record is days old, not months.
const CLOCK_SKEW_MS = 10 * 60 * 1000;
const MEDIA_ID = /^[0-9]+$/;

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const backoffMs = attempt => 1000 * 2 ** attempt; // 1s, 2s, 4s

export function shortcodeFromPermalink(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(/^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/);
  return m ? m[1] : null;
}

export function normalizeCaption(text) {
  return typeof text === 'string' ? text.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
}

// The published caption may carry the hashtags appended after the record caption.
function captionMatches(record, item) {
  const want = normalizeCaption(record.caption);
  const got = normalizeCaption(item.caption);
  return want.length > 0 && (got === want || got.startsWith(`${want} `));
}

function attemptStart(record) {
  const stamps = [record.publishing_started_at, record.media_ready_at]
    .map(t => Date.parse(t || '')).filter(Number.isFinite);
  return stamps.length ? Math.min(...stamps) : null;
}

/**
 * Pure planner. `media` is the account media list already filtered to the
 * expected username; `oldestFetched` is the oldest timestamp it covers
 * (null when the whole history was read).
 */
export function planReconciliation({ records, media, oldestFetched = null }) {
  const enrich = [];
  const report = [];
  const oldest = oldestFetched ? Date.parse(oldestFetched) : null;

  for (const { path: queuePath, record } of records) {
    const content_id = record?.content_id;
    const status = record?.status;
    if (status !== 'published' && status !== 'publishing') continue;

    const captionHits = media.filter(m => captionMatches(record, m));

    if (status === 'published') {
      if (MEDIA_ID.test(String(record.instagram_media_id || ''))) {
        if (captionHits.length > 1) report.push({ content_id, status, result: 'duplicate_suspected', media_ids: captionHits.map(m => m.id) });
        continue;
      }
      const shortcode = shortcodeFromPermalink(record.instagram_permalink);
      if (!shortcode) {
        report.push({ content_id, status, result: 'unresolved', reason: 'no_valid_permalink' });
        continue;
      }
      const hits = media.filter(m => shortcodeFromPermalink(m.permalink) === shortcode);
      if (hits.length === 1 && MEDIA_ID.test(hits[0].id)) {
        const item = hits[0];
        enrich.push({ queue_path: queuePath, content_id, shortcode, media: item });
        report.push({ content_id, status, result: 'media_id_confirmed', method: 'permalink_shortcode_match', instagram_media_id: item.id, platform_timestamp: item.timestamp || null });
      } else if (hits.length > 1) {
        report.push({ content_id, status, result: 'identity_conflict', reason: 'shortcode_matched_multiple_media', media_ids: hits.map(m => m.id) });
      } else {
        const publishedAt = Date.parse(record.published_at || '');
        const outside = oldest != null && Number.isFinite(publishedAt) && publishedAt < oldest;
        report.push({ content_id, status, result: 'unresolved', reason: outside ? 'outside_fetched_window' : 'permalink_not_in_account_media' });
      }
      if (captionHits.length > 1) report.push({ content_id, status, result: 'duplicate_suspected', media_ids: captionHits.map(m => m.id) });
      continue;
    }

    // publishing: report only, never written here.
    const start = attemptStart(record);
    const candidates = captionHits.filter(m => {
      const t = Date.parse(m.timestamp || '');
      return start == null || !Number.isFinite(t) || t >= start - CLOCK_SKEW_MS;
    });
    const base = { content_id, status, publish_attempt_id: record.publish_attempt_id || null, write: 'none_publisher_owned' };
    if (candidates.length === 0) report.push({ ...base, result: 'no_candidate', note: 'absence is not proof of non-publication; never retry on this basis' });
    else if (candidates.length === 1) report.push({ ...base, result: 'candidate_caption_match', instagram_media_id: candidates[0].id, instagram_permalink: candidates[0].permalink || null, platform_timestamp: candidates[0].timestamp || null });
    else report.push({ ...base, result: 'duplicate_suspected', media_ids: candidates.map(m => m.id) });
  }
  return { enrich, report };
}

/** Build the enriched record and prove it is an owned Recovery write. */
export function buildEnrichedRecord(record, media, { now, runId }) {
  const history = Array.isArray(record.publish_attempt_history) ? record.publish_attempt_history : [];
  const after = {
    ...record,
    instagram_media_id: media.id,
    publish_attempt_history: [...history, {
      timestamp: now,
      stage: 'instagram_reconciliation',
      result: 'media_id_confirmed',
      method: 'permalink_shortcode_match',
      source: 'instagram_graph_api',
      instagram_media_id: media.id,
      instagram_permalink: media.permalink || null,
      platform_timestamp: media.timestamp || null,
      run_id: runId || null
    }]
  };
  const verdict = classifyQueueWrite(record, after);
  if (!verdict.ok || verdict.plane !== PLANES.RECOVERY) {
    return { ok: false, violations: verdict.violations.length ? verdict.violations : [`unexpected_plane:${verdict.plane}`] };
  }
  return { ok: true, after };
}

async function fetchWithRetry(url, init, { fetchImpl, sleep }) {
  let last;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(url, init);
      if (response.status !== 429 && response.status < 500) return response;
      last = { kind: 'http', status: response.status };
    } catch (error) {
      last = { kind: 'network', name: error?.name || 'Error' };
    }
    if (attempt < MAX_ATTEMPTS - 1) await sleep(backoffMs(attempt));
  }
  return { ok: false, status: 0, retryExhausted: last };
}

/** Read the account's own media, newest first. Never logs the token or URLs. */
export async function fetchAccountMedia({ accessToken, expectedUsername, fetchImpl = fetch, sleep = defaultSleep, maxPages = MAX_PAGES }) {
  if (typeof accessToken !== 'string' || accessToken.trim().length < 20) return { ok: false, reason: 'missing_access_token' };
  if (typeof expectedUsername !== 'string' || !expectedUsername) return { ok: false, reason: 'missing_expected_username' };
  const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/json' };
  let url = `${GRAPH_ORIGIN}/me/media?fields=${MEDIA_FIELDS}&limit=50`;
  const media = [];
  let foreign = 0;
  let complete = false;

  for (let page = 0; page < maxPages && url; page++) {
    const response = await fetchWithRetry(url, { method: 'GET', headers, redirect: 'manual' }, { fetchImpl, sleep });
    if (response.retryExhausted) return { ok: false, reason: 'graph_unavailable', detail: response.retryExhausted };
    if (response.status === 401 || response.status === 403) return { ok: false, reason: 'authentication' };
    if (!response.ok) return { ok: false, reason: `http_${response.status}` };
    let body;
    try { body = await response.json(); } catch { return { ok: false, reason: 'invalid_json' }; }
    if (!Array.isArray(body?.data)) return { ok: false, reason: 'invalid_shape' };
    for (const item of body.data) {
      if (typeof item?.id !== 'string' || !MEDIA_ID.test(item.id)) continue;
      if (item.username !== expectedUsername) { foreign++; continue; }
      media.push(item);
    }
    const next = body?.paging?.next;
    if (!next) { complete = true; break; }
    // Only follow pagination on the Graph origin, so the token never leaves it.
    try { url = new URL(next).origin === GRAPH_ORIGIN ? next : null; } catch { url = null; }
  }
  if (foreign) return { ok: false, reason: 'identity_mismatch', foreign };
  const stamps = media.map(m => Date.parse(m.timestamp || '')).filter(Number.isFinite);
  const oldestFetched = complete || !stamps.length ? null : new Date(Math.min(...stamps)).toISOString();
  return { ok: true, media, complete, oldestFetched };
}

function ghHeaders(token) {
  return { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'matrix24-instagram-reconciliation' };
}

/**
 * SHA-conditional enrichment of one record. Each attempt re-reads the file and
 * re-checks it, so a conflict or an ambiguous PUT resolves to "already done"
 * instead of a second write.
 */
export async function applyEnrichment({ repo, token, branch = 'main', item, now, runId, fetchImpl = fetch, sleep = defaultSleep }) {
  const encoded = item.queue_path.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${repo}/contents/${encoded}`;
  let lastReason = 'not_attempted';

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt - 1));
    const read = await fetchWithRetry(`${url}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders(token), redirect: 'manual' }, { fetchImpl, sleep });
    if (!read.ok) { lastReason = `read_failed_${read.status}`; continue; }
    const file = await read.json();
    const fresh = JSON.parse(Buffer.from(String(file.content || ''), 'base64').toString('utf8'));

    if (fresh.content_id !== item.content_id) return { content_id: item.content_id, result: 'skipped', reason: 'content_id_mismatch' };
    if (fresh.instagram_media_id === item.media.id) return { content_id: item.content_id, result: 'already_reconciled' };
    if (fresh.instagram_media_id) return { content_id: item.content_id, result: 'skipped', reason: 'different_media_id_present' };
    if (fresh.status !== 'published') return { content_id: item.content_id, result: 'skipped', reason: `status_changed_to_${fresh.status}` };
    if (shortcodeFromPermalink(fresh.instagram_permalink) !== item.shortcode) return { content_id: item.content_id, result: 'skipped', reason: 'permalink_changed' };

    const built = buildEnrichedRecord(fresh, item.media, { now, runId });
    if (!built.ok) return { content_id: item.content_id, result: 'blocked', reason: 'ownership_violation', violations: built.violations };

    const body = JSON.stringify({
      message: `Reconcile Instagram media ID for ${item.content_id} (permalink match)`,
      content: Buffer.from(`${JSON.stringify(built.after, null, 2)}\n`, 'utf8').toString('base64'),
      sha: file.sha,
      branch
    });
    let put;
    try {
      put = await fetchImpl(url, { method: 'PUT', headers: { ...ghHeaders(token), 'content-type': 'application/json' }, body, redirect: 'manual' });
    } catch {
      lastReason = 'put_network_error'; // outcome unknown; the next attempt re-reads
      continue;
    }
    if (put.ok) {
      const result = await put.json().catch(() => ({}));
      return { content_id: item.content_id, result: 'written', instagram_media_id: item.media.id, commit: result?.commit?.sha || null };
    }
    if (put.status === 409 || put.status === 422) { lastReason = 'sha_conflict'; continue; }
    if (put.status >= 500) { lastReason = `put_http_${put.status}`; continue; }
    return { content_id: item.content_id, result: 'error', reason: `put_http_${put.status}` };
  }
  return { content_id: item.content_id, result: 'error', reason: `${lastReason}_after_${MAX_ATTEMPTS}_attempts` };
}

export function readQueueDir(dir = 'queue') {
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => ({
    path: path.posix.join('queue', f),
    record: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  }));
}

function audit(event) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'instagram_reconciliation', ...event }));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const reportPath = process.env.RECONCILIATION_REPORT || 'reconciliation-report.json';
  const runId = process.env.GITHUB_RUN_ID || null;
  const out = { mode: apply ? 'apply' : 'report', run_id: runId, started_at: new Date().toISOString(), report: [], writes: [] };

  const fetched = await fetchAccountMedia({ accessToken: process.env.IG_READ_TOKEN, expectedUsername: process.env.IG_USERNAME });
  if (!fetched.ok) {
    out.error = fetched.reason;
    audit({ event: 'account_media_unavailable', reason: fetched.reason });
    fs.writeFileSync(reportPath, `${JSON.stringify(out, null, 2)}\n`);
    process.exitCode = 2; // fail closed: nothing planned, nothing written
    return;
  }
  audit({ event: 'account_media_read', count: fetched.media.length, complete: fetched.complete, oldest_fetched: fetched.oldestFetched });

  const { enrich, report } = planReconciliation({ records: readQueueDir(), media: fetched.media, oldestFetched: fetched.oldestFetched });
  out.report = report;
  for (const row of report) audit({ event: 'record_checked', ...row });

  if (apply) {
    const repo = process.env.GITHUB_REPOSITORY;
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!repo || !token) {
      out.error = 'missing_github_context';
      process.exitCode = 2;
    } else {
      for (const item of enrich) {
        const w = await applyEnrichment({ repo, token, item, now: new Date().toISOString(), runId });
        out.writes.push(w);
        audit({ event: 'enrichment_write', ...w });
      }
    }
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(out, null, 2)}\n`);
  if (out.writes.some(w => w.result === 'error' || w.result === 'blocked')) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main();
}
