export function evaluateReadiness(g={}){
 const required=["contract","authority","reconciler","exactly_once","publisher_isolation","failure_simulation","freeze_guard","migration_integrity","import_write_lock","three_dry_cycles"];
 const missing=required.filter(k=>g[k]!==true);
 return missing.length?{status:"NOT_READY",missing}:{status:"READY_FOR_OWNER_APPROVAL",live_enabled:false};
}
