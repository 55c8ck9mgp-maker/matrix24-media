#!/usr/bin/env node
// Claude Lane growth observer (docs/CLAUDE_LANE.md "Growth observer").
// READ-ONLY: calls only GET endpoints of the Instagram Graph API with the
// lane token. It never publishes, reserves, claims, retries, or writes to the
// repository, queue, or any secret. Output goes to the job summary only.
// The token is used as a header and is never printed.

export const GRAPH = 'https://graph.instagram.com/v23.0';
export const DEFAULT_IG_USER_ID = '17841423605720355'; // @matrix24global (not a secret)
export const WINDOW_DAYS = 30;
export const MAX_MEDIA = 100;

// Pure: turns raw media rows + per-media insights into a summary object.
// `items` = [{ id, timestamp, media_type, permalink, like_count, comments_count,
//              reach, saved, shares }]; insight fields may be null (unavailable).
export function summarize(items, { now = Date.now(), windowDays = WINDOW_DAYS } = {}) {
  const cutoff = now - windowDays * 86400_000;
  const recent = items.filter(i => i && Date.parse(i.timestamp) >= cutoff);
  const num = v => (Number.isFinite(v) ? v : 0);
  const avg = (arr, f) => (arr.length ? Math.round((arr.reduce((s, x) => s + num(f(x)), 0) / arr.length) * 10) / 10 : 0);

  const byType = {};
  for (const i of recent) {
    const t = i.media_type ?? 'UNKNOWN';
    (byType[t] ??= []).push(i);
  }
  const typeStats = Object.fromEntries(Object.entries(byType).map(([t, list]) => [t, {
    posts: list.length,
    avg_reach: avg(list, x => x.reach),
    avg_saved: avg(list, x => x.saved),
    avg_shares: avg(list, x => x.shares),
    avg_likes: avg(list, x => x.like_count),
  }]));

  const top = [...recent]
    .sort((a, b) => num(b.reach) - num(a.reach) || num(b.saved) - num(a.saved))
    .slice(0, 5)
    .map(x => ({ timestamp: x.timestamp, media_type: x.media_type, reach: num(x.reach), saved: num(x.saved), shares: num(x.shares), permalink: x.permalink ?? null }));

  return {
    window_days: windowDays,
    posts: recent.length,
    posts_per_day: Math.round((recent.length / windowDays) * 10) / 10,
    avg_reach: avg(recent, x => x.reach),
    avg_saved: avg(recent, x => x.saved),
    avg_shares: avg(recent, x => x.shares),
    insights_missing: recent.filter(x => x.reach == null).length,
    by_type: typeStats,
    top,
  };
}

export function toMarkdown(s, { followers = null, generatedAt = new Date().toISOString() } = {}) {
  const lines = [
    `# Claude Lane — growth observer (read-only)`,
    ``,
    `Generated ${generatedAt}. Window: last ${s.window_days} days.`,
    ``,
    `- Followers: ${followers ?? 'unavailable'}`,
    `- Posts in window: ${s.posts} (${s.posts_per_day}/day)`,
    `- Average reach per post: ${s.avg_reach}`,
    `- Average saves per post: ${s.avg_saved}`,
    `- Average shares per post: ${s.avg_shares}`,
    `- Posts without insights: ${s.insights_missing}`,
    ``,
    `## By format`,
    ...Object.entries(s.by_type).map(([t, v]) => `- ${t}: ${v.posts} posts, reach ${v.avg_reach}, saves ${v.avg_saved}, shares ${v.avg_shares}`),
    ``,
    `## Top 5 by reach`,
    ...s.top.map(t => `- ${t.timestamp} ${t.media_type}: reach ${t.reach}, saves ${t.saved}, shares ${t.shares}${t.permalink ? ` — ${t.permalink}` : ''}`),
    ``,
    `This report changes nothing. Decisions on volume, format or language stay with the owner.`,
  ];
  return lines.join('\n');
}

async function getJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET failed with HTTP ${res.status}`);
  return res.json();
}

// Parses an /insights response into { reach, saved, shares }; missing -> null.
export function parseInsights(body) {
  const out = { reach: null, saved: null, shares: null };
  for (const m of body?.data ?? []) {
    const v = m?.values?.[0]?.value ?? m?.total_value?.value;
    if (m?.name in out && Number.isFinite(v)) out[m.name] = v;
  }
  return out;
}

async function main() {
  const token = process.env.IG_CLAUDE_ACCESS_TOKEN;
  if (!token) { console.log('secret_missing'); process.exit(1); }
  const userId = process.env.CLAUDE_LANE_IG_USER_ID || DEFAULT_IG_USER_ID;

  const profile = await getJson(`${GRAPH}/${userId}?fields=followers_count`, token);
  const list = await getJson(`${GRAPH}/${userId}/media?fields=id,timestamp,media_type,permalink,like_count,comments_count&limit=${MAX_MEDIA}`, token);
  const items = [];
  for (const m of (list.data ?? []).slice(0, MAX_MEDIA)) {
    let ins = { reach: null, saved: null, shares: null };
    try {
      ins = parseInsights(await getJson(`${GRAPH}/${m.id}/insights?metric=reach,saved,shares`, token));
    } catch { /* leave null: one post's insights never fail the report */ }
    items.push({ ...m, ...ins });
  }
  const s = summarize(items);
  const md = toMarkdown(s, { followers: profile.followers_count ?? null });
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(summaryPath, md + '\n');
  }
  console.log(md);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.log(`growth_report_failed: ${e.message}`); process.exit(1); });
