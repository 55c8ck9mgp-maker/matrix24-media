import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEditorialDraft } from '../scripts/validate-editorial-intake.mjs';

const a='https://example.com/reuters', b='https://example.org/ap', c='https://authority.example.gov/result';
function base() {
  return {
    content_id:'matrix24-test-story', researched_at:'2026-09-25T00:00:00Z', event_date:'2026-09-24',
    headline:'Test story', category:'Sports', editorial_category:'Sports', caption:'Caption',
    image_generation_prompt:'Prompt', verification_note:'Claim consensus checked',
    verification_status:'verified_claim_consensus', candidate_status:'verified_draft_requires_editorial_promotion', promotion_eligible:false,
    verified_source_urls:[a,b],
    source_records:[
      {source_name:'Reuters', independent_source_id:'reuters', source_role:'independent_report', url:a, supports:['Result was 2:04.83']},
      {source_name:'AP', independent_source_id:'ap', source_role:'independent_report', url:b, supports:['Time recorded as 2:04.83']}
    ],
    claim_checks:[{claim:'The result was 2:04.83', material:true, normalized_value:'2:04.83',
      observations:[{url:a,normalized_value:'2:04.83'},{url:b,normalized_value:'2:04.83'}]}]
  };
}

test('2/2 semantic consensus passes even when source wording differs',()=>assert.doesNotThrow(()=>validateEditorialDraft(base())));

test('1/2 support fails closed',()=>{
  const d=base(); d.claim_checks[0].observations=[{url:a,normalized_value:'2:04.83'},{url:b,normalized_value:'not_reported'}];
  assert.throws(()=>validateEditorialDraft(d),/at least two independent sources/);
});

test('numeric conflict fails without authoritative resolution',()=>{
  const d=base(); d.claim_checks[0].observations[1].normalized_value='2:04.38';
  assert.throws(()=>validateEditorialDraft(d),/at least two independent sources/);
});

test('material textual conflict fails without authoritative resolution',()=>{
  const d=base(); d.claim_checks[0]={claim:'Team won the final',material:true,normalized_value:'won',
    observations:[{url:a,normalized_value:'won'},{url:b,normalized_value:'lost'}]};
  assert.throws(()=>validateEditorialDraft(d),/at least two independent sources/);
});

test('third primary authority resolves a conflict only when it corroborates an independent source',()=>{
  const d=base(); d.verified_source_urls.push(c);
  d.source_records.push({source_name:'Official results',independent_source_id:'official-results',source_role:'primary_authority',url:c,supports:['Result was 2:04.83']});
  d.claim_checks[0].observations=[{url:a,normalized_value:'2:04.83'},{url:b,normalized_value:'2:04.38'},{url:c,normalized_value:'2:04.83'}];
  d.claim_checks[0].resolution={method:'primary_authority_tiebreak',authoritative_url:c,rationale:'Official result corroborates Reuters value.'};
  assert.doesNotThrow(()=>validateEditorialDraft(d));
});

test('two URLs from the same underlying source are not independent consensus',()=>{
  const d=base(); d.source_records[1].independent_source_id='reuters';
  assert.throws(()=>validateEditorialDraft(d),/at least two independent sources/);
});

test('promotion eligibility remains false at intake',()=>{
  const d=base(); d.promotion_eligible=true;
  assert.throws(()=>validateEditorialDraft(d),/promotion_eligible must be false/);
});

test('claims cannot cite URLs outside verified source set',()=>{
  const d=base(); d.claim_checks[0].observations[1].url='https://unverified.example.net/source';
  assert.throws(()=>validateEditorialDraft(d),/outside verified_source_urls/);
});
