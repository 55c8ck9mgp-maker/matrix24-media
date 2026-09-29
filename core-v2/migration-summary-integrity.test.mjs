#!/usr/bin/env node
import fs from "node:fs"; import {execFileSync} from "node:child_process";
execFileSync(process.execPath,["core-v2/generate-migration-summary.mjs"],{stdio:"inherit"});
if(!fs.existsSync("core-v2/MIGRATION-SUMMARY.md")) throw new Error("MIGRATION_SUMMARY_NOT_GENERATED");
const s=fs.readFileSync("core-v2/MIGRATION-SUMMARY.md","utf8");
const counts=[...s.matchAll(/^## (published|ready_to_publish|discarded|manual_review) \((\d+)\)$/gm)];
if(counts.length!==4) throw new Error("MIGRATION_SUMMARY_COUNTS_MISSING");
const total=counts.reduce((n,m)=>n+Number(m[2]),0);
if(total!==25) throw new Error(`MIGRATION_SUMMARY_TOTAL_EXPECTED_25_ACTUAL_${total}`);
console.log("Migration summary integrity: PASS (25/25 classified)");
