#!/usr/bin/env node
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
const dir=process.argv[2]||"queue";
const files=fs.readdirSync(dir).filter(f=>f.endsWith(".json")).sort();
const seen=new Set(), records=[];
function classify(r){
 const evidence=Boolean(r.instagram_media_id||r.instagram_permalink);
 const claim=Boolean(r.publish_attempt_id||r.publishing_started_at);
 if(r.status==="published"&&evidence&&!claim)return ["published","positive_external_evidence"];
 if(r.status==="discarded")return ["discarded","legacy_terminal_discard"];
 if(r.status==="ready_to_publish"&&!claim&&!evidence)return ["ready_to_publish","pending_unclaimed_work"];
 if(evidence)return ["manual_review","external_evidence_requires_reconciliation"];
 if(["publishing","publish_unknown"].includes(r.status))return ["manual_review","legacy_attempt_requires_reconciliation"];
 if(["blocked_media","processing_media"].includes(r.status))return ["manual_review","legacy_media_state_requires_rebuild"];
 return ["manual_review",`unmapped:${r.status}`];
}
for(const file of files){
 const r=JSON.parse(fs.readFileSync(path.join(dir,file),"utf8"));
 if(!r.content_id) throw new Error(`MISSING_CONTENT_ID:${file}`);
 if(seen.has(r.content_id)) throw new Error(`DUPLICATE_CONTENT_ID:${r.content_id}`);
 seen.add(r.content_id); const [target,reason]=classify(r);
 records.push({content_id:r.content_id,source_file:`queue/${file}`,legacy_status:r.status,target_status:target,reason});
}
const canonical=JSON.stringify(records);
const manifest={schema:"matrix24-core-v2-migration-manifest/v1",mode:"DRY_RUN_ONLY",source_count:records.length,unique_content_ids:seen.size,sha256:crypto.createHash("sha256").update(canonical).digest("hex"),records};
console.log(JSON.stringify(manifest,null,2));
