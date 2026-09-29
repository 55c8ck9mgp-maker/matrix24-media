import assert from "node:assert/strict"; import {reconcileMatch} from "./reconciler-match.mjs";
const q={content_id:"x1",caption:"Major storm hits region with flooding and evacuations",media_sha256:"abc"};
assert.equal(reconcileMatch(q,[{caption:"Major storm hits region"}]).status,"matched");
assert.equal(reconcileMatch(q,[{caption:q.caption}]).status,"matched");
assert.equal(reconcileMatch(q,[{caption:"Unrelated story"}]).status,"no_match");
assert.equal(reconcileMatch(q,[{caption:"Major storm hits region"},{caption:"Major storm hits region"}]).status,"ambiguous");
assert.equal(reconcileMatch({...q,provider_receipt:"r1"},[{id:"r1",caption:"anything"}]).status,"matched");
assert.equal(reconcileMatch(q,[{content_id:"x1",caption:"anything"}]).status,"matched");
console.log("Core v2 reconciler matching fixtures: PASS");
