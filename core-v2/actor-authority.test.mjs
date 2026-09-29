import assert from "node:assert/strict";
import {ACTORS,assertActorAuthorized} from "./actor-authority.mjs";
assert.equal(assertActorAuthorized("ready_to_publish","publishing",ACTORS.PUBLISHER),true);
assert.throws(()=>assertActorAuthorized("ready_to_publish","publishing",ACTORS.CHATGPT),/ACTOR_NOT_AUTHORIZED/);
assert.throws(()=>assertActorAuthorized("ready_to_publish","publishing",ACTORS.AUDITOR),/ACTOR_NOT_AUTHORIZED/);
assert.throws(()=>assertActorAuthorized("publishing","published",ACTORS.PUBLISHER),/ACTOR_NOT_AUTHORIZED/);
assert.equal(assertActorAuthorized("publishing","published",ACTORS.RECONCILER),true);
console.log("Core v2 actor authority tests: PASS");
