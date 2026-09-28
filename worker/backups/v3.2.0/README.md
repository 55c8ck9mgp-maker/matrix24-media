# MATRIX 24 Worker v3.2.0 Backup

This directory is the Phase 2 recovery backup for the production Cloudflare Worker `matrix24-publisher`.

## Safety status

- No production deployment was performed.
- No production queue record was modified.
- No Auto Publisher state was modified.
- No social publishing action was performed.
- No secrets are stored here.

## Files

- `deployed/worker.js` — the live `matrix24-publisher` bundle as returned by the Cloudflare API on 2026-09-28. This is the preferred rollback source.
- `audited-source.md` — verbatim archived source artifact recovered from the audited MATRIX 24 conversation source.
- `recovery/index.reconstructed.js` — normalized recovery-grade JavaScript reconstructed from the markdown-escaped audit artifact.
- `MANIFEST.json` — provenance, validation and SHA-256 metadata.
- `config.inventory.json` — non-secret runtime/binding inventory.
- `ROLLBACK.md` — recovery procedure and guardrails.

## Deployed source (2026-09-28)

`deployed/worker.js` was captured from the Cloudflare API for `matrix24-publisher`. It differs from the reconstruction in three ways:

- `selectQueueRecord` also selects `processing_media`, so a stuck media claim is re-claimed on every cron cycle. That contradicts the claim policy in `docs/ARCHITECTURE.md` and the Worker's own comment ("Claims never expire automatically"), and is fixed in `worker/releases/v3.2.1/`. See `docs/reliability/MEDIA_CLAIM_RETRY_DECISION.md`.
- Outbound fetches use `redirect: "manual"` instead of `"error"`.
- Only the production routes exist (GET `/`, `/health`; POST `/process-queue`, `/upload`, `/`). Diagnostic routes return 404.

SHA-256: `b9c00487e6d4b8f5ba1eb7f0b5da9dcabd47afc2fc07cc53b5787c5ce0c08c60` (28945 bytes). Trailing whitespace on blank lines was transcribed from the API response, so treat the hash as identifying this file, not as proof of byte identity with Cloudflare.

## Important limitation (reconstructed source)

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
