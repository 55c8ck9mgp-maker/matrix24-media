#!/usr/bin/env node
import fs from "node:fs";
import {execFileSync} from "node:child_process";
const raw=execFileSync(process.execPath,["core-v2/generate-migration-manifest.mjs","queue"],{encoding:"utf8"});
const m=JSON.parse(raw);
const groups={published:[],ready_to_publish:[],discarded:[],manual_review:[]};
for(const r of m.records)(groups[r.target_status]??groups.manual_review).push(r);
const lines=[
 "# Core v2 Legacy Migration Summary","",
 `Generated from ${m.source_count} legacy queue records.`,
 `Manifest SHA-256: \`${m.sha256}\``,"",
 ...Object.entries(groups).flatMap(([k,v])=>[
   `## ${k} (${v.length})`,
   ...(v.length?v.map(r=>`- ${r.content_id} — legacy: ${r.legacy_status}; reason: ${r.reason}`):["- None"]),
   ""
 ])
];
const out=lines.join("\n");
fs.writeFileSync("core-v2/MIGRATION-SUMMARY.md",out);
console.log(out);
