import fs from 'node:fs';
import path from 'node:path';
import { buildPromotionFromFiles } from './build-editorial-promotion.mjs';

function fail(message) {
  throw new Error(`editorial queue promotion preparation rejected: ${message}`);
}

const [manifestPath, outputDirectory] = process.argv.slice(2);
if (!manifestPath || !outputDirectory) fail('usage: node scripts/prepare-editorial-queue-pr.mjs editorial/promotions/<manifest>.json <output-directory>');
if (!/^editorial\/promotions\/[a-z0-9-]+\.json$/.test(manifestPath)) fail('manifest path must be a safe editorial/promotions/*.json path');

const queuePaths = fs.readdirSync('queue').filter((name) => name.endsWith('.json')).map((name) => `queue/${name}`);
const { outputPath, record } = buildPromotionFromFiles({ manifestPath, queuePaths });
const outputRoot = path.resolve(outputDirectory);
const destination = path.resolve(outputRoot, outputPath);
if (!destination.startsWith(`${outputRoot}${path.sep}`)) fail('generated queue path escapes the output directory');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `${JSON.stringify(record, null, 2)}\n`);
process.stdout.write(JSON.stringify({ output_path: outputPath, content_id: record.content_id, manifest_path: manifestPath }));
