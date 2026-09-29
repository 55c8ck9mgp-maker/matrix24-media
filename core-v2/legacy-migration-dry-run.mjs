#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const dir=process.argv[2]||"queue";
const files=fs.readdirSync(dir).filter(f=>f.endsWith(".json")).sort();
const seen=new Set(), rows=[], errors=[];

function classify(r){
 const evidence=Boolean(r.instagram_media_id || r.instagram_permalink);
 const claim=Boolean(r.publish_attempt_id || r.publishing_started_at);
 if(r.status==="published"){
   if(!evidence) return {target:null,reason:"published_without_positive_evidence"};
   if(claim) return {target:null,reason:"published_retains_active_claim"};
   return {target:"published",reason:"positive_external_evidence"};
 }
 if(r.status==="discarded") return {target:"discarded",reason:"legacy_terminal_discard"};
 if(evidence) return {target:null,reason:"nonterminal_with_positive_external_evidence_requires_reconciliation"};
 if(r.status==="ready_to_publish" && !claim) return {target:"ready_to_publish",reason:"pending_unclaimed_work"};
 if(r.status==="publishing" || r.status==="publish_unknown") return {target:null,reason:"active_or_uncertain_legacy_attempt_requires_reconciliation"};
 if(["blocked_media","processing_media"].includes(r.status)) return {target:null,reason:"legacy_media_state_requires_rebuild"};
 return {target:null,reason:`unmapped_legacy_state:${r.status}`};
}

for(const file of files){
 const r=JSON.parse(fs.readFileSync(path.join(dir,file),"utf8"));
 if(!r.content_id){ errors.push({file,error:"missing_content_id"}); continue; }
 if(seen.has(r.content_id)){ errors.push({file,content_id:r.content_id,error:"duplicate_content_id"}); continue; }
 seen.add(r.content_id);
 const c=classify(r);
 rows.push({file,content_id:r.content_id,legacy_status:r.status,target_status:c.target,reason:c.reason});
}
const counts=rows.reduce((a,r)=>{const k=r.target_status||"manual_review";a[k]=(a[k]||0)+1;return a;},{});
const report={mode:"DRY_RUN_ONLY",source:dir,total:files.length,unique_content_ids:seen.size,duplicates:errors.filter(e=>e.error==="duplicate_content_id").length,errors,counts,records:rows};
console.log(JSON.stringify(report,null,2));
if(errors.length) process.exit(2);
