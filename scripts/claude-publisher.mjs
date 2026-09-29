// Claude Publisher: approval-gated Instagram publication (Publication plane).
//
// Replaces the ChatGPT Auto Publisher (disabled since INC-018). Two approval
// layers stand between a ready story and a public post:
//
//   Layer 1 (Claude): Claude reviews the "Publish request" issue opened by the
//     scheduled plan run, then dispatches the workflow in `publish` mode with the
//     content_id and the exact queue-record SHA it reviewed.
//   Layer 2 (owner): the publish job runs in the `instagram-production` GitHub
//     Environment, whose required reviewer is the project owner. Nothing runs,
//     and the Instagram publish token is not even readable, until the owner
//     approves that specific run in the Actions UI.
//
// Exactly-once rules enforced below (see docs/CLAUDE_PUBLISHER.md):
//   1. Only `ready_to_publish` records are eligible. Records already in
//      `publishing` / `publish_unknown` (including the legacy Metricool attempts)
//      are never touched: they belong to reconciliation.
//   2. The record must be byte-identical to what Claude reviewed (SHA match).
//   3. The account feed is read before sending; an existing post with the same
//      caption blocks the send. An incomplete read also blocks it.
//   4. The reservation (ready_to_publish -> publishing, new publish_attempt_id)
//      is a SHA-conditional write that lands BEFORE any Instagram call. If it
//      loses the race, nothing is sent.
//   5. media_publish is called at most once. Any outcome that is not a returned
//      media ID is written as publish_unknown and left for reconciliation. There
//      is no retry path in this file.
//   6. Every queue write is checked against the single-owner transition table
//      (queue-transition-ownership.mjs) before it is sent.
//
// Usage:
//   node scripts/claude-publisher.mjs plan              # read-only, prints plan JSON
//   node scripts/claude-publisher.mjs publish           # approved job only (env below)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assessReadyToPublish } from './publication-plane-policy.mjs';
import { classifyQueueWrite } from './queue-transition-ownership.mjs';
import { createGitHubQueueClient, gitBlobSha } from './github-queue-cas.mjs';
import { buildInstagramCaption, captionMatchesRecord, createInstagramClient } from './instagram-graph.mjs';

export const PROVIDER = 'instagram_graph';
export const SOURCE = 'claude_publisher_workflow';
const SAFE_ID = /^matrix24-[a-z0-9-]+$/;
const SHA = /^[0-9a-f]{40}$/;
const HISTORY_CAP = 50;

export class PublisherError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

function appendHistory(record, entry) {
  const history = Array.isArray(record.publish_attempt_history) ? [...record.publish_attempt_history] : [];
  if (history.length >= HISTORY_CAP) {
    // Only the Media Worker may drop old history entries; refuse rather than rewrite.
    throw new PublisherError('HISTORY_CAP_REACHED', record.content_id);
  }
  history.push(entry);
  return history;
}

export function buildInstagramPayload(record) {
  return { image_url: record.public_image_url, caption: buildInstagramCaption(record) };
}

// ready_to_publish -> publishing. The history entry records who approved what.
export function buildReservation(record, { attemptId, now, approval }) {
  return {
    ...record,
    status: 'publishing',
    publish_attempt_id: attemptId,
    publishing_started_at: now,
    provider: PROVIDER,
    publish_attempt_history: appendHistory(record, {
      timestamp: now,
      stage: 'publication',
      result: 'reservation_started',
      provider: PROVIDER,
      publish_attempt_id: attemptId,
      source: SOURCE,
      approval
    })
  };
}

// publishing -> published: requires the media ID Instagram returned.
export function buildPublished(reserved, { mediaId, permalink, now }) {
  return {
    ...reserved,
    status: 'published',
    instagram_media_id: mediaId,
    instagram_permalink: permalink || null,
    published_at: now,
    publish_attempt_history: appendHistory(reserved, {
      timestamp: now,
      stage: 'publication',
      result: 'success',
      provider: PROVIDER,
      publish_attempt_id: reserved.publish_attempt_id,
      instagram_media_id: mediaId,
      source: SOURCE
    })
  };
}

// publishing -> publish_unknown: media_publish may have reached Instagram.
export function buildUnknown(reserved, { reason, containerId, now }) {
  return {
    ...reserved,
    status: 'publish_unknown',
    publish_attempt_history: appendHistory(reserved, {
      timestamp: now,
      stage: 'publication',
      result: 'publish_unknown',
      reason,
      provider: PROVIDER,
      publish_attempt_id: reserved.publish_attempt_id,
      container_id: containerId || null,
      source: SOURCE
    })
  };
}

// publishing -> ready_to_publish: only when media_publish was provably never
// called (container creation or readiness failed). A new send still needs both
// approvals again; this is a release, not a retry.
export function buildRelease(reserved, { reason, now }) {
  const released = { ...reserved, status: 'ready_to_publish' };
  delete released.publish_attempt_id;
  delete released.publishing_started_at;
  delete released.provider;
  released.publish_attempt_history = appendHistory(reserved, {
    timestamp: now,
    stage: 'publication',
    result: 'action_not_invoked',
    reason,
    provider: PROVIDER,
    publish_attempt_id: reserved.publish_attempt_id,
    source: SOURCE
  });
  return released;
}

function assertOwned(before, after) {
  const r = classifyQueueWrite(before, after);
  if (!r.ok) throw new PublisherError('OWNERSHIP_VIOLATION', `${r.transition} ${r.violations.join(',')}`);
  return r;
}

// Unresolved attempts made by THIS publisher block new sends: if our own last
// attempt is ambiguous, something is wrong with this path and a human must look.
// Legacy Metricool attempts do not block (they are reconciled separately).
export function ownUnresolvedAttempts(records) {
  return records.filter(r => ['publishing', 'publish_unknown'].includes(r?.status) && r?.provider === PROVIDER)
    .map(r => r.content_id);
}

export function feedDuplicates(feed, record) {
  return feed.filter(m => captionMatchesRecord(m.caption, record)).map(m => m.id);
}

function loadQueue(root) {
  const dir = path.join(root, 'queue');
  return fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort().map(filename => {
    const content = fs.readFileSync(path.join(dir, filename), 'utf8');
    return { filename, queue_path: `queue/${filename}`, sha: gitBlobSha(content), record: JSON.parse(content) };
  });
}

// Read-only plan. Also serves as the dry run: every write the publish job would
// make for a candidate is built and checked against the ownership table here.
export function planPublication(root = process.cwd(), { now = new Date().toISOString() } = {}) {
  const entries = loadQueue(root);
  const candidates = [];
  const blocked = [];
  const unresolved = [];
  for (const { queue_path, sha, record } of entries) {
    if (['publishing', 'publish_unknown'].includes(record.status)) {
      unresolved.push({ content_id: record.content_id, status: record.status, provider: record.provider || null,
        publish_attempt_id: record.publish_attempt_id || null, action: 'reconciliation_only' });
      continue;
    }
    if (record.status !== 'ready_to_publish') continue;
    const gate = assessReadyToPublish(record, { readComplete: true, positiveDuplicate: false, currentSha: sha });
    if (gate.action !== 'reserve' || !SAFE_ID.test(record.content_id || '')) {
      blocked.push({ content_id: record.content_id, gate: gate.gate || 'content_id' });
      continue;
    }
    const approval = { simulated: true };
    const attemptId = '00000000-0000-4000-8000-000000000000';
    const reserved = buildReservation(record, { attemptId, now, approval });
    const simulation = {
      reserve: classifyQueueWrite(record, reserved),
      published: classifyQueueWrite(reserved, buildPublished(reserved, { mediaId: '1', permalink: null, now })),
      publish_unknown: classifyQueueWrite(reserved, buildUnknown(reserved, { reason: 'simulated', now })),
      release: classifyQueueWrite(reserved, buildRelease(reserved, { reason: 'simulated', now }))
    };
    const writesOk = Object.values(simulation).every(s => s.ok);
    const item = {
      content_id: record.content_id,
      queue_path,
      sha,
      headline: record.headline,
      caption_body: record.caption,
      payload: buildInstagramPayload(record),
      simulation: Object.fromEntries(Object.entries(simulation).map(([k, v]) => [k, { ok: v.ok, violations: v.violations }]))
    };
    (writesOk ? candidates : blocked).push(writesOk ? item : { content_id: record.content_id, gate: 'ownership_simulation', simulation: item.simulation });
  }
  const own = ownUnresolvedAttempts(entries.map(e => e.record));
  return {
    generated_at: now,
    mode: 'plan',
    publishing_blocked_by_own_unresolved_attempt: own,
    candidates,
    blocked,
    unresolved
  };
}

export function renderRequestIssue(item) {
  return [
    `<!-- claude-publisher:${item.content_id} -->`,
    `Publish request for \`${item.content_id}\`, opened by the scheduled Claude Publisher plan run. Nothing has been sent.`,
    '',
    `**Headline:** ${item.headline || '(none)'}`,
    `**Queue record:** \`${item.queue_path}\` at blob SHA \`${item.sha}\``,
    `**Image:** ${item.payload.image_url}`,
    '',
    '**Caption that would be posted:**',
    '```text',
    item.payload.caption.replace(/```/g, "'''"),
    '```',
    '',
    '### Approval',
    '1. Claude reviews this request and dispatches **Claude Publisher** with `mode=publish`, this `content_id` and `expected_sha` above, and `request_issue` set to this issue.',
    '2. The publish job then waits for the owner to approve the `instagram-production` deployment in the Actions run. Reject it there to cancel.',
    '',
    'If the queue record changes, the SHA above no longer matches and the publish run stops before anything is written or sent.'
  ].join('\n');
}

// Opens one "Publish request" issue per candidate (idempotent by title, open or
// closed, so a request the owner closed is not reopened every 30 min). Never
// closes or edits issues a human has touched; only creates missing ones.
export async function ensureRequestIssues(plan, { token, repository, fetchImpl = fetch, apiBase = 'https://api.github.com' }) {
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' };
  const res = await fetchImpl(`${apiBase}/repos/${repository}/issues?state=all&labels=publish-request&per_page=100`, { headers });
  if (!res.ok) throw new PublisherError('ISSUE_LIST_FAILED', String(res.status));
  const known = await res.json();
  const created = [];
  const existing = [];
  for (const item of plan.candidates) {
    const title = `Publish request: ${item.content_id}`;
    const found = known.find(i => i.title === title && !i.pull_request);
    if (found) { existing.push({ content_id: item.content_id, issue: found.number }); continue; }
    const c = await fetchImpl(`${apiBase}/repos/${repository}/issues`, {
      method: 'POST', headers,
      body: JSON.stringify({ title, body: renderRequestIssue(item), labels: ['publish-request'] })
    });
    if (!c.ok) throw new PublisherError('ISSUE_CREATE_FAILED', String(c.status));
    created.push({ content_id: item.content_id, issue: (await c.json()).number });
  }
  return { created, existing };
}

async function commentIssue({ token, repository, issue, body, fetchImpl = fetch, apiBase = 'https://api.github.com' }) {
  if (!/^[0-9]+$/.test(String(issue || ''))) return;
  try {
    await fetchImpl(`${apiBase}/repos/${repository}/issues/${issue}/comments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
      body: JSON.stringify({ body })
    });
  } catch {
    // Audit comment is best-effort; the queue history and run log are authoritative.
  }
}

/**
 * The approved publish run. Returns a result object; throws only before any
 * queue write. Each return value states exactly what was written and sent.
 */
export async function publishApproved({ contentId, expectedSha, approval, queue, instagram, localRecords = [],
  now = () => new Date().toISOString(), newAttemptId = () => crypto.randomUUID() }) {
  if (!SAFE_ID.test(contentId || '')) throw new PublisherError('CONTENT_ID_INVALID', String(contentId));
  if (!SHA.test(expectedSha || '')) throw new PublisherError('EXPECTED_SHA_INVALID');
  const own = ownUnresolvedAttempts(localRecords);
  if (own.length) return { result: 'blocked', gate: 'own_unresolved_attempt', records: own, sent: false, written: false };

  const queuePath = `queue/${contentId}.json`;
  const current = await queue.read(queuePath);
  if (!current.exists) return { result: 'blocked', gate: 'record_missing', sent: false, written: false };
  if (current.sha !== expectedSha) {
    return { result: 'blocked', gate: 'sha_changed_since_review', current_sha: current.sha, sent: false, written: false };
  }
  const record = current.record;

  // Pre-send duplicate check. An incomplete read is not evidence of absence.
  let feed;
  try {
    feed = await instagram.listRecentMedia({ maxItems: 100 });
  } catch (e) {
    return { result: 'blocked', gate: 'provider_read_incomplete', detail: e.code || 'error', sent: false, written: false };
  }
  const dupes = feedDuplicates(feed, record);
  const gate = assessReadyToPublish(record, { readComplete: true, positiveDuplicate: dupes.length > 0, currentSha: current.sha });
  if (gate.action !== 'reserve') {
    return { result: 'blocked', gate: gate.gate, duplicates: dupes, sent: false, written: false };
  }

  // Reservation: durable claim BEFORE any Instagram call.
  const attemptId = newAttemptId();
  const reserved = buildReservation(record, { attemptId, now: now(), approval });
  assertOwned(record, reserved);
  const w1 = await queue.write(queuePath, reserved, current.sha, `Claude Publisher: reserve ${contentId} (${attemptId})`);
  if (!w1.ok) {
    // A 'write_failed' may still have landed; either way nothing was sent, and the
    // record (if reserved) is visibly ours for the owner to release.
    return { result: 'blocked', gate: `reservation_${w1.reason}`, attempt_id: attemptId, sent: false, written: 'unknown' };
  }

  const finish = async (next, label) => {
    assertOwned(reserved, next);
    const w2 = await queue.write(queuePath, next, w1.sha, `Claude Publisher: ${label} ${contentId} (${attemptId})`);
    return w2.ok ? { ok: true } : { ok: false, reason: w2.reason };
  };

  // Private step: container. Failure here provably means nothing went public.
  const payload = buildInstagramPayload(record);
  const container = await instagram.createContainer({ imageUrl: payload.image_url, caption: payload.caption });
  if (container.ok) {
    const ready = await instagram.waitContainer(container.containerId);
    if (!ready.ok) Object.assign(container, { ok: false, reason: ready.reason });
  }
  if (!container.ok) {
    const w = await finish(buildRelease(reserved, { reason: container.reason, now: now() }), 'release (not sent)');
    return { result: 'not_sent', reason: container.reason, attempt_id: attemptId, sent: false, written: w.ok ? 'released' : `reserved_only:${w.reason}` };
  }

  // PUBLIC step. Called exactly once; never retried.
  const sent = await instagram.publishContainer(container.containerId);
  if (sent.outcome !== 'published') {
    const w = await finish(buildUnknown(reserved, { reason: sent.reason, containerId: container.containerId, now: now() }), 'publish_unknown');
    return { result: 'publish_unknown', reason: sent.reason, attempt_id: attemptId, sent: 'unknown', written: w.ok ? 'publish_unknown' : `reserved_only:${w.reason}` };
  }

  let permalink = null;
  try { permalink = (await instagram.getMedia(sent.mediaId))?.permalink || null; } catch { /* permalink is optional (invariant 7) */ }
  const w = await finish(buildPublished(reserved, { mediaId: sent.mediaId, permalink, now: now() }), 'published');
  return { result: 'published', media_id: sent.mediaId, permalink, attempt_id: attemptId, sent: true,
    written: w.ok ? 'published' : `reserved_only:${w.reason}` };
}

// Fail closed if the owner gate is not really there. GitHub silently creates an
// unprotected environment when a job names one that does not exist, so the job
// checks that `instagram-production` requires at least one reviewer.
export async function assertOwnerGate({ token, repository, environment = 'instagram-production', fetchImpl = fetch, apiBase = 'https://api.github.com' }) {
  const res = await fetchImpl(`${apiBase}/repos/${repository}/environments/${environment}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' }
  });
  if (!res.ok) throw new PublisherError('OWNER_GATE_UNREADABLE', String(res.status));
  const env = await res.json();
  const rule = (env.protection_rules || []).find(r => r.type === 'required_reviewers');
  if (!rule || !Array.isArray(rule.reviewers) || rule.reviewers.length === 0) {
    throw new PublisherError('OWNER_GATE_MISSING', `${environment} has no required reviewers`);
  }
  return { environment, reviewers: rule.reviewers.map(r => r.reviewer?.login || r.reviewer?.name || r.type) };
}

async function annotateFeedDuplicates(plan) {
  if (!process.env.IG_READ_TOKEN || !plan.candidates.length) return;
  try {
    const feed = await createInstagramClient({ accessToken: process.env.IG_READ_TOKEN }).listRecentMedia({ maxItems: 100 });
    for (const c of plan.candidates) c.feed_duplicates = feedDuplicates(feed, { caption: c.caption_body });
    plan.feed_check = 'complete';
  } catch (e) {
    plan.feed_check = `unavailable:${e.code || 'error'}`;
  }
}

async function main() {
  const mode = process.argv[2];
  const root = process.cwd();
  if (mode === 'plan') {
    const plan = planPublication(root);
    await annotateFeedDuplicates(plan);
    if (process.env.OPEN_REQUEST_ISSUES === 'true' && plan.candidates.length) {
      plan.issues = await ensureRequestIssues(plan, { token: process.env.GH_TOKEN, repository: process.env.GITHUB_REPOSITORY });
    }
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  if (mode === 'publish') {
    const repository = process.env.GITHUB_REPOSITORY;
    const token = process.env.GH_TOKEN;
    await assertOwnerGate({ token, repository });
    const approval = {
      claude_dispatch_actor: process.env.DISPATCH_ACTOR || null,
      owner_gate: 'github_environment:instagram-production',
      workflow_run_id: process.env.GITHUB_RUN_ID || null,
      request_issue: process.env.REQUEST_ISSUE || null,
      reviewed_sha: process.env.EXPECTED_SHA || null
    };
    const result = await publishApproved({
      contentId: process.env.CONTENT_ID,
      expectedSha: process.env.EXPECTED_SHA,
      approval,
      queue: createGitHubQueueClient({ token, repository }),
      instagram: createInstagramClient({ accessToken: process.env.IG_PUBLISH_TOKEN, igUserId: process.env.IG_USER_ID }),
      localRecords: loadQueue(root).map(e => e.record)
    });
    await commentIssue({ token, repository, issue: process.env.REQUEST_ISSUE,
      body: `Claude Publisher run ${process.env.GITHUB_RUN_ID || ''}: \`${result.result}\`\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`` });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    // Anything but a clean publish needs a human to look, so the run goes red.
    if (!(result.result === 'published' && result.written === 'published')) process.exitCode = 2;
    return;
  }
  throw new PublisherError('USAGE', 'mode must be plan or publish');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    process.stdout.write(`${JSON.stringify({ ok: false, code: error.code || 'UNEXPECTED', error: String(error.message || error) }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
