import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildQueueIndex } from '../scripts/build-queue-index.mjs';

test('queue index is a complete non-authoritative derivation of queue blobs',()=>{
  const idx=buildQueueIndex();
  assert.equal(idx.authoritative,false);
  assert.equal(idx.source,'derived_from_queue_blobs');
  assert.equal(idx.queue_records,fs.readdirSync('queue').filter(n=>n.endsWith('.json')).length);
  assert.equal(new Set(idx.entries.map(e=>e.content_id)).size,idx.entries.length);
  for(const e of idx.entries){
    assert.match(e.path,/^queue\/matrix24-[a-z0-9-]+\.json$/);
    assert.match(e.blob_sha,/^[a-f0-9]{40}$/);
    assert.equal(e.actionable,['ready_to_publish','publishing','publish_unknown'].includes(e.status));
  }
});
