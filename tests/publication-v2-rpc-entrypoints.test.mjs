import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Cloudflare configs point at modules exporting RPC entrypoints',()=>{
 const runtime=JSON.parse(fs.readFileSync('publisher-v2/private-runtime/wrangler.jsonc','utf8'));
 const caller=JSON.parse(fs.readFileSync('publisher-v2/identity-caller/wrangler.jsonc','utf8'));
 assert.equal(runtime.main,'src/cloudflare-entry.mjs');
 assert.equal(caller.main,'src/cloudflare-entry.mjs');
 const runtimeEntry=fs.readFileSync('publisher-v2/private-runtime/src/cloudflare-entry.mjs','utf8');
 const callerEntry=fs.readFileSync('publisher-v2/identity-caller/src/cloudflare-entry.mjs','utf8');
 assert.match(runtimeEntry,/class IdentityPreflight extends WorkerEntrypoint/);
 assert.match(callerEntry,/class IdentityGate extends WorkerEntrypoint/);
});
