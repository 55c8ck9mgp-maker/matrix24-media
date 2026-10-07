#!/usr/bin/env node
// Claude Lane — Facebook Page mirror entrypoint (.github/workflows/claude-lane-facebook.yml).
// Live only when BOTH repository variables set by Justen are exactly "true":
// CLAUDE_LANE_ENABLED (the whole lane) and CLAUDE_LANE_FB_ENABLED (Facebook).
// Otherwise it is a dry run: it checks the Page access and the token expiry and
// reports what it would post, without writing anything or posting.
import { createFacebookClient, runFacebook, TOKEN_WARN_DAYS } from './facebook.mjs';
import { createGitStore } from './git-store.mjs';
import { fsReadOnlyStore } from './run-publisher.mjs';

const LIVE = process.env.CLAUDE_LANE_ENABLED === 'true' && process.env.CLAUDE_LANE_FB_ENABLED === 'true';
const GHA = Boolean(process.env.GITHUB_ACTIONS);
const log = (stage, obj, level = 'notice') => {
  const line = JSON.stringify({ stage, live: LIVE, ...obj });
  console.log(line);
  if (GHA) console.log(`::${level} title=facebook ${stage}::${line.replace(/\n/g, ' ').slice(0, 900)}`);
};

async function main() {
  const userToken = process.env.FB_CLAUDE_USER_TOKEN;
  const pageId = process.env.FB_PAGE_ID;
  if (GHA && userToken) console.log(`::add-mask::${userToken}`);
  const fb = createFacebookClient({ userToken, pageId, onSecret: s => { if (GHA) console.log(`::add-mask::${s}`); } });

  try {
    const info = await fb.tokenInfo();
    const daysLeft = info.ok && info.expires_at ? Math.floor((info.expires_at * 1000 - Date.now()) / 86400000) : null;
    const expiresAt = info.ok ? (info.expires_at ? new Date(info.expires_at * 1000).toISOString() : 'never') : null;
    log('token', { ok: info.ok, valid: info.valid ?? null, expires_at: expiresAt, days_left: daysLeft, reason: info.reason ?? null },
      daysLeft != null && daysLeft < TOKEN_WARN_DAYS ? 'warning' : 'notice');
  } catch (e) {
    log('token', { ok: false, reason: 'token_info_error' }, 'warning');
  }

  const result = await runFacebook({ mode: LIVE ? 'live' : 'dry-run', enabled: LIVE, store: LIVE ? createGitStore() : fsReadOnlyStore(), fb });
  const bad = ['page_access_error', 'claim_conflict', 'facebook_record_write_failed', 'facebook_publish_unknown', 'facebook_failed'].includes(result.outcome);
  log('facebook', result, bad ? 'warning' : 'notice');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { log('fatal', { error: String(e.message).slice(0, 200) }, 'error'); process.exit(1); });
