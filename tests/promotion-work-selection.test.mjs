import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectPromotionWork } from '../scripts/select-promotion-work.mjs';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function draft(id) {
  return {
    content_id:id, researched_at:'2026-09-27T00:00:00Z', event_date:'2026-09-27',
    headline:'Fixture', category:'World', editorial_category:'World', caption:'Caption',
    image_generation_prompt:'Prompt', verification_note:'Verified',
    verification_status:'verified_claim_consensus', candidate_status:'verified_draft_requires_editorial_promotion',
    promotion_eligible:false, verified_source_urls:['https://a.example/x','https://b.example/y'],
    source_records:[
      {source_name:'A',independent_source_id:'a',source_role:'independent_report',url:'https://a.example/x',supports:['claim']},
      {source_name:'B',independent_source_id:'b',source_role:'independent_report',url:'https://b.example/y',supports:['claim']}
    ],
    claim_checks:[{claim:'claim',material:true,normalized_value:'yes',observations:[
      {url:'https://a.example/x',normalized_value:'yes'},{url:'https://b.example/y',normalized_value:'yes'}
    ]}]
  };
}

function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'matrix24-selector-'));
  fs.mkdirSync(path.join(root,'editorial','promotions'),{recursive:true});
  fs.mkdirSync(path.join(root,'editorial','verified'),{recursive:true});
  fs.mkdirSync(path.join(root,'queue'),{recursive:true});
  return root;
}

function writeCandidate(root,id,{valid=true}={}) {
  const d=draft(id);
  const draftText=`${JSON.stringify(d,null,2)}\n`;
  fs.writeFileSync(path.join(root,'editorial','verified',`${id}.json`),draftText);
  fs.writeFileSync(path.join(root,'editorial','promotions',`${id}.json`),JSON.stringify({
    content_id:id,
    draft_path:`editorial/verified/${id}.json`,
    draft_sha256:valid ? sha(draftText) : '0'.repeat(64),
    approved:true,
    approved_at:'2026-09-27T00:01:00Z',
    approval_note:'Fixture approval'
  },null,2));
}

test('selector ignores already-admitted legacy manifests and chooses next valid canonical candidate',()=>{
  const root=fixture();
  const legacy='matrix24-a-legacy';
  fs.writeFileSync(path.join(root,'editorial','promotions',`${legacy}.json`),JSON.stringify({
    draft_path:`editorial/verified/${legacy}.json`,draft_sha256:'0'.repeat(64),approved:true,
    approved_at:'2026-09-27T00:00:00Z',approval_note:'legacy'
  }));
  fs.writeFileSync(path.join(root,'queue',`${legacy}.json`),JSON.stringify({content_id:legacy,status:'published',instagram_permalink:'https://www.instagram.com/p/legacy/'}));
  const id='matrix24-b-valid'; writeCandidate(root,id);
  const r=selectPromotionWork({root});
  assert.equal(r.action,'promote');
  assert.equal(r.content_id,id);
  assert.equal(r.quarantined.length,0);
});

test('invalid approved candidate is quarantined without starving a later valid candidate',()=>{
  const root=fixture();
  writeCandidate(root,'matrix24-a-invalid',{valid:false});
  writeCandidate(root,'matrix24-b-valid');
  const r=selectPromotionWork({root});
  assert.equal(r.action,'promote');
  assert.equal(r.content_id,'matrix24-b-valid');
  assert.equal(r.quarantined.length,1);
  assert.equal(r.quarantined[0].content_id,'matrix24-a-invalid');
});

test('approved legacy manifest without an admitted queue is quarantined and no-ops safely',()=>{
  const root=fixture();
  fs.writeFileSync(path.join(root,'editorial','promotions','matrix24-a-legacy.json'),JSON.stringify({
    approved:true,draft_path:'editorial/verified/matrix24-a-legacy.json',draft_sha256:'0'.repeat(64),
    approved_at:'2026-09-27T00:00:00Z',approval_note:'legacy'
  }));
  const r=selectPromotionWork({root});
  assert.equal(r.action,'noop');
  assert.equal(r.quarantined.length,1);
  assert.match(r.quarantined[0].reason,/legacy_manifest_missing_content_id/);
});
