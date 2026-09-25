import fs from 'node:fs';
for (const file of process.argv.slice(2)) {
 if (!file.startsWith('editorial/verified/')||!file.endsWith('.json')||file.includes('..')) throw new Error('editorial intake rejected: invalid path');
 const d=JSON.parse(fs.readFileSync(file,'utf8'));
 if (d.promotion_eligible!==false) throw new Error('editorial intake rejected: promotion must be false');
 if (!String(d.candidate_status).includes('requires_editorial_promotion')) throw new Error('editorial intake rejected: explicit promotion required');
 if (!Array.isArray(d.verified_source_urls)||new Set(d.verified_source_urls).size<2||!d.verified_source_urls.every(x=>String(x).startsWith('https://'))) throw new Error('editorial intake rejected: two HTTPS sources required');
 if (!Array.isArray(d.source_records)||d.source_records.length<2||!Array.isArray(d.claim_checks)||!d.claim_checks.length) throw new Error('editorial intake rejected: evidence incomplete');
}
console.log('editorial intake validation: accepted');
