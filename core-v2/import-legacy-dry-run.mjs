#!/usr/bin/env node
import fs from "node:fs";
import {execFileSync} from "node:child_process";

const args=new Set(process.argv.slice(2));
if(args.has("--write")) {
  console.error("CORE_V2_IMPORT_WRITE_DISABLED");
  process.exit(42);
}
const raw=execFileSync(process.execPath,["core-v2/generate-migration-manifest.mjs","queue"],{encoding:"utf8"});
const m=JSON.parse(raw);
const safe=new Set(["published","ready_to_publish","discarded"]);
const importable=[],manual=[];
for(const r of m.records) (safe.has(r.target_status)?importable:manual).push(r);
if(importable.length+manual.length!==m.source_count) throw new Error("IMPORT_PLAN_COUNT_MISMATCH");
const plan={
 schema:"matrix24-core-v2-import-plan/v1",
 mode:"WRITE_DISABLED",
 source_manifest_sha256:m.sha256,
 source_count:m.source_count,
 importable_count:importable.length,
 manual_review_count:manual.length,
 importable,
 manual_review:manual
};
fs.writeFileSync("core-v2-import-plan.json",JSON.stringify(plan,null,2)+"\n");
console.log(JSON.stringify({mode:plan.mode,source_count:plan.source_count,importable_count:plan.importable_count,manual_review_count:plan.manual_review_count},null,2));
