import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_STRINGS = ['content_id', 'researched_at', 'event_date', 'headline', 'category', 'editorial_category', 'caption', 'image_generation_prompt', 'verification_note', 'verification_status', 'candidate_status'];
const INTAKE_PREFIX = 'editorial/verified/';
const CONSENSUS_STATUS = 'verified_claim_consensus';

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

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateClaimConsensus(draft, file = 'draft') {
  if (draft.verification_status !== CONSENSUS_STATUS) fail(`${file}.verification_status must be ${CONSENSUS_STATUS}`);

  const sourceUrls = new Set(draft.verified_source_urls);
  const sourceByUrl = new Map();
  for (const [index, source] of draft.source_records.entries()) {
    if (!nonempty(source.independent_source_id)) fail(`${file}.source_records[${index}].independent_source_id is required`);
    if (!['primary_authority', 'independent_report'].includes(source.source_role)) fail(`${file}.source_records[${index}].source_role must be primary_authority or independent_report`);
    sourceByUrl.set(source.url, source);
  }

  for (const [index, check] of draft.claim_checks.entries()) {
    if (check.material !== true) fail(`${file}.claim_checks[${index}].material must be true for publishable claims`);
    if (!nonempty(check.normalized_value)) fail(`${file}.claim_checks[${index}].normalized_value is required`);
    if (!Array.isArray(check.observations) || check.observations.length < 2) fail(`${file}.claim_checks[${index}].observations needs at least two source observations`);

    const observedUrls = new Set();
    const supportingIds = new Set();
    const conflicting = [];
    for (const [obsIndex, observation] of check.observations.entries()) {
      if (!observation || typeof observation !== 'object') fail(`${file}.claim_checks[${index}].observations[${obsIndex}] must be an object`);
      httpsUrl(observation.url, `${file}.claim_checks[${index}].observations[${obsIndex}].url`);
      if (!sourceUrls.has(observation.url)) fail(`${file}.claim_checks[${index}] cites a URL outside verified_source_urls`);
      if (observedUrls.has(observation.url)) fail(`${file}.claim_checks[${index}].observations URLs must be unique`);
      observedUrls.add(observation.url);
      if (!nonempty(observation.normalized_value)) fail(`${file}.claim_checks[${index}].observations[${obsIndex}].normalized_value is required`);
      const source = sourceByUrl.get(observation.url);
      if (!source) fail(`${file}.claim_checks[${index}] observation has no source_record`);
      if (observation.normalized_value === check.normalized_value) supportingIds.add(source.independent_source_id);
      else conflicting.push({ observation, source });
    }

    if (supportingIds.size < 2) fail(`${file}.claim_checks[${index}] needs consensus from at least two independent sources`);

    if (conflicting.length > 0) {
      const resolution = check.resolution;
      if (!resolution || resolution.method !== 'primary_authority_tiebreak') fail(`${file}.claim_checks[${index}] has a material source conflict without primary-authority resolution`);
      if (!nonempty(resolution.authoritative_url) || !nonempty(resolution.rationale)) fail(`${file}.claim_checks[${index}].resolution requires authoritative_url and rationale`);
      const authority = sourceByUrl.get(resolution.authoritative_url);
      if (!authority || authority.source_role !== 'primary_authority') fail(`${file}.claim_checks[${index}].resolution authoritative_url must identify a primary_authority source`);
      const authorityObservation = check.observations.find((item) => item.url === resolution.authoritative_url);
      if (!authorityObservation || authorityObservation.normalized_value !== check.normalized_value) fail(`${file}.claim_checks[${index}] primary authority must support normalized_value`);
    }
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
  }
  validateClaimConsensus(draft, file);
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
