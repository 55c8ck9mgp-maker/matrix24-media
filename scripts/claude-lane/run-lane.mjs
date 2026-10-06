#!/usr/bin/env node
// Claude Lane pipeline: reconcile -> produce one story -> publish one story.
// Writes and publishing happen ONLY when CLAUDE_LANE_ENABLED is exactly "true"
// (repository variable set by Justen). Otherwise every stage is a dry run: the
// draft and its card are written to $LANE_OUT for inspection and nothing is
// committed or posted.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createInstagramClient } from '../instagram-graph.mjs';
import { validateLaneRecord } from './lane-record.mjs';
import { runPublisher, DAILY_CAP } from './publisher.mjs';
import { reconcile } from './reconcile.mjs';
import { createGitStore } from './git-store.mjs';
import { fsReadOnlyStore, loadOthers } from './run-publisher.mjs';
import { FEEDS, parseFeed, consensus, pickCandidate, buildPrompt, callModel, guardFacts, toRecord } from './research.mjs';
import { mediaUrl, mediaPath } from './media-url.mjs';

const LIVE = process.env.CLAUDE_LANE_ENABLED === 'true';
const OUT = process.env.LANE_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'lane-'));
const log = (stage, obj) => {
  const line = JSON.stringify({ stage, live: LIVE, ...obj });
  console.log(line);
  // GitHub annotation so the outcome is readable from the public checks API
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=lane ${stage}::${line.replace(/\n/g, ' ').slice(0, 900)}`);
};

export function renderCard(record) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'card-'));
  const inp = path.join(tmp, 'r.json'); const out = path.join(tmp, 'c.jpg');
  fs.writeFileSync(inp, JSON.stringify(record));
  execFileSync('python3', ['scripts/claude-lane/render_card.py', inp, out]);
  return fs.readFileSync(out);
}

async function produce(store, now) {
  const entries = await store.list();
  if (entries.some(e => ['draft', 'ready_to_publish'].includes(e.record.status))) return { outcome: 'backlog_present' };
  const today = now.toISOString().slice(0, 10);
  if (entries.filter(e => e.record.created_at.startsWith(today)).length >= DAILY_CAP) return { outcome: 'daily_cap' };

  const cutoff = now.getTime() - 12 * 3600 * 1000;
  const items = [];
  for (const feed of FEEDS) {
    try {
      const r = await fetch(feed.url, { headers: { 'user-agent': 'MATRIX24-ClaudeLane/1.0' } });
      if (r.ok) items.push(...parseFeed(await r.text(), feed, cutoff));
    } catch { /* a missing feed only narrows discovery */ }
  }
  const others = [...loadOthers(), ...entries.map(e => ({ id: e.record.content_id, headline: e.record.headline, source_urls: e.record.source_urls }))];
  const candidate = pickCandidate(consensus(items), others);
  if (!candidate) return { outcome: 'no_candidate', items: items.length };

  const draft = await callModel(buildPrompt(candidate), { token: process.env.GITHUB_TOKEN, model: process.env.LANE_MODEL || undefined });
  const problems = guardFacts(draft, candidate);
  if (problems.length) return { outcome: 'draft_rejected', problems, headline: candidate.headline };
  const record = toRecord(draft, candidate, now);
  const errs = validateLaneRecord(record);
  if (errs.length) return { outcome: 'draft_invalid', errors: errs };
  if (entries.some(e => e.record.content_id === record.content_id)) return { outcome: 'id_exists' };

  const jpg = renderCard(record);
  const ready = { ...record, status: 'ready_to_publish', image_url: mediaUrl(record.content_id),
    history: [...record.history, { at: now.toISOString(), event: 'rendered' }] };
  if (validateLaneRecord(ready).length) return { outcome: 'ready_invalid', errors: validateLaneRecord(ready) };

  if (!LIVE) {
    fs.writeFileSync(path.join(OUT, `${record.content_id}.json`), JSON.stringify(ready, null, 2));
    fs.writeFileSync(path.join(OUT, `${record.content_id}.jpg`), jpg);
    return { outcome: 'would_create', content_id: record.content_id, headline_es: record.headline_es };
  }
  const w1 = await store.write(record, null, `claude-lane: draft ${record.content_id}`);
  if (!w1.ok) return { outcome: 'draft_write_failed' };
  const w2 = await store.write(ready, w1.sha, `claude-lane: render ${record.content_id}`, [{ path: mediaPath(record.content_id), buffer: jpg }]);
  return { outcome: w2.ok ? 'created' : 'render_write_failed', content_id: record.content_id };
}

async function main() {
  const now = new Date();
  const store = LIVE ? createGitStore() : fsReadOnlyStore();
  const token = process.env.IG_CLAUDE_ACCESS_TOKEN;
  const igUserId = process.env.IG_CLAUDE_USER_ID;
  const ig = createInstagramClient({ accessToken: token, igUserId });
  const readQuota = async () => {
    const res = await fetch(`https://graph.instagram.com/v23.0/${igUserId}/content_publishing_limit?fields=config,quota_usage`,
      { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`QUOTA_HTTP_${res.status}`);
    const d = (await res.json())?.data?.[0];
    return { total: Number(d?.config?.quota_total), used: Number(d?.quota_usage) };
  };

  log('reconcile', await reconcile({ store, ig, live: LIVE }));
  let produced;
  try { produced = await produce(store, now); } catch (e) { produced = { outcome: 'produce_error', error: e.message }; }
  log('produce', produced);
  if (LIVE && produced.outcome === 'created') await new Promise(r => setTimeout(r, 30000)); // let raw.githubusercontent serve the new JPEG
  const published = await runPublisher({ mode: LIVE ? 'live' : 'dry-run', enabled: LIVE, store, ig, readQuota, others: loadOthers() });
  log('publish', published.caption ? { ...published, caption: `${published.caption.slice(0, 80)}…` } : published);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { log('fatal', { error: e.message }); process.exit(1); });
