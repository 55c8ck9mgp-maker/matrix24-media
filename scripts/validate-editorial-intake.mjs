import fs from 'node:fs';
import path from 'node:path';
const REQUIRED=['content_id','researched_at','event_date','headline','category','editorial_category','caption','image_generation_prompt','verification_note','verification_status','candidate_status'];
const fail=m=>{throw new Error('editorial intake rejected: '+m)};
const https=(v,n)=>{if(typeof v!=='string')fail(n+' must be a string');try{if(new URL(v).protocol!=='https:')fail(n+' must use https')}catch{fail(n+' must be a valid https URL')}};
export function validateEditorialDraft(d,file='draft'){
 if(!d||typeof d!=='object'||Array.isArray(d))fail(file+' must contain a JSON object');for(const k of REQUIRED)if(typeof d[k]!=='string'||!d[k].trim())fail(file+'.'+k+' is required');
 if(d.promotion_eligible!==false)fail(file+'.promotion_eligible must be false at intake');if(!d.candidate_status.includes('requires_editorial_promotion'))fail(file+'.candidate_status must require explicit editorial promotion');
 if(!Array.isArray(d.verified_source_urls)||d.verified_source_urls.length<2)fail(file+'.verified_source_urls needs at least two sources');const urls=new Set(d.verified_source_urls);if(urls.size!==d.verified_source_urls.length)fail(file+'.verified_source_urls must be unique');for(const u of urls)https(u,file+'.verified_source_urls');
 if(!Array.isArray(d.source_records)||d.source_records.length<2)fail(file+'.source_records needs at least two records');for(const [i,s] of d.source_records.entries()){if(!s||typeof s!=='object'||typeof s.source_name!=='string'||!s.source_name.trim())fail(file+'.source_records['+i+'] is incomplete');https(s.url,file+'.source_records['+i+'].url');if(!urls.has(s.url)||!Array.isArray(s.supports)||!s.supports.length||s.supports.some(x=>typeof x!=='string'||!x.trim()))fail(file+'.source_records['+i+'] must be verified and supported')}
 if(!Array.isArray(d.claim_checks)||!d.claim_checks.length)fail(file+'.claim_checks needs at least one check');for(const [i,c] of d.claim_checks.entries()){if(!c||typeof c.claim!=='string'||!c.claim.trim()||!Array.isArray(c.supporting_urls)||!c.supporting_urls.length)fail(file+'.claim_checks['+i+'] is incomplete');for(const u of c.supporting_urls){https(u,file+'.claim_checks['+i+'].supporting_urls');if(!urls.has(u))fail(file+'.claim_checks['+i+'] cites a URL outside verified_source_urls')}}
}
export function validateEditorialIntakeFiles(files,cwd=process.cwd()){
 if(!Array.isArray(files)||!files.length)fail('no changed intake files supplied');for(const file of files){if(typeof file!=='string'||!file.startsWith('editorial/verified/')||!file.endsWith('.json')||file.includes('..'))fail('invalid path');const root=path.resolve(cwd,'editorial/verified'),absolute=path.resolve(cwd,file);if(!absolute.startsWith(root+path.sep))fail('path escapes editorial intake');let d;try{d=JSON.parse(fs.readFileSync(absolute,'utf8'))}catch{fail(file+' is not readable JSON')}validateEditorialDraft(d,file)}return{status:'accepted',files:files.length};
}
if(import.meta.url==='file://'+process.argv[1]){const r=validateEditorialIntakeFiles(process.argv.slice(2));console.log('editorial intake validation: '+r.status+' ('+r.files+' file'+(r.files===1?'':'s')+')')}
