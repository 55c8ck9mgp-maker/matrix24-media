import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const INDEX_PATH = 'queue-index.json';
const ACTIONABLE = new Set(['ready_to_publish','publishing','publish_unknown']);

function gitBlobSha(content) {
  const h=crypto.createHash('sha1');
  h.update(`blob ${Buffer.byteLength(content,'utf8')}\0`,'utf8');
  h.update(content,'utf8');
  return h.digest('hex');
}

export function buildQueueIndex({root=process.cwd()}={}) {
  const dir=path.join(root,'queue');
  const entries=fs.readdirSync(dir).filter(n=>n.endsWith('.json')).sort().map(name=>{
    const rel=`queue/${name}`;
    const raw=fs.readFileSync(path.join(root,rel),'utf8');
    const r=JSON.parse(raw);
    return {
      content_id:r.content_id,
      status:r.status,
      path:rel,
      blob_sha:gitBlobSha(raw),
      actionable:ACTIONABLE.has(r.status),
      publish_attempt_id:r.publish_attempt_id || null,
      publishing_started_at:r.publishing_started_at || null
    };
  });
  return {schema_version:1,authoritative:false,source:'derived_from_queue_blobs',queue_records:entries.length,entries};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const index=buildQueueIndex();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index,null,2)+'\n');
  console.log(JSON.stringify({ok:true,path:INDEX_PATH,queue_records:index.queue_records,actionable:index.entries.filter(e=>e.actionable).length}));
}
