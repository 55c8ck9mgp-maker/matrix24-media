import fs from 'node:fs';
const bad=m=>{throw new Error('editorial intake rejected: '+m)};
for(const file of process.argv.slice(2)){
 if(!file.startsWith('editorial/verified/')||!file.endsWith('.json')||file.includes('..'))bad('invalid path');
 const d=JSON.parse(fs.readFileSync(file,'utf8')), urls=new Set(d.verified_source_urls);
 if(d.promotion_eligible!==false||!String(d.candidate_status).includes('requires_editorial_promotion'))bad('explicit non-promotable status required');
 if(!Array.isArray(d.verified_source_urls)||urls.size<2||![...urls].every(x=>String(x).startsWith('https://')))bad('two unique HTTPS sources required');
 if(!Array.isArray(d.source_records)||d.source_records.length<2||d.source_records.some(s=>!s||!urls.has(s.url)||!Array.isArray(s.supports)||!s.supports.length))bad('source records must be verified and supported');
 if(!Array.isArray(d.claim_checks)||!d.claim_checks.length||d.claim_checks.some(c=>!c||!String(c.claim).trim()||!Array.isArray(c.supporting_urls)||!c.supporting_urls.length||c.supporting_urls.some(u=>!urls.has(u))))bad('claims must cite verified sources');
}
console.log('editorial intake validation: accepted');
