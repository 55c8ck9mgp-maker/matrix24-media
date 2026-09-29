import crypto from "node:crypto";
export function preparePublishAttempt(record,{mode="DRY_RUN"}={}){
 if(mode!=="DRY_RUN") throw new Error("CORE_V2_EXTERNAL_PUBLISH_DISABLED");
 if(record.status!=="ready_to_publish") throw new Error("NOT_READY_TO_PUBLISH");
 if(record.publish_attempt_id||record.claim_id) throw new Error("ACTIVE_OR_STALE_CLAIM_PRESENT");
 const attempt_id="dry_"+crypto.createHash("sha256").update(record.content_id).digest("hex").slice(0,16);
 return {mode:"DRY_RUN",actor:"assistant/chatgpt-publisher",content_id:record.content_id,attempt_id,external_calls:0,next_status:"publishing"};
}
export function executeExternalPublish(){throw new Error("CORE_V2_NETWORK_BARRIER_ACTIVE");}
