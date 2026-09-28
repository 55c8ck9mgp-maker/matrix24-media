// Detect Metricool stalled records: finds queue records in 'publishing' status
// without instagram_media_id after >30 minutes.
//
// Returns a plan containing:
// - count: number of stalled records found
// - stalled: array of stalled record details
// - skipped: array of records that passed validation but are not stalled
// - errors: array of processing errors
//
// Usage:
//   node scripts/detect-metricool-stalled.mjs

import fs from 'node:fs';
import path from 'node:path';

class DetectionError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

const QUEUE_DIR = 'queue';
const STALLED_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const SAFE_ID = /^matrix24-[a-z0-9-]+$/;

function readQueueRecord(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const record = JSON.parse(content);
    return record;
  } catch (e) {
    throw new DetectionError('QUEUE_READ_FAILED', `${filePath}: ${e.message}`);
  }
}

function isStalled(record, now) {
  // Must be in 'publishing' status
  if (record.status !== 'publishing') {
    return { stalled: false, reason: 'not_publishing_status' };
  }

  // Must not have instagram_media_id
  if (record.instagram_media_id) {
    return { stalled: false, reason: 'already_has_media_id' };
  }

  // Must have publishing_started_at
  if (!record.publishing_started_at) {
    return { stalled: false, reason: 'missing_publishing_started_at' };
  }

  // Must have been publishing for >30 minutes
  const startedTime = new Date(record.publishing_started_at).getTime();
  const elapsedMs = now - startedTime;

  if (elapsedMs < STALLED_THRESHOLD_MS) {
    return {
      stalled: false,
      reason: 'not_old_enough',
      elapsedMinutes: Math.round(elapsedMs / 60000),
    };
  }

  return { stalled: true };
}

function validateRecord(record, filePath) {
  // Basic record structure
  if (!record || typeof record !== 'object') {
    throw new DetectionError('QUEUE_RECORD_INVALID', filePath);
  }

  // Must have content_id
  if (!record.content_id || !SAFE_ID.test(record.content_id)) {
    throw new DetectionError('CONTENT_ID_INVALID', record.content_id);
  }

  // Must have provider and caption for recovery
  if (!record.provider) {
    throw new DetectionError('MISSING_PROVIDER', record.content_id);
  }

  if (!record.caption) {
    throw new DetectionError('MISSING_CAPTION', record.content_id);
  }

  // Must have public_image_url for media
  if (!record.public_image_url) {
    throw new DetectionError('MISSING_IMAGE_URL', record.content_id);
  }

  return { valid: true };
}

async function detectStalled() {
  const now = Date.now();
  const plan = {
    detected_at: new Date(now).toISOString(),
    count: 0,
    stalled: [],
    skipped: [],
    errors: [],
  };

  // Scan queue directory
  let files;
  try {
    files = fs.readdirSync(QUEUE_DIR);
  } catch (e) {
    plan.errors.push({
      reason: 'QUEUE_DIR_READ_FAILED',
      detail: e.message,
    });
    return plan;
  }

  for (const filename of files) {
    if (!filename.endsWith('.json')) {
      continue;
    }

    const filePath = path.join(QUEUE_DIR, filename);
    let record = null;

    try {
      // Validate record structure and required fields
      record = readQueueRecord(filePath);
      validateRecord(record, filePath);

      // Check if stalled
      const stalledCheck = isStalled(record, now);

      if (stalledCheck.stalled) {
        plan.stalled.push({
          content_id: record.content_id,
          filename,
          filepath: filePath,
          publishing_started_at: record.publishing_started_at,
          elapsed_minutes: Math.round(
            (now - new Date(record.publishing_started_at).getTime()) / 60000
          ),
          provider: record.provider,
          caption: record.caption,
          public_image_url: record.public_image_url,
          publish_attempt_id: record.publish_attempt_id,
        });
        plan.count++;
      } else {
        plan.skipped.push({
          content_id: record.content_id,
          filename,
          reason: stalledCheck.reason,
          elapsed_minutes: stalledCheck.elapsedMinutes,
        });
      }
    } catch (e) {
      if (e instanceof DetectionError) {
        plan.errors.push({
          filename,
          content_id: record?.content_id || 'unknown',
          reason: e.code,
          detail: e.message,
        });
      } else {
        plan.errors.push({
          filename,
          reason: 'UNKNOWN_ERROR',
          detail: e.message,
        });
      }
    }
  }

  return plan;
}

// Main
(async () => {
  try {
    const plan = await detectStalled();
    console.log(JSON.stringify(plan, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('Fatal error:', e.message);
    process.exit(1);
  }
})();
