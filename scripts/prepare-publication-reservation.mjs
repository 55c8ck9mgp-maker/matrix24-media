// Publication Plane: reservation broker. Finds all ready_to_publish records
// without a publish_attempt_id and prepares them for reservation write.
//
// Deterministic, non-LLM logic only. No external calls. Returns list of records
// that need publish_attempt_id created via SHA-conditional GitHub write.
//
// Usage:
//   node scripts/prepare-publication-reservation.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assessReadyToPublish } from './publication-plane-policy.mjs';
import { classifyQueueWrite } from './queue-transition-ownership.mjs';

const SAFE_ID = /^matrix24-[a-z0-9-]+$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ReservationError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

function readQueueRecord(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const record = JSON.parse(content);
    return { record, content };
  } catch (e) {
    throw new ReservationError('QUEUE_READ_FAILED', `${filePath}: ${e.message}`);
  }
}

function calculateSha(content) {
  // GitHub API uses git blob hash format: SHA-1('blob <byte_size>\0<content>')
  // Size must be the byte length, not character count
  const byteLength = Buffer.byteLength(content, 'utf8');
  const hash = crypto.createHash('sha1');
  hash.update(`blob ${byteLength}\0`, 'utf8');
  hash.update(content, 'utf8');
  return hash.digest('hex');
}

function generateAttemptId() {
  // Generate a UUID v4 for the publication attempt
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateRecord(record, filePath) {
  if (!record || typeof record !== 'object') {
    throw new ReservationError('QUEUE_RECORD_INVALID', filePath);
  }
  if (!SAFE_ID.test(record.content_id)) {
    throw new ReservationError('CONTENT_ID_INVALID', record.content_id);
  }
  if (record.status !== 'ready_to_publish') {
    return { valid: false, reason: 'not_ready_to_publish' };
  }
  if (record.publish_attempt_id) {
    return { valid: false, reason: 'already_reserved' };
  }
  if (record.publishing_started_at || record.instagram_media_id ||
      record.instagram_permalink || record.published_at ||
      record.metricool_scheduled_post_id || record.metricool_scheduled_post_uuid) {
    return { valid: false, reason: 'existing_publication_evidence' };
  }
  return { valid: true };
}

function buildReservation(record, attemptId, now) {
  const reservation = structuredClone(record);
  reservation.status = 'publishing';
  reservation.publish_attempt_id = attemptId;
  reservation.publishing_started_at = now;
  reservation.provider = 'metricool';

  // Append to publish_attempt_history
  if (!Array.isArray(reservation.publish_attempt_history)) {
    reservation.publish_attempt_history = [];
  }
  // Keep only last 50 entries
  if (reservation.publish_attempt_history.length >= 50) {
    reservation.publish_attempt_history = reservation.publish_attempt_history.slice(-49);
  }
  reservation.publish_attempt_history.push({
    timestamp: now,
    stage: 'publication',
    result: 'reservation_started',
    provider: 'metricool',
    publish_attempt_id: attemptId,
    source: 'publication_reservation_workflow'
  });

  return reservation;
}

export async function preparePublicationReservations(root = process.cwd()) {
  const queueDir = path.join(root, 'queue');
  if (!fs.existsSync(queueDir)) {
    throw new ReservationError('QUEUE_DIR_NOT_FOUND', queueDir);
  }

  const now = new Date().toISOString();
  const reservations = [];
  const skipped = [];
  const errors = [];

  const files = fs.readdirSync(queueDir)
    .filter(name => name.endsWith('.json'))
    .sort();

  for (const filename of files) {
    const filePath = path.join(queueDir, filename);
    try {
      const { record, content } = readQueueRecord(filePath);
      const validation = validateRecord(record, filename);

      if (!validation.valid) {
        skipped.push({
          content_id: record.content_id || 'unknown',
          filename,
          reason: validation.reason
        });
        continue;
      }

      // Check ownership: does publication plane own this transition?
      const reserved = buildReservation(record, generateAttemptId(), now);
      const ownership = classifyQueueWrite(record, reserved);
      if (!ownership.ok) {
        errors.push({
          content_id: record.content_id,
          filename,
          reason: 'ownership_violation',
          violations: ownership.violations
        });
        continue;
      }

      // Validate using publication plane policy
      const assessment = assessReadyToPublish(record, { readComplete: true, positiveDuplicate: false, currentSha: calculateSha(content) });
      if (assessment.action !== 'reserve') {
        skipped.push({
          content_id: record.content_id,
          filename,
          reason: assessment.gate || 'publication_policy_blocked'
        });
        continue;
      }

      reservations.push({
        content_id: record.content_id,
        filename,
        queue_path: `queue/${filename}`,
        current_sha: calculateSha(content),
        attempt_id: reserved.publish_attempt_id,
        current_record: record,
        reserved_record: reserved
      });
    } catch (error) {
      errors.push({
        filename,
        reason: error.code || 'error',
        detail: error.message
      });
    }
  }

  return {
    timestamp: now,
    reservations: reservations.slice(0, 1),
    skipped: skipped.concat(reservations.slice(1).map(item => ({
      content_id: item.content_id,
      filename: item.filename,
      reason: 'single_reservation_per_cycle_guard'
    }))),
    errors,
    count: Math.min(reservations.length, 1)
  };
}

function parseArgs(argv) {
  return {};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await preparePublicationReservations(process.cwd());
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, code: error.code || 'UNEXPECTED', error: String(error.message || error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
