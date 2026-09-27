import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditProductionState } from '../scripts/audit-production-state.mjs';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function root() {
  const r=fs.mkdtempSync(path.join(os.tmpdir(),'matrix24-audit-'));
  for (const d of ['queue','editorial/verified','editorial/promotions']) fs.mkdirSync(path.join(r,d),{recursive:true});
  return r;
}
function write(r,p,value) { fs.writeFileSync(path.join(r,p),typeof value==='string'?value:`${JSON.stringify(value,null,2)}\n`); }
function editorial(r,id,{legacy=false}={}) {
  const draftText=`${JSON.stringify({content_id:id},null,2)}\n`;
  write(r,`editorial/verified/${id}.json`,draftText);
  write(r,`editorial/promotions/${id}.json`,{
    ...(legacy?{}:{content_id:id}),
    draft_path:`editorial/verified/${id}.json`,
    draft_sha256:sha(draftText),
    approved:true,
    approved_at:'2026-09-27T00:00:00Z',
    approval_note:'fixture'
  });
  return sha(draftText);
}

test('current terminal publication may be confirmed by Instagram permalink without media ID',()=>{
  const r=root(), id='matrix24-terminal';
  editorial(r,id,{legacy:true});
  write(r,`queue/${id}.json`,{content_id:id,status:'published',instagram_permalink:'https://www.instagram.com/p/example/'});
  const result=auditProductionState({root:r});
  assert.equal(result.ok,true);
  assert.equal(result.warnings.length,1);
});

test('active ready record requires media contract and canonical approval provenance',()=>{
  const r=root(), id='matrix24-ready', draftSha=editorial(r,id);
  write(r,`queue/${id}.json`,{
    content_id:id,status:'ready_to_publish',
    public_image_url:'https://example.test/media.jpg',
    image_spec:{format:'JPEG',mode:'RGB',width:1080,height:1350,alpha:false},
    editorial_promotion:{
      manifest_path:`editorial/promotions/${id}.json`,
      draft_path:`editorial/verified/${id}.json`,
      draft_sha256:draftSha
    }
  });
  assert.equal(auditProductionState({root:r}).ok,true);
});

test('approved legacy manifest without queue is an actionable invariant failure',()=>{
  const r=root(), id='matrix24-orphan';
  editorial(r,id,{legacy:true});
  const result=auditProductionState({root:r});
  assert.equal(result.ok,false);
  assert.ok(result.findings.some(f=>f.issue==='approved_legacy_manifest_without_content_id_and_without_admitted_queue'));
});

test('duplicate or contradictory queue state fails closed',()=>{
  const r=root(), id='matrix24-bad'; editorial(r,id);
  write(r,`queue/${id}.json`,{content_id:id,status:'published'});
  const result=auditProductionState({root:r});
  assert.equal(result.ok,false);
  assert.ok(result.findings.some(f=>f.issue==='published_without_positive_publication_evidence'));
});
