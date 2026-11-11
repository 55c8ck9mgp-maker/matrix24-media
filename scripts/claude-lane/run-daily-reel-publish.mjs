#!/usr/bin/env node
// CLI for the daily Reel publisher (scripts/claude-lane/daily-reel-publish.mjs).
//   --check   read-only gate (after reconciling, when live): writes proceed=true|false
//             to $GITHUB_OUTPUT so the workflow skips the render when the day is done,
//             the lane is blocked, or spacing applies.
//   (default) publish $LANE_OUT/<id>.mp4 + <id>.jpg as today's daily Reel.
// Live only when CLAUDE_LANE_ENABLED is exactly "true"; otherwise a dry run.
import fs from 'node:fs';
import path from 'node:path';
import { createInstagramClient } from '../instagram-graph.mjs';
import { createGitStore } from './git-store.mjs';
import { fsReadOnlyStore } from './run-publisher.mjs';
import { reconcile } from './reconcile.mjs';
import { mediaPath, mediaUrl, REPO } from './media-url.mjs';
import { PUBLISH_SETTLE_MS } from './publisher.mjs';
import { buildDailyReelRecord, dailyReelId, preflight, runDailyReelPublish } from './daily-reel-publish.mjs';

const LIVE = process.env.CLAUDE_LANE_ENABLED === 'true';
const OUT = process.env.LANE_OUT;
const log = (stage, obj) => {
  const line = JSON.stringify({ stage, live: LIVE, ...obj });
  console.log(line);
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=lane daily-reel ${stage}::${line.replace(/\n/g, ' ').slice(0, 900)}`);
};
const setOutput = (k, v) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };

async function main() {
  const now = Date.now();
  // The build step passes the id it rendered, so a run that straddles midnight
  // UTC still publishes the files it built (and is gated on that same day).
  const contentId = process.env.DAILY_REEL_ID || dailyReelId(now);
  if (!/^claude-\d{8}-daily-reel$/.test(contentId)) throw new Error('BAD_DAILY_REEL_ID');
  const store = LIVE ? createGitStore() : fsReadOnlyStore();
  const token = process.env.IG_CLAUDE_ACCESS_TOKEN;
  const igUserId = process.env.IG_CLAUDE_USER_ID;
  const haveToken = typeof token === 'string' && token.trim().length >= 20;
  const ig = haveToken ? createInstagramClient({ accessToken: token, igUserId }) : null;

  if (process.argv.includes('--check')) {
    if (ig) log('reconcile', await reconcile({ store, ig, live: LIVE }));
    const gate = preflight(await store.list(), { contentId, now });
    log('preflight', gate);
    setOutput('proceed', gate.proceed ? 'true' : 'false');
    return;
  }

  if (!OUT) throw new Error('LANE_OUT_REQUIRED');
  const meta = JSON.parse(fs.readFileSync(path.join(OUT, `${contentId}.json`), 'utf8'));
  const mp4 = path.join(OUT, `${contentId}.mp4`);
  const jpg = path.join(OUT, `${contentId}.jpg`);
  const videoPath = `claude-lane/media/reels/${contentId}.mp4`;
  const record = buildDailyReelRecord({
    contentId, createdAt: meta.created_at, stories: meta.stories || [], totalSeconds: meta.total_seconds,
    videoUrl: `https://raw.githubusercontent.com/${REPO}/main/${videoPath}`, imageUrl: mediaUrl(contentId),
  });
  const files = [{ path: videoPath, buffer: fs.readFileSync(mp4) }, { path: mediaPath(contentId), buffer: fs.readFileSync(jpg) }];
  if (LIVE && !ig) throw new Error('MISSING_ACCESS_TOKEN');
  const readQuota = async () => {
    const res = await fetch(`https://graph.instagram.com/v23.0/${igUserId}/content_publishing_limit?fields=config,quota_usage`,
      { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`QUOTA_HTTP_${res.status}`);
    const d = (await res.json())?.data?.[0];
    return { total: Number(d?.config?.quota_total), used: Number(d?.quota_usage) };
  };
  const result = await runDailyReelPublish({
    mode: LIVE ? 'live' : 'dry-run', enabled: LIVE, store, ig,
    readQuota: LIVE ? readQuota : async () => ({ total: 100, used: 0 }),
    record, files, now, cdnWaitMs: 30000, settleMs: PUBLISH_SETTLE_MS,
  });
  log('publish', result.caption ? { ...result, caption: `${result.caption.slice(0, 120)}…` } : result);
  if (!['published', 'would_publish', 'already_exists', 'spacing'].includes(result.outcome)) process.exitCode = 1;
}

main().catch(e => { log('fatal', { error: e.message }); process.exit(1); });
