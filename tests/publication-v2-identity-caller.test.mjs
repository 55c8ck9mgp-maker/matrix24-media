import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('private identity caller contract stays fail closed',()=>{
 const config=JSON.parse(fs.readFileSync('publisher-v2/identity-caller/wrangler.jsonc','utf8'));
 assert.equal(config.workers_dev,false);
 assert.equal(config.preview_urls,false);
 assert.equal(config.vars.MATRIX24_MODE,'publisher-v2-identity-preflight');
 assert.equal(config.triggers,undefined);
 assert.deepEqual(config.services,[{
  binding:'PUBLISHER_IDENTITY',
  service:'matrix24-publisher-v2-staging',
  entrypoint:'IdentityPreflight'
 }]);
 const source=fs.readFileSync('publisher-v2/identity-caller/src/index.mjs','utf8');
 assert.match(source,/IDENTITY_SERVICE_BINDING_REQUIRED/);
 assert.match(source,/matrix24-publication-v2-staging/);
 assert.doesNotMatch(source,/metricool|instagram|api\.github\.com/i);
});
