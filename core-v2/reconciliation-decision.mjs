export function decideReconciliation(record,match){
 if(!["publishing","publish_unknown"].includes(record.status)) return {action:"NOOP",reason:"not_reconcilable"};
 const claim=record.publish_attempt_id||record.claim_id;
 if(!claim) return {action:"BLOCK",reason:"missing_active_claim"};
 if(match.status==="matched") return {action:"CLOSE_EXISTING_CLAIM",target_status:"published",claim_id:claim,external_post_id:match.post?.id||match.post?.instagram_media_id||null};
 if(match.status==="ambiguous") return {action:"KEEP_CLAIM",target_status:"publish_unknown",reason:"ambiguous_external_evidence"};
 return {action:"KEEP_CLAIM",target_status:"publish_unknown",reason:"external_evidence_not_confirmed"};
}
export function mayPublish(record){
 return record.status==="ready_to_publish" && !(record.publish_attempt_id||record.claim_id);
}
