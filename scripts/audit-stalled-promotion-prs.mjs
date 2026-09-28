// Observation only: reports approved promotion PRs that nobody has merged.
//
// The promotion controller opens "Queue approved promotion: <content_id>" and
// by design never merges it; a human must. The production-state audit only sees
// queue/ records, so an unmerged promotion PR is invisible to it (PR #67 sat
// unmerged for 25 hours on 2026-09-27 with every check green). This check reads
// open PRs and warns; it never merges, comments, closes or re-dispatches.

export const PROMOTION_PR_TITLE_PREFIX = 'Queue approved promotion: ';
export const DEFAULT_STALL_HOURS = 4;

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
