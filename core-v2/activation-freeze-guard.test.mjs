import assert from "node:assert/strict";import {assertActivationSafe} from "./activation-freeze-guard.mjs";
assert.deepEqual(assertActivationSafe(),{safe:true});
assert.throws(()=>assertActivationSafe({legacyEnabled:["claude-publisher.yml"]}),/LEGACY_MUTATOR_CONFLICT/);
assert.throws(()=>assertActivationSafe({activeClaims:["x"]}),/ACTIVE_LEGACY_CLAIMS/);
assert.deepEqual(assertActivationSafe({legacyEnabled:["production-state-audit.yml"]}),{safe:true});
console.log("Core v2 activation freeze guard: PASS");
