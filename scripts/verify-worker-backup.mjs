import fs from "node:fs";
import crypto from "node:crypto";

const sourcePath =
  "worker/backups/v3.2.0/recovery/index.reconstructed.js";
const manifestPath = "worker/backups/v3.2.0/MANIFEST.json";
const configPath = "worker/backups/v3.2.0/config.inventory.json";
const stagingConfigPath = "worker/staging/v3.2.0/wrangler.jsonc";

const source = fs.readFileSync(sourcePath);
const text = source.toString("utf8");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const stagingConfig = fs.readFileSync(stagingConfigPath, "utf8");

const actualHash = crypto.createHash("sha256").update(source).digest("hex");
const actualBytes = source.length;

if (actualHash !== manifest.reconstructed_source.sha256) {
  throw new Error("Backup SHA-256 mismatch: " + actualHash);
}

if (actualBytes !== manifest.reconstructed_source.bytes) {
  throw new Error("Backup byte-count mismatch: " + actualBytes);
}

const requiredSourceMarkers = [
  'const VERSION = "3.2.0";',
  "env.MATRIX24_API_TOKEN",
  "async function processQueue(env)",
  "story.status = 'processing_media';",
  "story.media_claim = {id:requestId, started_at:nowIso()};",
  "story.status = 'ready_to_publish';",
  "ctx.waitUntil(processQueue(env))",
  "QUEUE_ID_INVALID_OR_DUPLICATE"
];

for (const marker of requiredSourceMarkers) {
  if (!text.includes(marker)) {
    throw new Error("Missing Worker invariant marker: " + marker);
  }
}

const reserveIndex = text.indexOf("story.status = 'processing_media';");
const claimWriteIndex = text.indexOf(
  "await updateQueueFile(record, env, " +
    String.fromCharCode(96) +
    "MATRIX 24: reserve"
);
const renderIndex = text.indexOf("bytes = await renderFinalJpeg(story, env);");

if (!(reserveIndex < claimWriteIndex && claimWriteIndex < renderIndex)) {
  throw new Error("Durable claim must be written before paid render work");
}

if (config.worker_name !== "matrix24-publisher") {
  throw new Error("Unexpected production Worker name");
}

if (!stagingConfig.includes('"name": "matrix24-publisher-staging"')) {
  throw new Error("Staging Worker name is not isolated");
}

if (stagingConfig.includes('"triggers"') || stagingConfig.includes('"crons"')) {
  throw new Error("Staging configuration must not enable cron");
}

if (
  stagingConfig.includes("GITHUB_TOKEN") ||
  stagingConfig.includes("SUPABASE_SECRET_KEY")
) {
  throw new Error("Staging config must not contain production secret bindings");
}

const secretPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/
];

for (const pattern of secretPatterns) {
  if (pattern.test(text)) {
    throw new Error("Possible secret material detected: " + pattern);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      source_sha256: actualHash,
      source_bytes: actualBytes,
      staging_worker: "matrix24-publisher-staging",
      cron_enabled: false,
      production_queue_access: false
    },
    null,
    2
  )
);
