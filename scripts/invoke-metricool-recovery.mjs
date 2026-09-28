// Invoke Metricool recovery: attempts to recover stalled publications via Metricool API.
//
// Reads stalled plan (from detect-metricool-stalled.mjs) and for each stalled record:
// 1. Invokes Metricool API to create Instagram post
// 2. Parses response for instagram_media_id
// 3. Updates queue record via GitHub API with media_id and status=published
//
// Dry-run mode (DRY_RUN=true) plans the recovery without invoking API or updating GitHub.
//
// Usage:
//   DRY_RUN=true node scripts/invoke-metricool-recovery.mjs <plan.json>
//   METRICOOL_API_KEY=xxx METRICOOL_ACCOUNT_ID=yyy GH_TOKEN=zzz node scripts/invoke-metricool-recovery.mjs <plan.json>

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

class RecoveryError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

function readPlan(planFile) {
  try {
    const content = fs.readFileSync(planFile, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    throw new RecoveryError('PLAN_READ_FAILED', e.message);
  }
}

function getMetricoolApi() {
  const apiKey = process.env.METRICOOL_API_KEY;
  if (!apiKey) {
    throw new RecoveryError('NO_METRICOOL_API_KEY', 'METRICOOL_API_KEY not set');
  }
  return apiKey;
}

function getMetricoolAccountId() {
  const accountId = process.env.METRICOOL_ACCOUNT_ID;
  if (!accountId) {
    throw new RecoveryError('NO_METRICOOL_ACCOUNT_ID', 'METRICOOL_ACCOUNT_ID not set');
  }
  return accountId;
}

function getGitHubApi() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new RecoveryError('NO_GITHUB_TOKEN', 'GH_TOKEN or GITHUB_TOKEN not set');
  }
  return token;
}

function getRepository() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    throw new RecoveryError('NO_GITHUB_REPOSITORY', 'GITHUB_REPOSITORY not set');
  }
  return repo;
}

function isDryRun() {
  const dryRun = process.env.DRY_RUN;
  return dryRun === 'true' || dryRun === '1' || dryRun === 'yes';
}

async function invokeMetricoolApi(apiKey, accountId, record) {
  // Metricool API endpoint for scheduling Instagram posts
  // Assumes Metricool accepts POST with media URL and caption
  const metricoolEndpoint = 'https://api.metricool.com/v1/instagram/schedule';

  const payload = {
    account_id: accountId,
    media_url: record.public_image_url,
    caption: record.caption,
    schedule_time: new Date().toISOString(),
    platforms: ['instagram'],
  };

  const payloadJson = JSON.stringify(payload);

  try {
    const cmd = `curl -sS -w "\n%{http_code}" -X POST \
      -H "Authorization: Bearer ${apiKey}" \
      -H "Content-Type: application/json" \
      "${metricoolEndpoint}" \
      -d '${payloadJson.replace(/'/g, "'\\''")}'`;

    const output = execSync(cmd, { encoding: 'utf8' });
    const lines = output.trim().split('\n');
    const statusCode = lines[lines.length - 1];
    const responseJson = lines.slice(0, -1).join('\n');

    if (!statusCode.startsWith('2')) {
      throw new RecoveryError(
        'METRICOOL_API_ERROR',
        `HTTP ${statusCode}: ${responseJson}`
      );
    }

    const data = JSON.parse(responseJson);

    // Extract instagram_media_id from response
    // Metricool response format may vary; handle common patterns:
    // - data.media_id
    // - data.instagram_media_id
    // - data.post_id
    const mediaId =
      data.media_id ||
      data.instagram_media_id ||
      data.post_id ||
      data.id;

    if (!mediaId) {
      throw new RecoveryError(
        'NO_MEDIA_ID_IN_RESPONSE',
        `Response: ${JSON.stringify(data)}`
      );
    }

    return {
      success: true,
      instagram_media_id: mediaId,
      metricool_response: data,
    };
  } catch (e) {
    if (e instanceof RecoveryError) throw e;
    throw new RecoveryError('METRICOOL_API_FAILED', e.message);
  }
}

async function getCurrentFileInfo(repo, token, queuePath) {
  try {
    const cmd = `curl -sS -H "Authorization: Bearer ${token}" https://api.github.com/repos/${repo}/contents/${queuePath}`;
    const output = execSync(cmd, { encoding: 'utf8' });
    const data = JSON.parse(output);
    return { sha: data.sha, exists: true };
  } catch (e) {
    if (e.message && e.message.includes('404')) {
      return { sha: null, exists: false };
    }
    throw new RecoveryError('FILE_INFO_FAILED', e.message);
  }
}

async function readQueueFile(repo, token, queuePath) {
  try {
    const cmd = `curl -sS -H "Authorization: Bearer ${token}" https://api.github.com/repos/${repo}/contents/${queuePath}`;
    const output = execSync(cmd, { encoding: 'utf8' });
    const data = JSON.parse(output);

    // GitHub API returns base64-encoded content
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    const record = JSON.parse(content);

    return { record, sha: data.sha };
  } catch (e) {
    throw new RecoveryError('QUEUE_FILE_READ_FAILED', e.message);
  }
}

async function writeFileToGitHub(repo, token, queuePath, recordJson, expectedSha, message) {
  const content = Buffer.from(recordJson).toString('base64');

  const payload = {
    message,
    content,
    sha: expectedSha,
  };

  try {
    const cmd = `curl -sS -w "\n%{http_code}" -X PUT -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" https://api.github.com/repos/${repo}/contents/${queuePath} -d '${JSON.stringify(payload).replace(/'/g, "'\\''")}'`;
    const output = execSync(cmd, { encoding: 'utf8' });
    const lines = output.trim().split('\n');
    const statusCode = lines[lines.length - 1];
    const responseJson = lines.slice(0, -1).join('\n');
    const data = JSON.parse(responseJson);

    if (statusCode === '409') {
      return { success: false, reason: 'sha_conflict' };
    }
    if (statusCode.startsWith('2')) {
      return { success: true, sha: data.commit?.sha };
    }
    throw new RecoveryError('WRITE_FAILED', `HTTP ${statusCode}: ${data.message || 'Unknown error'}`);
  } catch (e) {
    if (e instanceof RecoveryError) throw e;
    if (e.message && e.message.includes('409')) {
      return { success: false, reason: 'sha_conflict' };
    }
    throw new RecoveryError('WRITE_FAILED', e.message);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function invokeMetricoolRecovery(planFile) {
  const plan = readPlan(planFile);
  const dryRun = isDryRun();

  let metricoolApiKey, metricoolAccountId, gitHubToken, repo;

  if (!dryRun) {
    metricoolApiKey = getMetricoolApi();
    metricoolAccountId = getMetricoolAccountId();
    gitHubToken = getGitHubApi();
    repo = getRepository();
  }

  const results = {
    dry_run: dryRun,
    recovered: [],
    conflicts: [],
    errors: [],
    total: plan.stalled.length || 0,
  };

  if (!plan.stalled || plan.stalled.length === 0) {
    console.log('No stalled records to recover.');
    return results;
  }

  console.log(`Recovering ${plan.stalled.length} stalled publication(s)...${dryRun ? ' (DRY RUN)' : ''}`);

  // Track items that need retry due to SHA conflicts
  let retryQueue = [];

  // First pass: attempt all recoveries
  for (const stalledRecord of plan.stalled) {
    const { content_id, filename, filepath } = stalledRecord;
    const queuePath = `queue/${filename}`;

    try {
      console.log(`\n→ Recovering: ${content_id}`);

      if (dryRun) {
        console.log(`  [DRY RUN] Would invoke Metricool API for media creation`);
        console.log(`  [DRY RUN] Would update ${queuePath} with status=published`);
        results.recovered.push({
          content_id,
          queue_path: queuePath,
          dry_run: true,
        });
        continue;
      }

      // Step 1: Invoke Metricool API
      console.log(`  Invoking Metricool API...`);
      const metricoolResult = await invokeMetricoolApi(
        metricoolApiKey,
        metricoolAccountId,
        stalledRecord
      );

      const instagram_media_id = metricoolResult.instagram_media_id;
      console.log(`  ✓ Metricool API succeeded: media_id=${instagram_media_id}`);

      // Step 2: Read current queue file from GitHub
      console.log(`  Reading current queue record from GitHub...`);
      const fileInfo = await readQueueFile(repo, gitHubToken, queuePath);
      const currentRecord = fileInfo.record;
      const currentSha = fileInfo.sha;

      // Step 3: Update record with instagram_media_id and status=published
      const updatedRecord = {
        ...currentRecord,
        status: 'published',
        instagram_media_id,
        published_at: new Date().toISOString(),
      };

      // Step 4: Write updated record via GitHub API
      const recordJson = JSON.stringify(updatedRecord, null, 2) + '\n';
      const message = `Metricool recovery: ${content_id} (instagram_media_id=${instagram_media_id})`;

      const writeResult = await writeFileToGitHub(
        repo,
        gitHubToken,
        queuePath,
        recordJson,
        currentSha,
        message
      );

      if (writeResult.success) {
        results.recovered.push({
          content_id,
          queue_path: queuePath,
          instagram_media_id,
          new_sha: writeResult.sha,
        });
        console.log(`  ✓ Queue record updated: ${queuePath}`);
      } else if (writeResult.reason === 'sha_conflict') {
        console.log(`  ⚠ RACE (initial write): ${queuePath} (concurrent write, will retry)`);
        retryQueue.push({
          content_id,
          queue_path: queuePath,
          stalledRecord,
          instagram_media_id,
          attempt: 0,
        });
      }
    } catch (e) {
      results.errors.push({
        content_id,
        queue_path: queuePath,
        reason: e.code || 'error',
        detail: e.message,
      });
      console.error(`  ✗ Error: ${e.message}`);
    }
  }

  // Retry logic with exponential backoff (up to 3 attempts)
  for (let attemptNum = 1; attemptNum <= 3 && retryQueue.length > 0; attemptNum++) {
    const backoffMs = 100 * Math.pow(2, attemptNum - 1);
    console.log(`\n⏳ Retry attempt ${attemptNum}/3 (waiting ${backoffMs}ms)...`);
    await sleep(backoffMs);

    const stillFailing = [];

    for (const item of retryQueue) {
      const { content_id, queue_path, stalledRecord, instagram_media_id } = item;

      try {
        // Re-fetch the current SHA before retry
        const fileInfo = await readQueueFile(repo, gitHubToken, queue_path);
        const currentRecord = fileInfo.record;
        const currentSha = fileInfo.sha;

        const updatedRecord = {
          ...currentRecord,
          status: 'published',
          instagram_media_id,
          published_at: new Date().toISOString(),
        };

        const recordJson = JSON.stringify(updatedRecord, null, 2) + '\n';
        const message = `Metricool recovery: ${content_id} (instagram_media_id=${instagram_media_id} - retry ${attemptNum})`;

        const writeResult = await writeFileToGitHub(
          repo,
          gitHubToken,
          queue_path,
          recordJson,
          currentSha,
          message
        );

        if (writeResult.success) {
          results.recovered.push({
            content_id,
            queue_path,
            instagram_media_id,
            new_sha: writeResult.sha,
            retriedAttempt: attemptNum,
          });
          console.log(`  ✓ Recovered (retry ${attemptNum}): ${queue_path}`);
        } else if (writeResult.reason === 'sha_conflict') {
          console.log(`  ⚠ RACE (retry ${attemptNum}): ${queue_path} (still conflicting, will retry)`);
          stillFailing.push(item);
        }
      } catch (e) {
        results.errors.push({
          content_id,
          queue_path,
          reason: e.code || 'error',
          detail: e.message,
          attempt: attemptNum,
        });
        console.error(`  ✗ Error on retry ${attemptNum} for ${queue_path}: ${e.message}`);
      }
    }

    retryQueue = stillFailing;
  }

  // Any remaining items that still failed
  if (retryQueue.length > 0) {
    for (const item of retryQueue) {
      results.conflicts.push({
        content_id: item.content_id,
        queue_path: item.queue_path,
        reason: 'persistent_conflict',
        detail: 'Failed to write after 3 retry attempts with exponential backoff',
      });
      console.log(`  ✗ PERSISTENT RACE: ${item.queue_path} (failed after retries)`);
    }
  }

  // Summary
  console.log('\n---');
  console.log(`Summary:`);
  console.log(`  Total stalled: ${results.total}`);
  console.log(`  Recovered on first attempt: ${results.recovered.filter(r => !r.retriedAttempt).length}`);
  console.log(`  Recovered after retries: ${results.recovered.filter(r => r.retriedAttempt).length}`);
  console.log(`  Persistent conflicts: ${results.conflicts.length}`);
  console.log(`  Errors: ${results.errors.length}`);

  if (results.errors.length > 0) {
    console.log('\nErrors:');
    for (const err of results.errors) {
      console.log(`  - ${err.content_id}: ${err.reason}`);
    }
  }

  if (results.conflicts.length > 0) {
    console.log('\nPersistent conflicts (requires manual intervention):');
    for (const conflict of results.conflicts) {
      console.log(`  - ${conflict.content_id}: ${conflict.reason}`);
    }
  }

  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const planFile = process.argv[2];
  if (!planFile) {
    console.error('Usage: node invoke-metricool-recovery.mjs <plan.json>');
    process.exitCode = 1;
  } else {
    try {
      const results = await invokeMetricoolRecovery(planFile);
      process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    } catch (error) {
      console.error(`Fatal error: ${error.message}`);
      process.stdout.write(
        `${JSON.stringify(
          { ok: false, code: error.code || 'UNEXPECTED', error: String(error.message || error) },
          null,
          2
        )}\n`
      );
      process.exitCode = 1;
    }
  }
}

export { invokeMetricoolRecovery };
