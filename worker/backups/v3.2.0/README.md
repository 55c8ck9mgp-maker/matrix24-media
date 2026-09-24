# MATRIX 24 Worker v3.2.0 Backup

This directory is the Phase 2 recovery backup for the production Cloudflare Worker `matrix24-publisher`.

## Safety status

- No production deployment was performed.
- No production queue record was modified.
- No Auto Publisher state was modified.
- No social publishing action was performed.
- No secrets are stored here.

## Files

- `audited-source.md` — verbatim archived source artifact recovered from the audited MATRIX 24 conversation source.
- `recovery/index.reconstructed.js` — normalized recovery-grade JavaScript reconstructed from the markdown-escaped audit artifact.
- `MANIFEST.json` — provenance, validation and SHA-256 metadata.
- `config.inventory.json` — non-secret runtime/binding inventory.
- `ROLLBACK.md` — recovery procedure and guardrails.

## Important limitation

The source available for archival was a markdown-escaped audit copy rather than a direct byte-for-byte export from the Cloudflare Worker editor/API. The audit artifact contained a malformed fragment in `getQueueState`. The recovery JavaScript repairs the missing catch/loop/function closure and passes an independent V8 syntax parse, but it must **not** be represented as a byte-identical Cloudflare export.

A future exact Cloudflare source export should be added alongside this backup and compared before this P0 item is considered fully reproducible.

## Recovery source verification

Reconstructed source SHA-256:

`972baa91a39ac8959a74ccaf37899b516ef6b544522cf29675536d64583ed0f5`

Committed UTF-8 byte count: `30160`

GitHub blob SHA: `46024fc461d987159232db27b059463b7bd77b1f`

Basic local verification:

```bash
node --check worker/backups/v3.2.0/recovery/index.reconstructed.js
wc -c worker/backups/v3.2.0/recovery/index.reconstructed.js
sha256sum worker/backups/v3.2.0/recovery/index.reconstructed.js
```

Expected byte count: `30160`  
Expected SHA-256: `972baa91a39ac8959a74ccaf37899b516ef6b544522cf29675536d64583ed0f5`

The recovery source retains the audited v3.2.0 invariants:

- authenticated HTTP mutation surface using `MATRIX24_API_TOKEN`,
- GitHub SHA-based queue updates,
- durable `processing_media` / `media_claim` reservation,
- transition to `ready_to_publish`,
- direct cron call to `processQueue(env)`,
- Workers AI model `@cf/bytedance/stable-diffusion-xl-lightning`.

No deployment should be made from this backup without an independent review and staging validation.
