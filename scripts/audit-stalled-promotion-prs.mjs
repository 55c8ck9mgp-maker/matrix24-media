// Observation only: reports approved promotion PRs that nobody has merged.
//
// The promotion controller opens "Queue approved promotion: <content_id>" and
// by design never merges it; a human must. The production-state audit only sees
// queue/ records, so an unmerged promotion PR is invisible to it (PR #67 sat
// unmerged for 25 hours on 2026-09-27 with every check green). This check reads
// open PRs and warns; it never merges, comments, closes or re-dispatches.

export const PROMOTION_PR_TITLE_PREFIX = 'Queue approved promotion: ';
export const DEFAULT_STALL_HOURS = 4;
const SAFE_CONTENT_ID = /^matrix24-[a-z0-9-]+$/;

export function evaluatePromotionMergeGate({ pr, changedFiles = [], queueRecord = null, checks = {} } = {}) {
  const reasons = [];
  if (!pr || pr.state !== 'open') reasons.push('pr_not_open');
  if (pr?.draft === true) reasons.push('pr_is_draft');
  if (pr?.base?.ref !== 'main') reasons.push('base_not_main');
  const title = typeof pr?.title === 'string' ? pr.title : '';
  const contentId = title.startsWith(PROMOTION_PR_TITLE_PREFIX) ? title.slice(PROMOTION_PR_TITLE_PREFIX.length).trim() : '';
  if (!SAFE_CONTENT_ID.test(contentId)) reasons.push('invalid_content_id');
  if (pr?.head?.ref !== `promotion/${contentId}`) reasons.push('unexpected_head_branch');
  const expectedPath = `queue/${contentId}.json`;
  if (changedFiles.length !== 1 || changedFiles[0] !== expectedPath) reasons.push('not_exactly_one_queue_file');
  if (!queueRecord || queueRecord.content_id !== contentId) reasons.push('queue_content_id_mismatch');
  if (queueRecord?.status !== 'blocked_media') reasons.push('queue_not_blocked_media');
  for (const key of ['media_claim','publish_attempt_id','instagram_media_id','instagram_permalink']) if (queueRecord?.[key]) reasons.push(`unexpected_${key}`);
  for (const key of ['promotion_guard','intake_guard','production_audit','ownership_audit']) if (checks[key] !== 'success') reasons.push(`${key}_not_green`);
  if (checks.queue_exists_on_main !== false) reasons.push('queue_exists_or_unknown_on_main');
  if (checks.head_matches_observed !== true) reasons.push('head_sha_not_pinned');
  if (checks.base_is_current_main !== true) reasons.push('base_not_current_main');
  return { eligible: reasons.length === 0, content_id: contentId || null, queue_path: expectedPath, reasons };
}

export function findStalledPromotionPRs(pulls = [], { now = Date.now(), thresholdHours = DEFAULT_STALL_HOURS } = {}) {
  const thresholdMs = thresholdHours * 60 * 60 * 1000;
  const stalled = [];
  for (const pr of pulls) {
    if (pr?.state !== 'open' || pr.base?.ref !== 'main') continue;
    if (typeof pr.title !== 'string' || !pr.title.startsWith(PROMOTION_PR_TITLE_PREFIX)) continue;
    const opened = Date.parse(pr.created_at);
    if (!Number.isFinite(opened)) continue;
    const ageMs = now - opened;
    if (ageMs < thresholdMs) continue;
    stalled.push({
      number: pr.number,
      content_id: pr.title.slice(PROMOTION_PR_TITLE_PREFIX.length).trim(),
      url: pr.html_url,
      draft: pr.draft === true,
      opened_at: pr.created_at,
      age_hours: Math.floor(ageMs / 36e5),
      threshold_hours: thresholdHours
    });
  }
  return stalled.sort((a, b) => b.age_hours - a.age_hours || a.number - b.number);
}

export async function fetchOpenPulls({ repository, token, fetchImpl = fetch, apiUrl = 'https://api.github.com' }) {
  const pulls = [];
  for (let page = 1; page <= 10; page++) {
    const response = await fetchImpl(`${apiUrl}/repos/${repository}/pulls?state=open&base=main&per_page=100&page=${page}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    });
    if (!response.ok) throw new Error(`GitHub pulls API returned HTTP ${response.status}`);
    const batch = await response.json();
    pulls.push(...batch);
    if (batch.length < 100) break;
  }
  return pulls;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    console.error('GITHUB_REPOSITORY is required');
    process.exit(2);
  }
  const envHours = Number(process.env.PROMOTION_STALL_HOURS);
  const thresholdHours = Number.isFinite(envHours) && envHours > 0 ? envHours : DEFAULT_STALL_HOURS;
  const pulls = await fetchOpenPulls({ repository, token: process.env.GITHUB_TOKEN });
  const stalled = findStalledPromotionPRs(pulls, { thresholdHours });
  console.log(JSON.stringify({ threshold_hours: thresholdHours, open_pulls: pulls.length, stalled_promotion_prs: stalled }, null, 2));
  for (const s of stalled) {
    console.log(`::warning title=Approved promotion waiting for merge::PR #${s.number} (${s.content_id}) has been open ${s.age_hours}h (threshold ${s.threshold_hours}h). A human must merge it: ${s.url}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY && stalled.length) {
    const { appendFileSync } = await import('node:fs');
    const rows = stalled.map(s => `| [#${s.number}](${s.url}) | \`${s.content_id}\` | ${s.age_hours}h |`).join('\n');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Approved promotions waiting for merge (> ${thresholdHours}h)\n\n| PR | Content | Open for |\n| --- | --- | --- |\n${rows}\n\nThe promotion controller never merges; nothing reaches the queue until a human merges these.\n`);
  }
}
