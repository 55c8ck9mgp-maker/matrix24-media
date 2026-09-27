import fs from 'node:fs';
import path from 'node:path';
import { buildPromotionFromFiles } from './build-editorial-promotion.mjs';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function reason(error) {
  return String(error?.message || error || 'unknown_validation_failure').slice(0, 500);
}

export function selectPromotionWork({ root = process.cwd() } = {}) {
  const promotionDir = path.join(root, 'editorial', 'promotions');
  const queueDir = path.join(root, 'queue');
  const manifestNames = fs.readdirSync(promotionDir).filter((name) => name.endsWith('.json')).sort();
  const queueNames = fs.readdirSync(queueDir).filter((name) => name.endsWith('.json')).sort();
  const queuePaths = queueNames.map((name) => `queue/${name}`);
  const queueIds = new Set();

  for (const queuePath of queuePaths) {
    const record = readJson(path.join(root, queuePath));
    if (typeof record.content_id !== 'string' || !record.content_id) {
      throw new Error(`promotion selection rejected: ${queuePath} has no content_id`);
    }
    if (queueIds.has(record.content_id)) {
      throw new Error(`promotion selection rejected: duplicate queue content_id ${record.content_id}`);
    }
    queueIds.add(record.content_id);
  }

  const quarantined = [];
  for (const name of manifestNames) {
    const manifestPath = `editorial/promotions/${name}`;
    let manifest;
    try {
      manifest = readJson(path.join(root, manifestPath));
    } catch (error) {
      quarantined.push({ manifest_path: manifestPath, reason: reason(error) });
      continue;
    }
    if (manifest?.approved !== true) continue;

    const filenameId = name.slice(0, -5);
    if (typeof manifest.content_id !== 'string' || !manifest.content_id) {
      if (queueIds.has(filenameId)) continue;
      quarantined.push({ manifest_path: manifestPath, reason: 'approved_legacy_manifest_missing_content_id_without_admitted_queue' });
      continue;
    }
    if (queueIds.has(manifest.content_id)) continue;

    try {
      const { outputPath, record } = buildPromotionFromFiles({ root, manifestPath, queuePaths });
      return {
        action: 'promote',
        manifest_path: manifestPath,
        content_id: record.content_id,
        output_path: outputPath,
        quarantined
      };
    } catch (error) {
      quarantined.push({ manifest_path: manifestPath, content_id: manifest.content_id, reason: reason(error) });
    }
  }

  return {
    action: 'noop',
    manifest_path: null,
    content_id: null,
    output_path: null,
    quarantined
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(selectPromotionWork())}\n`);
}
