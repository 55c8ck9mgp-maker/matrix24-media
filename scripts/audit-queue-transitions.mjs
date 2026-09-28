// Replays every commit that touched queue/*.json in <base>..<head> and checks each
// write against the single-owner transition policy. Observation only: it never
// writes, reverts, retries or changes a scheduler. Exit code 1 on any violation.
//
// Usage: node scripts/audit-queue-transitions.mjs <base-ref> [head-ref]
import { execFileSync } from 'node:child_process';
import { classifyQueueWrite } from './queue-transition-ownership.mjs';

const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

function readAt(rev, path) {
  try { return JSON.parse(git(['show', `${rev}:${path}`])); }
  catch { return null; }
}

export function auditQueueTransitions(base, head = 'HEAD') {
  const range = base ? `${base}..${head}` : head;
  const commits = git(['rev-list', '--reverse', '--no-merges', range, '--', 'queue/']).split('\n').filter(Boolean);
  const writes = [];
  for (const commit of commits) {
    const parent = git(['rev-list', '--parents', '-n', '1', commit]).trim().split(' ')[1] || null;
    const files = git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit, '--', 'queue/'])
      .split('\n').filter(f => /^queue\/[^/]+\.json$/.test(f));
    const planes = new Set();
    for (const path of files) {
      const before = parent ? readAt(parent, path) : null;
      const after = readAt(commit, path);
      const result = classifyQueueWrite(before, after);
      if (result.plane) planes.add(result.plane);
      writes.push({ commit: commit.slice(0, 12), path, ...result });
    }
    // One commit is one scheduler run: it may not act as two planes at once.
    if (planes.size > 1) {
      writes.push({ commit: commit.slice(0, 12), path: null, ok: false, plane: null, transition: null,
        violations: [`multi_plane_commit:${[...planes].sort().join('+')}`], warnings: [] });
    }
  }
  const violations = writes.filter(w => !w.ok);
  return { ok: violations.length === 0, commits: commits.length, writes: writes.length, violations,
    warnings: writes.filter(w => w.warnings?.length).map(({ commit, path, plane, warnings }) => ({ commit, path, plane, warnings })) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [base, head] = process.argv.slice(2);
  const result = auditQueueTransitions(base, head || 'HEAD');
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
