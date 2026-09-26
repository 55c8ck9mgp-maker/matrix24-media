import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateProvenanceReconciliation } from '../scripts/validate-provenance-reconciliation.mjs';

const bytes=Buffer.from('consensus draft\n');
const digest=crypto.createHash('sha256').update(bytes).digest('hex');
const base={content_id:'matrix24-test',status:'ready_to_publish',public_image_url:'https://cdn.example/x.jpg',image_filename:'x.jpg',media_ready_at:'2026-09-26T00:00:00Z',image_spec:{format:'JPEG',width:1080,height:1350},publish_attempt_history:[{stage:'media_pipeline',result:'success'}],verification_status:'verified_two_independent_reports',editorial_promotion:{manifest_path:'editorial/promotions/matrix24-test.json',draft_sha256:'old'}};
const after={...structuredClone(base),verification_status:'verified_claim_consensus',editorial_promotion:{...base.editorial_promotion,draft_sha256:digest}};
const manifest={draft_sha256:digest};

function withQueues(records, fn) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'matrix24-prov-'));
 try {
  const files=records.map((record,i)=>{const p=path.join(root,`q${i}.json`);fs.writeFileSync(p,JSON.stringify(record));return p;});
  return fn(files);
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
}
function args(queueFiles, extra={}){return {before:structuredClone(base),after:structuredClone(after),draftBytes:bytes,manifest:{...manifest},queueFiles,...extra};}

test('accepts one queue record with immutable media/state/history and exact draft binding',()=>withQueues([after],files=>{
 const result=validateProvenanceReconciliation(args(files)); assert.equal(result.queue_records,1); assert.equal(result.draft_sha256,digest);
}));
test('rejects duplicate queue admission',()=>withQueues([after,after],files=>assert.throws(()=>validateProvenanceReconciliation(args(files)),/exactly one queue record, found 2/)));
test('rejects media mutation',()=>withQueues([after],files=>{const a=args(files);a.after.public_image_url='https://cdn.example/y.jpg';assert.throws(()=>validateProvenanceReconciliation(a),/public_image_url changed/);}));
test('rejects history mutation',()=>withQueues([after],files=>{const a=args(files);a.after.publish_attempt_history.push({stage:'publisher'});assert.throws(()=>validateProvenanceReconciliation(a),/publish_attempt_history changed/);}));
test('rejects stale manifest digest',()=>withQueues([after],files=>{const a=args(files);a.manifest.draft_sha256='0'.repeat(64);assert.throws(()=>validateProvenanceReconciliation(a),/manifest is not bound/);}));
