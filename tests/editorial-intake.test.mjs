import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEditorialDraft } from '../scripts/validate-editorial-intake.mjs';
const a='https://example.com/reuters',b='https://example.org/ap';
const draft=()=>({content_id:'story',researched_at:'2026-09-25T00:00:00Z',event_date:'2026-09-24',headline:'Headline',category:'News',editorial_category:'News',caption:'Caption',image_generation_prompt:'Prompt',verification_note:'Verified',verification_status:'verified',candidate_status:'verified_draft_requires_editorial_promotion',promotion_eligible:false,verified_source_urls:[a,b],source_records:[{source_name:'Reuters',url:a,supports:['Fact A']},{source_name:'AP',url:b,supports:['Fact B']}],claim_checks:[{claim:'Fact A',supporting_urls:[a]}]});
test('accepts a verified non-promotable two-source draft',()=>assert.doesNotThrow(()=>validateEditorialDraft(draft())));
test('rejects promotable draft',()=>{const d=draft();d.promotion_eligible=true;assert.throws(()=>validateEditorialDraft(d),/promotion_eligible/)});
test('rejects unsupported claim URL',()=>{const d=draft();d.claim_checks[0].supporting_urls=['https://bad.example'];assert.throws(()=>validateEditorialDraft(d),/outside verified_source_urls/)});
test('rejects duplicate sources and missing source names',()=>{const d=draft();d.verified_source_urls=[a,a];assert.throws(()=>validateEditorialDraft(d),/unique/);const e=draft();e.source_records[0].source_name='';assert.throws(()=>validateEditorialDraft(e),/incomplete/)})
