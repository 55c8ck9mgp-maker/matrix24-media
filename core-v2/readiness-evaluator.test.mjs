import assert from "node:assert/strict";import {evaluateReadiness} from "./readiness-evaluator.mjs";
const all={contract:true,authority:true,reconciler:true,exactly_once:true,publisher_isolation:true,failure_simulation:true,freeze_guard:true,migration_integrity:true,import_write_lock:true,three_dry_cycles:true};
let r=evaluateReadiness(all);assert.equal(r.status,"READY_FOR_OWNER_APPROVAL");assert.equal(r.live_enabled,false);
r=evaluateReadiness({...all,freeze_guard:false});assert.equal(r.status,"NOT_READY");assert.deepEqual(r.missing,["freeze_guard"]);
console.log("Core v2 readiness evaluator: PASS (cannot enable live)");
