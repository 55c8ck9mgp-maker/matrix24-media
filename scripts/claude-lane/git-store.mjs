// Git-backed store for claude-lane/queue/ used by the pipeline workflow.
// write() is compare-and-swap on the file's git blob hash, commits only paths
// under claude-lane/, and returns ok only after the commit is on origin/main.
// A claim that cannot be pushed is reported as a conflict, so the publisher never
// calls Instagram on a claim that is not durable (docs/CLAUDE_LANE.md rule 3).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const LANE_ROOT = 'claude-lane/';
const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();

export function blobHash(file) {
  return fs.existsSync(file) ? git(['hash-object', file]) : null;
}

export function createGitStore({ dir = 'claude-lane/queue', push = true, maxPushAttempts = 3 } = {}) {
  if (!path.normalize(dir).startsWith(LANE_ROOT)) throw new Error('LANE_STORE_OUTSIDE_LANE_DIR');
  const fileOf = id => path.join(dir, `${id}.json`);
  return {
    async list() {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
        const p = path.join(dir, f);
        return { record: JSON.parse(fs.readFileSync(p, 'utf8')), sha: blobHash(p) };
      });
    },
    // extraFiles: [{ path, buffer }] written in the same commit (e.g. the JPEG)
    async write(record, expectedSha, message, extraFiles = []) {
      const file = fileOf(record.content_id);
      if (blobHash(file) !== (expectedSha ?? null)) return { ok: false, conflict: true };
      for (const f of extraFiles) {
        if (!path.normalize(f.path).startsWith(LANE_ROOT)) throw new Error('EXTRA_FILE_OUTSIDE_LANE');
        fs.mkdirSync(path.dirname(f.path), { recursive: true });
        fs.writeFileSync(f.path, f.buffer);
      }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
      git(['add', '--', file, ...extraFiles.map(f => f.path)]);
      git(['commit', '-q', '-m', message]);
      if (push) {
        let pushed = false;
        for (let i = 0; i < maxPushAttempts && !pushed; i++) {
          try { git(['push', '-q', 'origin', 'HEAD:main']); pushed = true; } catch {
            try { git(['pull', '-q', '--rebase', 'origin', 'main']); } catch { git(['rebase', '--abort']); break; }
          }
        }
        if (!pushed) {
          git(['reset', '-q', '--hard', 'HEAD~1']);
          return { ok: false, conflict: true, reason: 'push_failed' };
        }
      }
      return { ok: true, sha: blobHash(file) };
    },
  };
}
