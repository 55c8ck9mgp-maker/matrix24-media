#!/usr/bin/env node
// Validates every record in claude-lane/queue/. Exit 1 on any error.
import fs from 'node:fs';
import path from 'node:path';
import { validateLaneRecord } from './lane-record.mjs';

const dir = process.argv[2] ?? 'claude-lane/queue';
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : [];
let bad = 0;
for (const file of files) {
  let errors;
  try {
    const record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    errors = validateLaneRecord(record);
    if (record.content_id && `${record.content_id}.json` !== file) errors.push('FILENAME_MISMATCH');
  } catch (e) {
    errors = [`INVALID_JSON:${e.message}`];
  }
  if (errors.length) { bad++; console.log(`FAIL ${file}: ${errors.join(', ')}`); }
  else console.log(`OK   ${file}`);
}
console.log(`${files.length} record(s), ${bad} invalid`);
process.exit(bad ? 1 : 0);
