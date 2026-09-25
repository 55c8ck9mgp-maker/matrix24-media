import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_STRINGS = ['content_id', 'researched_at', 'event_date', 'headline', 'category', 'editorial_category', 'caption', 'image_generation_prompt', 'verification_note', 'verification_status', 'candidate_status'];
const INTAKE_PREFIX = 'editorial/verified/';

function fail(message) {
  throw new Error(`editorial intake rejected: ${message}`);
}

function httpsUrl(value, field) {
  if (typeof value !== 'string') fail(`${field} must be a string`);
  try {
    if (new URL(value).protocol !== 'https:') fail(`${field} must use https`);
  } catch {
    fail(`${field} must be a valid https URL`);
  }
}

export function validateEditorialDraft(draft, file = 'draft') {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) fail(`${file} must contain a JSON object`);
  for (const field of REQUIRED_STRINGS) {
    if (typeof draft[field] !== 'string' || !draft[field].trim()) fail(`${file}.${field} is required`);
  }
  if (draft.promotion_eligible !== false) fail(`${file}.promotion_eligible must be false at intake`);
  if (!draft.candidate_status.includes('requires_editorial_promotion')) fail(`${file}.candidate_status must require explicit editorial promotion`);
  if (!Array.isArray(draft.verified_source_urls) || draft.verified_source_urls.length < 2) fail(`${file}.verified_source_urls needs at least two sources`);
  const sourceUrls = new Set(draft.verified_source_urls);
  if (sourceUrls.size !== draft.verified_source_urls.length) fail(`${file}.verified_source_urls must be unique`);
  for (const url of sourceUrls) httpsUrl(url, `${file}.verified_source_urls`);
  if (!Array.isArray(draft.source_records) || draft.source_records.length < 2) fail(`${file}.source_records needs at least two records`);
  for (const [index, source] of draft.source_records.entries()) {
    if (!source || typeof source !== 'object') fail(`${file}.source_records[${index}] must be an object`);
    if (typeof source.source_name !== 'string' || !source.source_name.trim()) fail(`${file}.source_records[${index}].source_name is required`);
    httpsUrl(source.url, `${file}.source_records[${index}].url`);
    if (!sourceUrls.has(source.url)) fail(`${file}.source_records[${index}].url must be listed in verified_source_urls`);
    if (!Array.isArray(source.supports) || source.supports.length === 0 || source.supports.some((claim) => typeof claim !== 'string' || !claim.trim())) fail(`${file}.source_records[${index}].supports needs at least one claim`);
  }
  if (!Array.isArray(draft.claim_checks) || draft.claim_checks.length === 0) fail(`${file}.claim_checks needs at least one check`);
  for (const [index, check] of draft.claim_checks.entries()) {
    if (!check || typeof check.claim !== 'string' || !check.claim.trim()) fail(`${file}.claim_checks[${index}].claim is required`);
    if (!Array.isArray(check.supporting_urls) || check.supporting_urls.length === 0) fail(`${file}.claim_checks[${index}].supporting_urls is required`);
    for (const url of check.supporting_urls) {
      httpsUrl(url, `${file}.claim_checks[${index}].supporting_urls`);
      if (!sourceUrls.has(url)) fail(`${file}.claim_checks[${index}] cites a URL outside verified_source_urls`);
    }
  }
}

export function validateEditorialIntakeFiles(files, cwd = process.cwd()) {
  if (!Array.isArray(files) || files.length === 0) fail('no changed intake files supplied');
  for (const file of files) {
    if (typeof file !== 'string' || !file.startsWith(INTAKE_PREFIX) || !file.endsWith('.json') || file.includes('..')) fail(`only ${INTAKE_PREFIX}*.json may enter this workflow: ${file}`);
    const absolute = path.resolve(cwd, file);
    const root = path.resolve(cwd, INTAKE_PREFIX);
    if (!absolute.startsWith(`${root}${path.sep}`)) fail(`path escapes editorial intake: ${file}`);
    let draft;
    try {
      draft = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    } catch {
      fail(`${file} is not readable JSON`);
    }
    validateEditorialDraft(draft, file);
  }
  return { status: 'accepted', files: files.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validateEditorialIntakeFiles(process.argv.slice(2));
  console.log(`editorial intake validation: ${result.status} (${result.files} file${result.files === 1 ? '' : 's'})`);
}
