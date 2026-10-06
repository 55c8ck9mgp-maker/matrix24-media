#!/usr/bin/env node
// Claude Lane publisher entrypoint. Step 2: DRY-RUN ONLY. Live mode is refused
// here until the GitHub write store and its review land (docs/CLAUDE_LANE.md).
import fs from 'node:fs';
import path from 'node:path';
import { createInstagramClient } from '../instagram-graph.mjs';
import { runPublisher } from './publisher.mjs';

export const LANE_DIR = 'claude-lane/queue';

export function fsReadOnlyStore(dir = LANE_DIR) {
  if (path.normalize(dir).replace(/\/$/, '') !== LANE_DIR) throw new Error('LANE_STORE_OUTSIDE_LANE_DIR');
  return {
    async list() {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter(f => f.endsWith('.json'))
        .map(f => ({ record: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), sha: null }));
    },
    async write() { throw new Error('READ_ONLY_STORE'); },
  };
}

export function loadOthers(dirs = ['queue', 'editorial/verified']) {
  const out = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter(x => x.endsWith('.json'))) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
        out.push({ id: r.content_id || f, headline: r.headline, source_urls: r.verified_source_urls || r.source_urls || [] });
      } catch { /* unreadable core record: ignored for dedupe, never written */ }
    }
  }
  return out;
}

async function main() {
  const mode = process.env.CLAUDE_LANE_MODE || 'dry-run';
  if (mode !== 'dry-run') { console.log(JSON.stringify({ outcome: 'live_not_wired' })); process.exit(1); }
  const token = process.env.IG_CLAUDE_ACCESS_TOKEN;
  const igUserId = process.env.IG_CLAUDE_USER_ID;
  const ig = createInstagramClient({ accessToken: token, igUserId });
  const readQuota = async () => {
    const res = await fetch(`https://graph.instagram.com/v23.0/${igUserId}/content_publishing_limit?fields=config,quota_usage`,
      { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`QUOTA_HTTP_${res.status}`);
    const body = await res.json();
    const d = body?.data?.[0];
    return { total: Number(d?.config?.quota_total), used: Number(d?.quota_usage) };
  };
  const result = await runPublisher({ mode, store: fsReadOnlyStore(), ig, readQuota, others: loadOthers() });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.log(JSON.stringify({ outcome: 'error', error: e.message })); process.exit(1); });
