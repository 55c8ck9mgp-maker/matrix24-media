#!/usr/bin/env node
// Claude Lane pipeline: reconcile -> adopt one Claude-written draft -> publish one story.
// (GitHub Models returned a bare "OK" to every request on 2026-10-06, so drafts are
// written by Claude's scheduled research task instead; research.mjs is kept for its
// tested discovery and fact-guard helpers.)
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
import { runPublisher } from './publisher.mjs';
import { reconcile } from './reconcile.mjs';
import { createGitStore } from './git-store.mjs';
import { fsReadOnlyStore, loadOthers } from './run-publisher.mjs';
import { mediaUrl, mediaPath } from './media-url.mjs';

const LIVE = process.env.CLAUDE_LANE_ENABLED === 'true';
const OUT = process.env.LANE_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'lane-'));
const log = (stage, obj) => {
  const line = JSON.stringify({ stage, live: LIVE, ...obj });
  console.log(line);
  // GitHub annotation so the outcome is readable from the public checks API
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=lane ${stage}::${line.replace(/\n/g, ' ').slice(0, 900)}`);
};

export { produce };
export function renderCard(record) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'card-'));
  const inp = path.join(tmp, 'r.json'); const out = path.join(tmp, 'c.jpg');
  fs.writeFileSync(inp, JSON.stringify(record));
  execFileSync('python3', ['scripts/claude-lane/render_card.py', inp, out]);
  return fs.readFileSync(out);
}

export const DRAFTS_BRANCH = 'claude/lane-drafts';
export const DRAFTS_DIR = 'claude-lane/drafts';
const gitOut = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// Drafts written by Claude's scheduled research task live on DRAFTS_BRANCH under
// DRAFTS_DIR. The pipeline adopts at most one new draft per run into the lane
// queue on main, renders its card and marks it ready_to_publish.
export function readBranchDrafts() {
  try { gitOut(['fetch', '-q', 'origin', `${DRAFTS_BRANCH}:refs/remotes/origin/${DRAFTS_BRANCH}`]); } catch { return []; }
  let names = [];
  try { names = gitOut(['ls-tree', '--name-only', `origin/${DRAFTS_BRANCH}`, `${DRAFTS_DIR}/`]).split('\n').filter(n => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names) {
    try { out.push(JSON.parse(gitOut(['show', `origin/${DRAFTS_BRANCH}:${n}`]))); } catch { /* unreadable draft skipped */ }
  }
  return out.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

export function adoptDraft(raw, now) {
  // Only content fields are taken from the draft; state fields are reset here.
  const keep = ['lane', 'content_id', 'created_at', 'category', 'headline', 'headline_es', 'caption_es', 'caption_en', 'source_urls', 'source_names', 'hashtags'];
  const rec = Object.fromEntries(keep.filter(k => raw?.[k] !== undefined).map(k => [k, raw[k]]));
  return { ...rec, status: 'draft', image_url: null, publish_attempt_id: null, ig_media_id: null,
    history: [{ at: now.toISOString(), event: 'adopted_from_drafts_branch' }] };
}

async function produce(store, now, drafts = readBranchDrafts()) {
  const entries = await store.list();
  if (entries.some(e => ['draft', 'ready_to_publish'].includes(e.record.status))) return { outcome: 'backlog_present' };

  const known = new Set(entries.map(e => e.record.content_id));
  const rejected = [];
  for (const raw of drafts) {
    if (!raw || known.has(raw.content_id)) continue;
    const record = adoptDraft(raw, now);
    const errs = validateLaneRecord(record);
    if (errs.length) { rejected.push({ id: raw.content_id, errs }); continue; }
    if (Date.parse(record.created_at) < now.getTime() - 24 * 3600 * 1000) { rejected.push({ id: raw.content_id, errs: ['STALE_DRAFT'] }); continue; }
    const jpg = renderCard(record);
    const ready = { ...record, status: 'ready_to_publish', image_url: mediaUrl(record.content_id),
      history: [...record.history, { at: now.toISOString(), event: 'rendered' }] };
    if (!LIVE) {
      fs.writeFileSync(path.join(OUT, `${record.content_id}.json`), JSON.stringify(ready, null, 2));
      fs.writeFileSync(path.join(OUT, `${record.content_id}.jpg`), jpg);
      return { outcome: 'would_create', content_id: record.content_id, headline_es: record.headline_es, rejected };
    }
    const w1 = await store.write(record, null, `claude-lane: adopt draft ${record.content_id}`);
    if (!w1.ok) return { outcome: 'draft_write_failed', rejected };
    const w2 = await store.write(ready, w1.sha, `claude-lane: render ${record.content_id}`, [{ path: mediaPath(record.content_id), buffer: jpg }]);
    return { outcome: w2.ok ? 'created' : 'render_write_failed', content_id: record.content_id, rejected };
  }
  return { outcome: drafts.length ? 'no_new_valid_draft' : 'no_drafts', rejected };
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
