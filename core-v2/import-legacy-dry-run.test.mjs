#!/usr/bin/env node
import {spawnSync} from "node:child_process";
const dry=spawnSync(process.execPath,["core-v2/import-legacy-dry-run.mjs"],{encoding:"utf8"});
if(dry.status!==0) throw new Error("DRY_RUN_FAILED");
const write=spawnSync(process.execPath,["core-v2/import-legacy-dry-run.mjs","--write"],{encoding:"utf8"});
if(write.status!==42 || !write.stderr.includes("CORE_V2_IMPORT_WRITE_DISABLED")) throw new Error("WRITE_GUARD_FAILED");
console.log("Core v2 importer safety: PASS (dry-run allowed, write blocked)");
