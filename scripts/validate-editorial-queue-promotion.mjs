import fs from 'node:fs';
import path from 'node:path';
import { buildPromotionFromFiles } from './build-editorial-promotion.mjs';

function fail(message) {
  throw new Error(`editorial queue promotion rejected: ${message}`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fail(`${file} is not readable JSON`);
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateEditorialQueuePromotion({ root = process.cwd(), queuePath, candidatePath }) {
  if (typeof queuePath !== 'string' || !/^queue\/matrix24-[a-z0-9-]+\.json$/.test(queuePath)) {
    fail('queue path must be queue/matrix24-<safe-content-id>.json');
  }
  const candidate = readJson(candidatePath);
  const manifestPath = candidate?.editorial_promotion?.manifest_path;
  const queuePaths = fs.readdirSync(path.join(root, 'queue'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => `queue/${name}`);
  const { outputPath, record } = buildPromotionFromFiles({ root, manifestPath, queuePaths });
  if (outputPath !== queuePath) fail('candidate path does not match the approved draft content_id');
  if (!sameJson(record, candidate)) fail('candidate record is not the exact deterministic output of its approved manifest');
  return { status: 'accepted', contentId: record.content_id, manifestPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [queuePath, candidatePath] = process.argv.slice(2);
  if (!queuePath || !candidatePath) fail('usage: node scripts/validate-editorial-queue-promotion.mjs queue/<content-id>.json <candidate.json>');
  const result = validateEditorialQueuePromotion({ queuePath, candidatePath });
  console.log(`editorial queue promotion validation: ${result.status} (${result.contentId})`);
}
