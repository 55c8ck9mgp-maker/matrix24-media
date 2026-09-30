import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync('.github/workflows/deploy-publication-v2-private-staging.yml','utf8');
const config=JSON.parse(fs.readFileSync('publisher-v2/private-runtime/wrangler.jsonc','utf8'));

test('private staging deploy is manual-only and production-inert',()=>{
 assert.match(workflow,/workflow_dispatch:/);
 assert.doesNotMatch(workflow,/^\s*schedule\s*:/m);
 assert.match(workflow,/permissions:\s*\n\s*contents:\s*read/);
 assert.match(workflow,/deploy --dry-run --config publisher-v2\/private-runtime\/wrangler\.jsonc/);
 assert.match(workflow,/environment:\s*publication-v2-staging/);
 assert.equal(config.workers_dev,false);
 assert.equal(config.preview_urls,false);
 assert.equal(config.vars.PUBLISHER_V2_ENABLED,'false');
 assert.equal(config.vars.STAGING_REPOSITORY,'55c8ck9mgp-maker/matrix24-publication-v2-staging');
});
