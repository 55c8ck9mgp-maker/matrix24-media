import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime=fs.readFileSync('publisher-v2/private-runtime/src/index.mjs','utf8');
const config=JSON.parse(fs.readFileSync('publisher-v2/private-runtime/wrangler.jsonc','utf8'));
const schedulers=fs.readFileSync('docs/SCHEDULERS.md','utf8');
const cutover=fs.readFileSync('core-v2/PRE-LIVE-CUTOVER.md','utf8');

test('Publisher v2 cannot silently become the production owner',()=>{
  assert.equal(config.vars.PUBLISHER_V2_ENABLED,'false');
  assert.equal(config.vars.STAGING_REPOSITORY,'55c8ck9mgp-maker/matrix24-publication-v2-staging');
  assert.equal(config.workers_dev,false);
  assert.equal(config.preview_urls,false);
  assert.match(runtime,/async fetch\(\) \{ return new Response\('Not found',\{status:404/);
  assert.doesNotMatch(JSON.stringify(config),/cron|triggers/i);
  assert.match(schedulers,/does \*\*not\*\* own the production/);
});

test('identity proof remains a staging-only prerequisite',()=>{
  assert.match(runtime,/preflightIdentity/);
  assert.match(runtime,/mintInstallationToken/);
  assert.match(schedulers,/deployed runtime proves its real GitHub App identity against staging/);
  assert.doesNotMatch(runtime,/metricool|instagram/i);
});

test('simulated E2E does not satisfy the remaining live Phase 1 gate',()=>{
  assert.match(schedulers,/CI fixture cycles are not live Phase 1 cycles/);
  assert.match(cutover,/Three subsequent consecutive live end-to-end cycles/);
  assert.match(cutover,/Phase 2 remains blocked/);
});
