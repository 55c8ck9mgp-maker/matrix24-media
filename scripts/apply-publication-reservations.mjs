// Apply publication reservations via GitHub API.
//
// Reads a reservation plan (from prepare-publication-reservation.mjs) and
// performs SHA-conditional writes to GitHub for each reservation.
// Uses the GitHub API (via GITHUB_TOKEN) to write queue records with
// publish_attempt_id. Handles race conditions via SHA-conditional writes.
//
// Usage:
//   node scripts/apply-publication-reservations.mjs <plan.json>
//   GH_TOKEN=... node scripts/apply-publication-reservations.mjs <plan.json>
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

class ApplyError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

async function readPlan(planFile) {
  try {
    const content = fs.readFileSync(planFile, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    throw new ApplyError('PLAN_READ_FAILED', e.message);
  }
}

function getGitHubApi() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new ApplyError('NO_GITHUB_TOKEN', 'GH_TOKEN or GITHUB_TOKEN not set');
  }
  return token;
}

function getRepository() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    throw new ApplyError('NO_GITHUB_REPOSITORY', 'GITHUB_REPOSITORY not set');
  }
  return repo;
}

async function getCurrentFileInfo(repo, token, queuePath) {
  try {
    const cmd = `curl -sS -H "Authorization: Bearer ${token}" https://api.github.com/repos/${repo}/contents/${queuePath}`;
    const output = execSync(cmd, { encoding: 'utf8' });
    const data = JSON.parse(output);
    return { sha: data.sha, exists: true };
  } catch (e) {
    // File might not exist or might be deleted
    if (e.message && e.message.includes('404')) {
      return { sha: null, exists: false };
    }
    throw new ApplyError('FILE_INFO_FAILED', e.message);
  }
}

async function writeFileToGitHub(repo, token, queuePath, recordJson, expectedSha, message) {
  const content = Buffer.from(recordJson).toString('base64');

  const payload = {
    message,
    content,
    sha: expectedSha
  };

  try {
    const cmd = `curl -sS -X PUT -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" https://api.github.com/repos/${repo}/contents/${queuePath} -d '${JSON.stringify(payload)}'`;
    const output = execSync(cmd, { encoding: 'utf8' });
    const data = JSON.parse(output);
    return { success: true, sha: data.commit.sha };
  } catch (e) {
    // Check if it's a conflict (race condition)
    if (e.message && e.message.includes('409')) {
      return { success: false, reason: 'sha_conflict' };
    }
    throw new ApplyError('WRITE_FAILED', e.message);
  }
}

async function applyPublicationReservations(planFile) {
  const plan = await readPlan(planFile);
  const token = getGitHubApi();
  const repo = getRepository();

  const results = {
    written: [],
    conflicts: [],
    errors: [],
    total: plan.reservations.length
  };

  console.log(`Applying ${plan.reservations.length} publication reservations...`);

  for (const reservation of plan.reservations) {
    const { queue_path, current_sha, reserved_record, content_id } = reservation;

    try {
      // Verify current SHA hasn't changed
      const fileInfo = await getCurrentFileInfo(repo, token, queue_path);
      if (!fileInfo.exists) {
        results.errors.push({
          content_id,
          queue_path,
          reason: 'file_not_found'
        });
        continue;
      }

      if (fileInfo.sha !== current_sha) {
        results.conflicts.push({
          content_id,
          queue_path,
          expected_sha: current_sha,
          actual_sha: fileInfo.sha
        });
        console.log(`⚠ RACE: ${queue_path} (SHA changed, skipping)`);
        continue;
      }

      // Perform the write
      const recordJson = JSON.stringify(reserved_record, null, 2) + '\n';
      const message = `Publication reservation: ${content_id} (publish_attempt_id created)`;

      const writeResult = await writeFileToGitHub(
        repo,
        token,
        queue_path,
        recordJson,
        current_sha,
        message
      );

      if (writeResult.success) {
        results.written.push({
          content_id,
          queue_path,
          new_sha: writeResult.sha
        });
        console.log(`✓ Reserved: ${queue_path}`);
      } else if (writeResult.reason === 'sha_conflict') {
        results.conflicts.push({
          content_id,
          queue_path,
          reason: 'concurrent_write'
        });
        console.log(`⚠ RACE: ${queue_path} (concurrent write detected)`);
      }
    } catch (e) {
      results.errors.push({
        content_id,
        queue_path,
        reason: e.code || 'error',
        detail: e.message
      });
      console.error(`✗ Error writing ${queue_path}: ${e.message}`);
    }
  }

  // Summary
  console.log('');
  console.log(`Summary:`);
  console.log(`  Written: ${results.written.length}`);
  console.log(`  Conflicts (race): ${results.conflicts.length}`);
  console.log(`  Errors: ${results.errors.length}`);

  if (results.errors.length > 0) {
    console.log('\nErrors:');
    for (const err of results.errors) {
      console.log(`  - ${err.queue_path}: ${err.reason}`);
    }
  }

  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const planFile = process.argv[2];
  if (!planFile) {
    console.error('Usage: node apply-publication-reservations.mjs <plan.json>');
    process.exitCode = 1;
  } else {
    try {
      const results = await applyPublicationReservations(planFile);
      process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.stdout.write(`${JSON.stringify({ ok: false, code: error.code || 'UNEXPECTED', error: String(error.message || error) }, null, 2)}\n`);
      process.exitCode = 1;
    }
  }
}

export { applyPublicationReservations };
