export const LEGACY_MUTATORS=[
"claude-publisher.yml","editorial-intake.yml","editorial-queue-promotion.yml","media-claim-reconciliation.yml",
"metricool-recovery.yml","publication-reservation.yml","instagram-reconciliation.yml"
];
export function assertActivationSafe({legacyEnabled=[],activeClaims=[]}={}){
 const conflicts=legacyEnabled.filter(x=>LEGACY_MUTATORS.includes(x));
 if(conflicts.length) throw new Error("LEGACY_MUTATOR_CONFLICT:"+conflicts.join(","));
 if(activeClaims.length) throw new Error("ACTIVE_LEGACY_CLAIMS:"+activeClaims.join(","));
 return {safe:true};
}
