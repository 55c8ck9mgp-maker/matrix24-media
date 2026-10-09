// Runner for claude-lane-alert.yml. Read-only over claude-lane/queue; its only
// writes are GitHub issue operations (open one alert, close it when clear).
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { findBlockers, readQueueRecords, issueTitle, issueBody, ALERT_LABEL } from './blocked-alert.mjs';

const REPO = process.env.GITHUB_REPOSITORY || '55c8ck9mgp-maker/matrix24-media';
const QUEUE = join(process.cwd(), 'claude-lane', 'queue');
const nowMs = Date.now();
const nowIso = new Date(nowMs).toISOString();

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', env: process.env }).trim();

const blockers = findBlockers(readQueueRecords(QUEUE), nowMs);
const openIssues = JSON.parse(gh('issue', 'list', '--repo', REPO, '--label', ALERT_LABEL, '--state', 'open', '--json', 'number'));

if (blockers.length === 0) {
  for (const i of openIssues) {
    gh('issue', 'close', String(i.number), '--repo', REPO, '--comment', `Sin registros bloqueados desde ${nowIso}. Cierro el aviso.`);
  }
  console.log('clear');
} else if (openIssues.length === 0) {
  try { gh('label', 'create', ALERT_LABEL, '--repo', REPO, '--color', 'B60205', '--description', 'Claude Lane bloqueado'); } catch { /* exists */ }
  const url = gh('issue', 'create', '--repo', REPO, '--label', ALERT_LABEL,
    '--title', issueTitle(blockers), '--body', issueBody(blockers, nowIso));
  console.log(`alert opened: ${url}`);
} else {
  console.log(`alert already open (#${openIssues[0].number}); blockers: ${blockers.map(b => b.content_id).join(', ')}`);
}
