// Instagram reconciliation (Recovery plane). READ-ONLY toward Instagram: it lists
// the account's recent media and never creates, edits or deletes a post.
//
// It fills in missing evidence on queue records by matching each record's full
// editorial caption against the account feed:
//   - published without instagram_media_id   -> add media ID (+ permalink)
//   - published with media ID, no permalink   -> add permalink if the ID is in the feed
//   - publishing / publish_unknown            -> published, only on exactly one match
//
// It never releases a claim, never moves a record backwards, and treats "no
// match" as "unknown" (the post may still be scheduled, or older than the feed
// window). Multiple matches mean a duplicate already exists; that is reported for
// the owner and nothing is written.
//
// Usage:
//   IG_READ_TOKEN=... node scripts/reconcile-instagram-feed.mjs            # plan only
//   APPLY=true GH_TOKEN=... IG_READ_TOKEN=... node scripts/reconcile-instagram-feed.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyQueueWrite } from './queue-transition-ownership.mjs';
import { createGitHubQueueClient, gitBlobSha } from './github-queue-cas.mjs';
import { captionMatchesRecord, createInstagramClient } from './instagram-graph.mjs';

export const SOURCE = 'instagram_reconciliation_workflow';
// A publish run may be between media_publish and its own result write. Leave
// fresh attempts to that run; this is deferral, not a judgement about failure.
export const IN_FLIGHT_MINUTES = 15;
const NUMERIC_ID = /^[0-9]+$/;
const HISTORY_CAP = 50;

const validId = v => typeof v === 'string' && NUMERIC_ID.test(v);
const toIso = t => { const ms = Date.parse(String(t || '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')); return Number.isFinite(ms) ? new Date(ms).toISOString() : null; };

function earliestPossiblePost(record) {
  const stamps = [record.media_ready_at, record.timestamp].map(toIso).filter(Boolean).map(Date.parse);
  return stamps.length ? Math.min(...stamps) : null;
}

export function matchRecord(record, feed, { expectedUsername }) {
  const floor = earliestPossiblePost(record);
  if (floor == null) return { kind: 'no_time_bound' };
  const hits = feed.filter(m => captionMatchesRecord(m.caption, record))
    .filter(m => !expectedUsername || m.username === expectedUsername)
    .filter(m => { const t = toIso(m.timestamp); return t && Date.parse(t) >= floor - 60_000; });
  if (hits.length === 0) return { kind: 'no_match' };
  if (hits.length > 1) return { kind: 'duplicate_detected', media_ids: hits.map(h => h.id) };
  return { kind: 'match', media: hits[0] };
}

function withHistory(record, entry) {
  const history = Array.isArray(record.publish_attempt_history) ? record.publish_attempt_history : [];
  if (history.length >= HISTORY_CAP) return null; // only the Media Worker may trim history
  return [...history, entry];
}

// Returns the new record, or { skip: reason }.
export function reconcileRecord(record, feed, { now, expectedUsername }) {
  const status = record?.status;
  const byId = new Map(feed.map(m => [m.id, m]));

  if (status === 'published' && validId(record.instagram_media_id)) {
    if (record.instagram_permalink) return { skip: 'complete' };
    const m = byId.get(record.instagram_media_id);
    if (!m?.permalink) return { skip: 'permalink_not_in_feed_window' };
    const history = withHistory(record, { timestamp: now, stage: 'reconciliation', result: 'permalink_added',
      instagram_media_id: m.id, source: SOURCE });
    if (!history) return { skip: 'history_cap' };
    return { after: { ...record, instagram_permalink: m.permalink, publish_attempt_history: history } };
  }

  if (!['published', 'publishing', 'publish_unknown'].includes(status)) return { skip: 'not_reconcilable_status' };

  if (status !== 'published') {
    const started = Date.parse(toIso(record.publishing_started_at) || '');
    if (Number.isFinite(started) && Date.parse(now) - started < IN_FLIGHT_MINUTES * 60_000) return { skip: 'attempt_in_flight' };
  }

  const found = matchRecord(record, feed, { expectedUsername });
  if (found.kind !== 'match') return found.media_ids ? { skip: found.kind, media_ids: found.media_ids } : { skip: found.kind };
  const m = found.media;
  const history = withHistory(record, { timestamp: now, stage: 'reconciliation', result: 'positive_match',
    match: 'caption_prefix_exact', instagram_media_id: m.id, publish_attempt_id: record.publish_attempt_id || null, source: SOURCE });
  if (!history) return { skip: 'history_cap' };
  const after = { ...record, status: 'published', instagram_media_id: m.id,
    instagram_permalink: record.instagram_permalink || m.permalink || null, publish_attempt_history: history };
  if (!record.published_at) after.published_at = toIso(m.timestamp);
  return { after };
}

export function planReconciliation(entries, feed, { now = new Date().toISOString(), expectedUsername }) {
  const writes = [];
  const findings = [];
  for (const { queue_path, sha, record } of entries) {
    const r = reconcileRecord(record, feed, { now, expectedUsername });
    if (r.after) {
      const own = classifyQueueWrite(record, r.after);
      if (!own.ok) { findings.push({ content_id: record.content_id, finding: 'ownership_violation', violations: own.violations }); continue; }
      writes.push({ content_id: record.content_id, queue_path, sha, transition: own.transition,
        instagram_media_id: r.after.instagram_media_id, after: r.after });
    } else if (!['complete', 'not_reconcilable_status'].includes(r.skip)) {
      findings.push({ content_id: record.content_id, status: record.status, finding: r.skip, ...(r.media_ids ? { media_ids: r.media_ids } : {}) });
    }
  }
  return { generated_at: now, feed_items: feed.length, writes, findings };
}

export async function applyReconciliation(plan, { queue }) {
  const applied = [];
  const skipped = [];
  for (const w of plan.writes) {
    const current = await queue.read(w.queue_path);
    // Only write onto the exact snapshot the plan was built from.
    if (!current.exists || current.sha !== w.sha) { skipped.push({ content_id: w.content_id, reason: 'sha_changed' }); continue; }
    const r = await queue.write(w.queue_path, w.after, w.sha, `Instagram reconciliation: ${w.content_id} (${w.transition}, media ${w.instagram_media_id})`);
    (r.ok ? applied : skipped).push({ content_id: w.content_id, ...(r.ok ? { transition: w.transition } : { reason: r.reason }) });
  }
  return { applied, skipped };
}

function loadQueue(root) {
  const dir = path.join(root, 'queue');
  return fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort().map(filename => {
    const content = fs.readFileSync(path.join(dir, filename), 'utf8');
    return { queue_path: `queue/${filename}`, sha: gitBlobSha(content), record: JSON.parse(content) };
  });
}

async function main() {
  const expectedUsername = process.env.IG_USERNAME || 'matrix24global';
  const instagram = createInstagramClient({ accessToken: process.env.IG_READ_TOKEN });
  // Any read failure throws here, before a plan exists: nothing is written.
  const feed = await instagram.listRecentMedia({ maxItems: 100 });
  const plan = planReconciliation(loadQueue(process.cwd()), feed, { expectedUsername });
  const out = { ...plan, writes: plan.writes.map(({ after, ...w }) => w), apply: process.env.APPLY === 'true' };
  if (out.apply && plan.writes.length) {
    out.result = await applyReconciliation(plan, {
      queue: createGitHubQueueClient({ token: process.env.GH_TOKEN, repository: process.env.GITHUB_REPOSITORY })
    });
  }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  if (plan.findings.some(f => f.finding === 'duplicate_detected' || f.finding === 'ownership_violation')) process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    process.stdout.write(`${JSON.stringify({ ok: false, code: error.code || 'UNEXPECTED', error: String(error.message || error) }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
