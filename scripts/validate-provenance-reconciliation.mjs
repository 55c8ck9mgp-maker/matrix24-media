import fs from 'node:fs';
import crypto from 'node:crypto';

function fail(message) { throw new Error(`provenance reconciliation rejected: ${message}`); }
function readJson(path) { return JSON.parse(fs.readFileSync(path, 'utf8')); }
function same(a,b){ return JSON.stringify(a)===JSON.stringify(b); }

export function validateProvenanceReconciliation({ before, after, draftBytes, manifest, queueFiles }) {
  if (before.content_id !== after.content_id) fail('content_id changed');
  if (before.status !== after.status) fail('status changed');
  for (const field of ['public_image_url','image_filename','media_ready_at']) if (before[field] !== after[field]) fail(`${field} changed`);
  if (!same(before.image_spec, after.image_spec)) fail('image_spec changed');
  if (!same(before.publish_attempt_history, after.publish_attempt_history)) fail('publish_attempt_history changed');
  if (after.status !== 'ready_to_publish') fail('record must remain ready_to_publish');
  if (after.verification_status !== 'verified_claim_consensus') fail('queue must carry verified_claim_consensus');
  const digest=crypto.createHash('sha256').update(draftBytes).digest('hex');
  if (manifest.draft_sha256 !== digest) fail('manifest is not bound to current draft bytes');
  if (after.editorial_promotion?.draft_sha256 !== digest) fail('queue is not bound to current draft bytes');
  if (after.editorial_promotion?.manifest_path !== `editorial/promotions/${after.content_id}.json`) fail('manifest path mismatch');
  const occurrences=queueFiles.map(readJson).filter(x=>x.content_id===after.content_id).length;
  if (occurrences !== 1) fail(`expected exactly one queue record, found ${occurrences}`);
  return {status:'accepted',content_id:after.content_id,draft_sha256:digest,queue_records:occurrences};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [beforePath,afterPath,draftPath,manifestPath,...queueFiles]=process.argv.slice(2);
  if (!beforePath||!afterPath||!draftPath||!manifestPath) fail('missing arguments');
  console.log(JSON.stringify(validateProvenanceReconciliation({
    before:readJson(beforePath), after:readJson(afterPath), draftBytes:fs.readFileSync(draftPath),
    manifest:readJson(manifestPath), queueFiles
  })));
}
