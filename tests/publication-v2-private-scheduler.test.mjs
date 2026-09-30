import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('private publication scheduler is identity-gated and staging-only',()=>{
 const cfg=JSON.parse(fs.readFileSync('publisher-v2/private-scheduler/wrangler.jsonc','utf8'));
 assert.equal(cfg.workers_dev,false);
 assert.equal(cfg.preview_urls,false);
 assert.equal(cfg.vars.PUBLISHER_V2_ENABLED,'false');
 assert.equal(cfg.vars.STAGING_REPOSITORY,'55c8ck9mgp-maker/matrix24-publication-v2-staging');
 assert.deepEqual(cfg.services,[{binding:'IDENTITY_GATE',service:'matrix24-publisher-v2-identity-caller',entrypoint:'IdentityGate'}]);
 const src=fs.readFileSync('publisher-v2/private-scheduler/src/index.mjs','utf8');
 assert.match(src,/await env\.IDENTITY_GATE\.run\(\)/);
 assert.match(src,/PUBLISHER_V2_ENABLED !== 'false'/);
 assert.doesNotMatch(src,/metricool|instagram|api\.github\.com/i);
});
